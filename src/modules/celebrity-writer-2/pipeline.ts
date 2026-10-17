// Worker-side workflow for Celebrity Writer 2.0: the article is researched and written in one ChatGPT answer, then
// goes through the same links, images, assembly, SEO, WordPress and Rank Math stages as Celebrity Writer 1.0.
import * as cheerio from 'cheerio';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { contentLocale } from '@/lib/content-locale';
import { htmlToMarkdown } from '@/lib/html/convert';
import { asStringArray } from '@/lib/json';
import { writeLog } from '@/lib/logger';
import type { PromptVariables } from '@/lib/prompts/render';
import { slugify } from '@/lib/utils';
import { splitArticle } from '@/content/assembly';
import { cleanChatGPTHtml } from '@/content/cleanup';
import { parseFaqs } from '@/content/faqs';
import { parseQuickBio } from '@/content/quick-bio';
import { computeMetrics } from '@/seo/metrics';
import { ConfigurationError, GenerationError } from '@/automation/errors';
import type { ChatGPTAnswer } from '@/automation/chatgpt/extension-bridge';
import type { PipelineContext } from '@/automation/pipeline/context';
import type { PipelineDefinition, PipelineStage } from '@/automation/pipeline/types';
import {
  articleApprovalStage,
  articleTitle,
  assemblyStage,
  externalLinksStage,
  rankMathStage,
  seoCheckStage,
  wordPressDraftStage,
} from '@/automation/pipeline/common-stages';
import { humanizeStage } from '@/automation/pipeline/humanize-stage';
import { finishArticleImages, imagesStage, uploadArticleImages, withArticleImages } from '../celebrity-writer/images';
import { CELEBRITY2_MAX_WORDS, CELEBRITY2_MODULE_KEY, CELEBRITY2_STAGE_KEYS as K } from './manifest';
import { CELEBRITY2_PROMPT_KEYS as P } from './prompts';
import { parseWriter2Answer } from './parse';

const BIO_HEADING = /quick\s*(bio|facts)|bio\s*data|fast facts|steckbrief|kurzbiografie|kurzbiographie|auf einen blick/i;
const FAQ_HEADING = /\bfaqs?\b|frequently asked questions|häufig gestellte fragen|häufige fragen/i;

/** The answer as Markdown: the conversation data already gives Markdown; a rendered answer is turned into it. */
function answerMarkdown(answer: ChatGPTAnswer): string {
  if (!answer.html?.trim()) return answer.text;
  const $ = cheerio.load(answer.html, null, false);
  const h1 = $('h1').first();
  const title = h1.text().trim();
  h1.remove();
  const markdown = htmlToMarkdown(cleanChatGPTHtml($.html()));
  return title ? `# ${title}\n\n${markdown}` : markdown;
}

const article: PipelineStage = {
  key: K.article,
  label: 'Research & Article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 45,
  async run(ctx) {
    const log = ctx.log('CHATGPT');
    const { prompt, answer } = await ctx.askChatGPT(K.article, P.article);
    const parsed = parseWriter2Answer(answerMarkdown(answer));
    const title = parsed.title || ctx.task.exampleTitle || ctx.task.keyword;
    const bodyHtml = cleanChatGPTHtml('', { title, fallbackText: parsed.article });
    const metrics = computeMetrics(bodyHtml, ctx.task.keyword);
    if (metrics.wordCount < 500) throw new GenerationError(`The article is only ${metrics.wordCount} words after cleanup`);
    if (metrics.h2Count === 0) log.warn('The article has no H2 headings');

    // The Quick Bio table and the FAQs are taken out of the article, so the assembly shows them the website's way
    // (and the SEO check sees them). Without a readable table or FAQs they simply stay where ChatGPT put them.
    const sections = splitArticle(bodyHtml).sections;
    const bioSection = sections.find((s) => BIO_HEADING.test(s.heading));
    const faqSection = sections.find((s) => FAQ_HEADING.test(s.heading));
    const quickBio = bioSection ? parseQuickBio(bioSection.html, htmlToMarkdown(bioSection.html)) : [];
    const faqs = faqSection ? parseFaqs(htmlToMarkdown(faqSection.html).replace(/^##\s.*$/m, ''), 8) : [];
    if (quickBio.length < 3) log.warn('The Quick Bio table could not be read — it stays in the article as ChatGPT wrote it');
    if (!faqs.length) log.warn('The FAQs could not be read — they stay in the article as ChatGPT wrote them');

    const locale = contentLocale(ctx.task.language ?? ctx.settings.defaultLanguage);
    const data: Prisma.ArticleTaskUpdateInput = {
      bodyHtml,
      recommendedTitle: title,
      titleOptions: [title],
      // A new article gets a new SEO title (built from its title by the assembly).
      seoTitle: null,
      metaDescription: parsed.metaDescription,
      slug: parsed.slug ? slugify(parsed.slug, 75, locale) : null,
      tags: parsed.tags.slice(0, 12),
      ...(quickBio.length >= 3 ? { quickBio: quickBio as unknown as Prisma.InputJsonValue } : {}),
      ...(faqs.length ? { faqs: faqs as unknown as Prisma.InputJsonValue } : {}),
    };
    if (!ctx.task.titleApprovedAt) data.selectedTitle = title;
    await ctx.update(data);

    log.info(`Article saved: "${title}" — ${metrics.wordCount} words, ${metrics.h2Count} H2, Quick Bio ${quickBio.length} rows, ${faqs.length} FAQs`);
    if (parsed.researchNotes.length) log.info(`Research notes from ChatGPT (not published):\n- ${parsed.researchNotes.join('\n- ')}`);
    return {
      outcome: 'completed',
      prompt,
      output: answer.text,
      outputHtml: bodyHtml,
      data: {
        title,
        words: metrics.wordCount,
        metaDescription: parsed.metaDescription,
        slug: parsed.slug,
        tags: parsed.tags,
        internalLinks: parsed.internalLinks,
        researchNotes: parsed.researchNotes,
      } as unknown as Prisma.InputJsonValue,
    };
  },
};

const externalLinks = externalLinksStage(P.externalLinks);
const assembly = assemblyStage({
  missingArticle: 'The article is missing — regenerate the Research & Article stage.',
  assembledMessage: 'Article assembled: Introduction → Quick Bio → Article → FAQs → Final Thoughts',
});
const wordpressDraft = wordPressDraftStage({ prepareContent: uploadArticleImages, afterDraft: finishArticleImages });
const rankMath = rankMathStage(P.seoCorrection, withArticleImages);

const STAGES: PipelineStage[] = [article, externalLinks, imagesStage, humanizeStage, assembly, seoCheckStage, articleApprovalStage, wordpressDraft, rankMath];
const label = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;

export const celebrityWriter2Pipeline: PipelineDefinition = {
  moduleKey: CELEBRITY2_MODULE_KEY,
  stages: STAGES,

  regenerationPlan(stageKey, task) {
    switch (stageKey) {
      case K.article:
        // A new article has no links yet.
        return [K.article, K.externalLinks, K.humanize, K.assembly, K.seoCheck];
      case K.externalLinks:
        return task.bodyHtml ? [K.externalLinks, K.assembly, K.seoCheck] : [K.externalLinks];
      case K.humanize:
        return task.bodyHtml ? [K.humanize, K.assembly, K.seoCheck] : [K.humanize];
      case K.images:
        return task.wpEditUrl ? [K.images, K.wordpressDraft, K.rankMath] : [K.images];
      default:
        throw new ConfigurationError(`Stage "${stageKey}" cannot be regenerated`);
    }
  },

  async variables(ctx: PipelineContext, extra?: PromptVariables) {
    const t = ctx.task;
    const s = ctx.settings;
    // The Article Prompt takes the keyword only (the user's rule); the rest serves the shared later prompts.
    return {
      keyword: t.keyword,
      selected_title: articleTitle(ctx),
      final_article: t.bodyHtml ? htmlToMarkdown(t.bodyHtml) : await ctx.stageOutput(K.article),
      max_words: Math.max(s.maxArticleWordCount, CELEBRITY2_MAX_WORDS).toLocaleString('en-US'),
      min_keyword_occurrences: s.minKeywordOccurrences,
      max_keyword_occurrences: s.maxKeywordOccurrences,
      seo_title: t.seoTitle,
      meta_description: t.metaDescription,
      ...extra,
    };
  },

  async contextPrimer() {
    // Every later prompt carries what it needs (the article itself or the photos).
    return null;
  },

  async finalize(ctx) {
    const t = await ctx.reload();
    const reasons = Array.from(new Set(asStringArray(t.reviewReasons)));
    if (t.seoScore !== null && t.seoScore < ctx.settings.seoReviewThreshold) {
      reasons.push(`SEO Readiness Score ${t.seoScore} is below the review threshold of ${ctx.settings.seoReviewThreshold}.`);
    }
    const status = t.wpEditUrl && reasons.length === 0 ? 'DRAFT_CREATED' : 'NEEDS_REVIEW';
    await ctx.update({
      status,
      progress: 100,
      completedAt: new Date(),
      currentStage: null,
      reviewReasons: reasons,
      statusMessage: t.wpEditUrl ? 'Draft Created Successfully' : null,
    });
    await writeLog({
      taskId: ctx.taskId,
      category: 'SYSTEM',
      message: `Final result: ${status === 'DRAFT_CREATED' ? 'Draft Created' : 'Needs Review'}`,
      data: { status, wpEditUrl: t.wpEditUrl, seoScore: t.seoScore, rankMathScore: t.rankMathScore, reviewReasons: reasons },
    });
  },

  async afterRegeneration(ctx, stageKey) {
    if (stageKey === K.images && ctx.task.wpEditUrl) {
      await celebrityWriter2Pipeline.finalize(ctx);
      return;
    }
    const t = await ctx.reload();
    const incomplete = await prisma.articleStage.count({
      where: { taskId: t.id, status: { not: 'COMPLETED' }, key: { notIn: [K.wordpressDraft, K.rankMath, K.articleApproval] } },
    });
    const message = incomplete
      ? `${label(stageKey)} regenerated. Click "Retry" to continue the remaining stages.`
      : `${label(stageKey)} regenerated.${t.wpEditUrl ? ' Click "Send to WordPress" to update the draft.' : ''}`;
    await ctx.update({ status: 'NEEDS_REVIEW', statusMessage: message, currentStage: null, reviewReasons: [message] });
    await writeLog({ taskId: t.id, category: 'SYSTEM', stage: stageKey, message });
  },
};
