// Worker-side workflow for the Tigram Article Writer (imports Playwright-backed code — never import from the UI).
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { htmlToMarkdown } from '@/lib/html/convert';
import { asStringArray } from '@/lib/json';
import { writeLog } from '@/lib/logger';
import { syncWebsiteCategories } from '@/lib/services/categories';
import type { PromptVariables } from '@/lib/prompts/render';
import { contentLocale } from '@/lib/content-locale';
import { slugify, truncate } from '@/lib/utils';
import { cleanChatGPTHtml } from '@/content/cleanup';
import { parseStructuredArticle } from '@/content/structured-article';
import { countWords } from '@/seo/metrics';
import { ConfigurationError, GenerationError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/automation/errors';
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
import type { PipelineContext } from '@/automation/pipeline/context';
import type { PipelineDefinition, PipelineStage } from '@/automation/pipeline/types';
import { featuredImageTitle, finishArticleImages, imagesStage, uploadArticleImages, withArticleImages } from './images';
import { TIGRAM_MODULE_KEY, TIGRAM_STAGE_KEYS as K } from './manifest';
import { TIGRAM_PROMPT_KEYS as P } from './prompts';

const label = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;

/** Step 1 — one ChatGPT answer with the SEO title, meta description, slug, body and the 7 FAQs. */
const article: PipelineStage = {
  key: K.article,
  label: 'Article',
  kind: 'chatgpt',
  status: 'WRITING_ARTICLE',
  progress: 30,
  async run(ctx) {
    const t = ctx.task;
    const { prompt, answer } = await ctx.askChatGPT(K.article, P.article);
    const cleaned = cleanChatGPTHtml(answer.html, { title: t.selectedTitle ?? t.exampleTitle ?? t.keyword, fallbackText: answer.text });
    const parsed = parseStructuredArticle(cleaned);
    const words = countWords(parsed.bodyHtml);
    if (words < 400) throw new GenerationError(`The article response was too short (${words} words). Regenerate the Article stage.`);

    const locale = contentLocale(t.language ?? ctx.settings.defaultLanguage);
    const title = parsed.title ?? t.exampleTitle ?? t.keyword;
    await ctx.update({
      bodyHtml: parsed.bodyHtml,
      faqs: parsed.faqs as unknown as Prisma.InputJsonValue,
      recommendedTitle: title,
      selectedTitle: t.titleApprovedAt ? (t.selectedTitle ?? title) : title,
      seoTitle: parsed.title ?? t.seoTitle,
      metaDescription: parsed.metaDescription ?? t.metaDescription,
      slug: parsed.slug ? slugify(parsed.slug, 75, locale) : (t.slug ?? slugify(t.keyword, 75, locale)),
      focusKeyword: t.focusKeyword || t.keyword,
    });
    ctx.log('CHATGPT').info(`Article received: ${words} words, ${parsed.faqs.length} FAQs`, {
      title,
      slug: ctx.task.slug,
      metaDescription: ctx.task.metaDescription,
    });
    if (!parsed.faqs.length) ctx.log('CHATGPT').warn('No FAQ section could be read from the answer — the article keeps the FAQs ChatGPT wrote inside the text.');
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { words, faqs: parsed.faqs.length } };
  },
};

/** Step 2 — ChatGPT picks one of the categories that exist on the selected website. */
const category: PipelineStage = {
  key: K.category,
  label: 'Category',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 62,
  async run(ctx) {
    const t = ctx.task;
    if (t.categoryName) return { outcome: 'completed', output: `Category already chosen: ${t.categoryName}`, data: { skipped: true } };
    if (!t.websiteId) return { outcome: 'completed', output: 'Skipped — no website is selected yet.', data: { skipped: true } };
    let categories = await prisma.category.findMany({ where: { websiteId: t.websiteId }, orderBy: { name: 'asc' } });
    if (!categories.length) {
      // Not read yet: take them from Posts → Categories in wp-admin now.
      try {
        const remote = await (await ctx.wordpress()).listCategories();
        const result = await syncWebsiteCategories(t.websiteId, remote.map((c) => c.name));
        ctx.log('WORDPRESS').info(`Read ${result.total} categories from WordPress`);
      } catch (err) {
        ctx.log('WORDPRESS').warn(`Categories could not be read from WordPress: ${(err as Error).message}`);
      }
      categories = await prisma.category.findMany({ where: { websiteId: t.websiteId }, orderBy: { name: 'asc' } });
    }
    if (!categories.length) {
      ctx.log('SYSTEM').warn('The website has no categories — none could be read from WordPress either.');
      return { outcome: 'completed', output: 'Skipped — the website has no categories.', data: { skipped: true } };
    }

    let prompt: string;
    let answer: { text: string; html: string };
    try {
      ({ prompt, answer } = await ctx.askChatGPT(K.category, P.category, { categories: categories.map((c) => `- ${c.name}`).join('\n') }));
    } catch (err) {
      if (err instanceof LoginRequiredError || err instanceof UsageLimitError || err instanceof TaskCancelledError) throw err;
      ctx.log('CHATGPT').warn(`Category step skipped: ${(err as Error).message}`);
      return { outcome: 'completed', output: `Skipped — ${(err as Error).message}`, data: { skipped: true } };
    }

    const line = /category\s*[:\-–]\s*(.+)/i.exec(answer.text.replace(/\*\*|__/g, ''));
    const wanted = (line?.[1] ?? '').split('\n')[0].replace(/^["“„'‚]+|["“”'‘’.]+$/g, '').trim().toLowerCase();
    const picked = categories.find((c) => c.name.toLowerCase() === wanted) ?? categories.find((c) => wanted.includes(c.name.toLowerCase()));
    if (!picked) {
      ctx.log('CHATGPT').warn(`ChatGPT did not name one of the website categories ("${truncate(wanted, 60)}") — no category was set.`);
      return { outcome: 'completed', prompt, output: answer.text, data: { matched: false } };
    }
    await ctx.update({ category: { connect: { id: picked.id } }, categoryName: picked.name });
    ctx.log('CHATGPT').info(`Category chosen by ChatGPT: ${picked.name}`);
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html, data: { category: picked.name } };
  },
};

const externalLinks = externalLinksStage(P.externalLinks);
const assembly = assemblyStage({
  missingArticle: 'The article is missing — regenerate the Article stage.',
  assembledMessage: 'Article assembled: Introduction → Article → FAQs → Conclusion',
});
const wordpressDraft = wordPressDraftStage({ prepareContent: uploadArticleImages, afterDraft: finishArticleImages });
const rankMath = rankMathStage(P.seoCorrection, withArticleImages);

const STAGES: PipelineStage[] = [
  article,
  category,
  externalLinks,
  imagesStage,
  humanizeStage,
  assembly,
  seoCheckStage,
  articleApprovalStage,
  wordpressDraft,
  rankMath,
];

export const tigramPipeline: PipelineDefinition = {
  moduleKey: TIGRAM_MODULE_KEY,
  stages: STAGES,

  regenerationPlan(stageKey, task) {
    const derived = task.bodyHtml ? [K.assembly, K.seoCheck] : [];
    switch (stageKey) {
      case K.article:
        // A new article has no links yet.
        return [stageKey, K.externalLinks, K.humanize, K.assembly, K.seoCheck];
      case K.externalLinks:
        return [stageKey, ...derived];
      case K.humanize:
        return [stageKey, ...derived];
      case K.category:
        return [stageKey];
      case K.images:
        // New pictures for an article that already has a draft go straight into that draft.
        return task.wpEditUrl ? [stageKey, K.wordpressDraft, K.rankMath] : [stageKey];
      default:
        throw new ConfigurationError(`Stage "${stageKey}" cannot be regenerated`);
    }
  },

  async variables(ctx: PipelineContext, extra?: PromptVariables) {
    const t = ctx.task;
    const s = ctx.settings;
    const maxWords = s.maxArticleWordCount;
    return {
      keyword: t.keyword,
      example_title: t.exampleTitle,
      selected_title: articleTitle(ctx),
      secondary_keywords: asStringArray(t.secondaryKeywords).join(', '),
      country: t.targetCountry ?? s.targetCountry,
      language: t.language ?? s.defaultLanguage,
      category: t.categoryName,
      word_range: `${maxWords.toLocaleString('en-US')} to ${(maxWords + 100).toLocaleString('en-US')}`,
      max_words: maxWords.toLocaleString('en-US'),
      final_article: t.bodyHtml ? htmlToMarkdown(t.bodyHtml) : await ctx.stageOutput(K.article),
      seo_title: t.seoTitle,
      meta_description: t.metaDescription,
      image_title: featuredImageTitle(articleTitle(ctx)),
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
    if (stageKey !== K.article && t.bodyHtml) parts.push(`Current article:\n${truncate(htmlToMarkdown(t.bodyHtml), 15_000)}`);
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
      // The draft was updated with the new images in this run: finish like a normal article.
      await tigramPipeline.finalize(ctx);
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
