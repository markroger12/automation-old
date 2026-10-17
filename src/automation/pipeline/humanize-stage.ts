// The Humanizer stage every writer runs after its images and before the article is assembled (the user's rule of
// 27 September 2026: "wordpress draft sa phale add krde, optional nahi"). Every paragraph of the article body is edited
// by ChatGPT to read more naturally (src/content/humanizer); a paragraph whose names, numbers, quotes, links or keyword
// changed stays as it was. The body is what the assembly and the WordPress draft are built from, so it is edited there.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assembleTaskContent, runInternalSeoCheck } from '@/lib/services/articles';
import { extractInternalLink, withInternalLink } from '@/content/internal-link';
import { humanize } from '@/content/humanizer/humanize';
import { HUMANIZE_PROMPT_KEY, HUMANIZE_STAGE_KEY } from '@/content/humanizer/prompt';
import { ConfigurationError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/automation/errors';
import type { PipelineStage } from './types';

interface HumanizeStageData {
  /** The article body before it was humanized. */
  original?: string;
  /** The body the stage saved. */
  output?: string;
}

export const humanizeStage: PipelineStage = {
  key: HUMANIZE_STAGE_KEY,
  label: 'Humanizer',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 79,
  async run(ctx) {
    const t = ctx.task;
    if (!t.bodyHtml) return { outcome: 'completed', output: 'Skipped — there is no article yet.', data: { skipped: true } };
    const log = ctx.log('CHATGPT');

    // Regenerated while the article is still the one this stage saved: humanize the article as it was before, not the
    // humanized one a second time.
    const row = await prisma.articleStage.findUnique({ where: { taskId_key: { taskId: ctx.taskId, key: HUMANIZE_STAGE_KEY } }, select: { data: true } });
    const previous = (row?.data ?? {}) as HumanizeStageData;
    const source = previous.original && previous.output === t.bodyHtml ? previous.original : t.bodyHtml;
    // The internal link line at the end is never edited (and is always the current one).
    const internalLink = extractInternalLink(t.bodyHtml).paragraph;

    const result = await humanize({
      input: extractInternalLink(source).html,
      keyword: t.keyword,
      rewriteAll: true,
      stopOn: (err) => err instanceof TaskCancelledError || err instanceof LoginRequiredError || err instanceof UsageLimitError || err instanceof ConfigurationError,
      onProgress: (message) => ctx.update({ statusMessage: `Humanizer — ${message}` }),
      // In the article's own chat, so ChatGPT has the whole article in view (the user's wish, 8 October 2026; until
      // then every part went to a new chat).
      ask: async (_prompt, _part, _parts, pieces) => (await ctx.askChatGPT(HUMANIZE_STAGE_KEY, HUMANIZE_PROMPT_KEY, { ...pieces })).answer.text,
    });

    const bodyHtml = withInternalLink(result.output, internalLink);
    await ctx.update({ bodyHtml, statusMessage: null });
    // Already assembled (a task retried from a later stage): the article and its SEO check follow the new body.
    if (t.contentHtml) {
      const contentHtml = assembleTaskContent(ctx.task);
      if (contentHtml) await ctx.update({ contentHtml });
      await runInternalSeoCheck(ctx.taskId, ctx.settings);
      await ctx.reload();
    }

    const { before, after } = result;
    const summary =
      `Humanizer: ${result.rewritten} of ${result.sent} paragraph(s) rewritten, ${result.keptOriginal} kept as they were — ` +
      `AI-style signals ${before.signalsPer1000} → ${after.signalsPer1000} per 1,000 words, sentence rhythm ${before.sentenceLength.variation} → ${after.sentenceLength.variation}, ` +
      `${before.words} → ${after.words} words`;
    log.info(summary);
    const kept = result.paragraphs.filter((p) => p.outcome === 'kept-original' || p.outcome === 'missing');
    if (kept.length) log.warn(`Paragraphs kept as they were:\n- ${kept.slice(0, 8).map((p) => `P${p.number}: ${p.problems.join('; ')}`).join('\n- ')}`);
    if (result.failedPrompts.length) log.warn(`Humanizer parts ChatGPT did not answer: ${result.failedPrompts.join(' | ')}`);

    return {
      outcome: 'completed',
      output: summary,
      outputHtml: bodyHtml,
      data: {
        original: source,
        output: bodyHtml,
        sent: result.sent,
        rewritten: result.rewritten,
        keptOriginal: result.keptOriginal,
        failedPrompts: result.failedPrompts,
        before: { signalsPer1000: before.signalsPer1000, rhythm: before.sentenceLength.variation, wordVariety: before.wordVariety, words: before.words },
        after: { signalsPer1000: after.signalsPer1000, rhythm: after.sentenceLength.variation, wordVariety: after.wordVariety, words: after.words },
      } as unknown as Prisma.InputJsonValue,
    };
  },
};
