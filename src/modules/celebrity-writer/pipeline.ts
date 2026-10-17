// Worker-side workflow for the Celebrity Article Writer (imports Playwright-backed code — never import from the UI).
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { htmlToMarkdown, htmlToText } from '@/lib/html/convert';
import { asStringArray } from '@/lib/json';
import { writeLog } from '@/lib/logger';
import type { PromptVariables } from '@/lib/prompts/render';
import { truncate } from '@/lib/utils';
import { cleanChatGPTHtml } from '@/content/cleanup';
import { parseFaqs } from '@/content/faqs';
import { parseQuickBio } from '@/content/quick-bio';
import { extractTitles } from '@/content/titles';
import { computeMetrics, countWords } from '@/seo/metrics';
import { ConfigurationError, GenerationError } from '@/automation/errors';
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
import { CELEBRITY_MODULE_KEY, CELEBRITY_STAGE_KEYS as K } from './manifest';
import { CELEBRITY_PROMPT_KEYS as P } from './prompts';
import { imagesStage, uploadArticleImages, finishArticleImages, withArticleImages } from './images';

const label = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;

// ─────────────────────────────── ChatGPT stages ───────────────────────────────

const titles: PipelineStage = {
  key: K.titles,
  label: 'Generate Titles',
  kind: 'chatgpt',
  status: 'GENERATING_TITLES',
  progress: 12,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.titles, P.titles);
    const { options, recommended } = extractTitles(answer.text);
    if (!recommended) throw new GenerationError('No title could be extracted from the ChatGPT response');
    const data: Prisma.ArticleTaskUpdateInput = { titleOptions: options, recommendedTitle: recommended };
    if (!ctx.task.titleApprovedAt) data.selectedTitle = recommended;
    await ctx.update(data);
    ctx.log('CHATGPT').info(`Recommended title: ${recommended}`, { options });
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { options, recommended } };
  },
};

const titleApproval: PipelineStage = {
  key: K.titleApproval,
  label: 'Title Approval',
  kind: 'gate',
  status: 'GENERATING_TITLES',
  progress: 15,
  async run(ctx) {
    if (ctx.settings.manualTitleApproval && !ctx.task.titleApprovedAt) {
      return { outcome: 'paused', status: 'AWAITING_TITLE_APPROVAL', message: 'Choose the article title to continue.' };
    }
    if (!ctx.task.selectedTitle) await ctx.update({ selectedTitle: articleTitle(ctx) });
    return { outcome: 'completed', output: ctx.task.selectedTitle };
  },
};

const research: PipelineStage = {
  key: K.research,
  label: 'Celebrity Research',
  kind: 'chatgpt',
  status: 'RESEARCHING',
  progress: 28,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.research, P.research);
    if (countWords(answer.text) < 80) throw new GenerationError('The research response is too short to write an article from');
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html };
  },
};

const longArticle: PipelineStage = {
  key: K.longArticle,
  label: 'Long Article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 42,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.longArticle, P.longArticle);
    const words = countWords(answer.text);
    if (words < 500) throw new GenerationError(`The long article is only ${words} words`);
    ctx.log('CHATGPT').info(`Long article received: ${words} words`);
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { words } };
  },
};

const finalArticle: PipelineStage = {
  key: K.finalArticle,
  label: 'Final Article',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 56,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.finalArticle, P.finalArticle);
    const bodyHtml = cleanChatGPTHtml(answer.html, { title: articleTitle(ctx), fallbackText: answer.text });
    const metrics = computeMetrics(bodyHtml, ctx.task.keyword);
    if (metrics.wordCount < 300) throw new GenerationError(`The final article is only ${metrics.wordCount} words after cleanup`);
    if (metrics.h2Count === 0) ctx.log('CHATGPT').warn('The final article has no H2 headings');
    await ctx.update({ bodyHtml });
    ctx.log('CHATGPT').info(`Final article saved: ${metrics.wordCount} words, ${metrics.h2Count} H2, ${metrics.h3Count} H3`);
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: bodyHtml, data: { words: metrics.wordCount } };
  },
};

const faqs: PipelineStage = {
  key: K.faqs,
  label: 'FAQs',
  kind: 'chatgpt',
  status: 'GENERATING_FAQS',
  progress: 63,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.faqs, P.faqs);
    let items = parseFaqs(answer.text, ctx.settings.faqCount);
    if (!items.length) items = parseFaqs(htmlToText(answer.html), ctx.settings.faqCount);
    if (!items.length) throw new GenerationError('No FAQs could be parsed from the ChatGPT response');
    if (items.length < ctx.settings.faqCount) ctx.log('CHATGPT').warn(`Only ${items.length} of ${ctx.settings.faqCount} FAQs were parsed`);
    await ctx.update({ faqs: items as unknown as Prisma.InputJsonValue });
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { count: items.length } };
  },
};

const quickBio: PipelineStage = {
  key: K.quickBio,
  label: 'Quick Bio Table',
  kind: 'chatgpt',
  status: 'GENERATING_BIO_TABLE',
  progress: 70,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT(K.quickBio, P.quickBio);
    const rows = parseQuickBio(answer.html, answer.text);
    if (rows.length < 3) throw new GenerationError('The Quick Bio table could not be parsed from the ChatGPT response');
    await ctx.update({ quickBio: rows as unknown as Prisma.InputJsonValue });
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { rows: rows.length } };
  },
};

/**
 * Optional (Settings → External links): ChatGPT suggests links for names, titles, universities and places in the
 * article; only links that pass the checks (trusted site, page exists, page is about those words) are added.
 * Problems here never stop the article — it simply goes on without links.
 */
const externalLinks = externalLinksStage(P.externalLinks);
const assembly = assemblyStage({
  missingArticle: 'The final article is missing — regenerate the Final Article stage.',
  assembledMessage: 'Article assembled: Introduction → Quick Bio → Article → FAQs → Conclusion',
});
const wordpressDraft = wordPressDraftStage({ prepareContent: uploadArticleImages, afterDraft: finishArticleImages });
const rankMath = rankMathStage(P.seoCorrection, withArticleImages);

const STAGES: PipelineStage[] = [
  titles,
  titleApproval,
  research,
  longArticle,
  finalArticle,
  faqs,
  quickBio,
  externalLinks,
  imagesStage,
  humanizeStage,
  assembly,
  seoCheckStage,
  articleApprovalStage,
  wordpressDraft,
  rankMath,
];

export const celebrityPipeline: PipelineDefinition = {
  moduleKey: CELEBRITY_MODULE_KEY,
  stages: STAGES,

  regenerationPlan(stageKey, task) {
    const derived = task.bodyHtml ? [K.assembly, K.seoCheck] : [];
    switch (stageKey) {
      case K.titles:
      case K.research:
      case K.longArticle:
        return [stageKey];
      case K.finalArticle:
        // A new final article has no links yet.
        return [stageKey, K.externalLinks, K.humanize, K.assembly, K.seoCheck];
      case K.faqs:
      case K.quickBio:
      case K.externalLinks:
        return [stageKey, ...derived];
      case K.humanize:
        return [stageKey, ...derived];
      case K.images:
        return task.wpEditUrl ? [stageKey, K.wordpressDraft, K.rankMath] : [stageKey];
      default:
        throw new ConfigurationError(`Stage "${stageKey}" cannot be regenerated`);
    }
  },

  async variables(ctx: PipelineContext, extra?: PromptVariables) {
    const t = ctx.task;
    const s = ctx.settings;
    const [researchText, articleText] = await Promise.all([ctx.stageOutput(K.research), ctx.stageOutput(K.longArticle)]);
    return {
      keyword: t.keyword,
      example_title: t.exampleTitle,
      selected_title: articleTitle(ctx),
      secondary_keywords: asStringArray(t.secondaryKeywords).join(', '),
      country: t.targetCountry ?? s.targetCountry,
      language: t.language ?? s.defaultLanguage,
      category: t.categoryName,
      research: researchText,
      article: articleText,
      final_article: t.bodyHtml ? htmlToMarkdown(t.bodyHtml) : await ctx.stageOutput(K.finalArticle),
      max_words: s.maxArticleWordCount.toLocaleString('en-US'),
      min_keyword_occurrences: s.minKeywordOccurrences,
      max_keyword_occurrences: s.maxKeywordOccurrences,
      faq_count: s.faqCount,
      bio_rows_range: `${Math.max(3, s.quickBioRows - 1)} to ${s.quickBioRows + 1}`,
      seo_title: t.seoTitle,
      meta_description: t.metaDescription,
      ...extra,
    };
  },

  async contextPrimer(ctx, stageKey) {
    const t = ctx.task;
    const parts = [
      'We are continuing earlier work on a blog article, but the previous chat is not available. Use this context from our earlier steps.',
      `Target keyword: ${t.keyword}`,
      `Article title: ${articleTitle(ctx)}`,
    ];
    const needsResearch = [K.longArticle, K.finalArticle, K.faqs, K.quickBio, K.rankMath].includes(stageKey as never);
    const researchText = needsResearch ? await ctx.stageOutput(K.research) : null;
    if (researchText) parts.push(`Research notes:\n${truncate(researchText, 15_000)}`);
    if (stageKey === K.finalArticle) {
      const draft = await ctx.stageOutput(K.longArticle);
      if (draft) parts.push(`Previous long article:\n${truncate(draft, 15_000)}`);
    }
    if ((stageKey === K.faqs || stageKey === K.quickBio) && t.bodyHtml) {
      parts.push(`Final article:\n${truncate(htmlToMarkdown(t.bodyHtml), 12_000)}`);
    }
    return parts.length > 3 ? parts.join('\n\n') : null;
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
      await celebrityPipeline.finalize(ctx);
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
