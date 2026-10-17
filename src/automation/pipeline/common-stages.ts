// Stages every writer module shares: external links, assembly, SEO check, the approval gate, the WordPress draft and
// the Rank Math round. A module adds its own ChatGPT writing stages and reuses these unchanged.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { asStringArray } from '@/lib/json';
import { contentLocale } from '@/lib/content-locale';
import { slugify } from '@/lib/utils';
import { asBioRows, assembleTaskContent, runInternalSeoCheck } from '@/lib/services/articles';
import { resolveInternalLink } from '@/lib/services/internal-links';
import { introText } from '@/content/assembly';
import { cleanChatGPTHtml } from '@/content/cleanup';
import { insertExternalLinks, isWikipediaUrl, MAX_LINKS_PER_PARAGRAPH, parseLinkSuggestions } from '@/content/external-links';
import { extractInternalLink, renderInternalLink, withInternalLink } from '@/content/internal-link';
import { buildMetaDescription, buildSeoTitle, deriveSubjectName } from '@/content/seo-meta';
import { computeMetrics } from '@/seo/metrics';
import { verifyLink, type LinkCheck } from '@/automation/links/verify-link';
import { ConfigurationError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/automation/errors';
import { postIdFromUrl, type PostEditor } from '@/automation/wordpress/editor';
import { storedImages } from '@/automation/images/store';
import { planHasAutomaticFixes, planRankMathFixes } from '@/automation/wordpress/rankmath-fixes';
import type { PipelineContext } from './context';
import type { PipelineStage } from './types';

/** Stage keys used by the shared stages — every module uses the same names for them. */
export const SHARED_STAGE_KEYS = {
  externalLinks: 'EXTERNAL_LINKS',
  assembly: 'ASSEMBLY',
  seoCheck: 'SEO_CHECK',
  articleApproval: 'ARTICLE_APPROVAL',
  wordpressDraft: 'WORDPRESS_DRAFT',
  rankMath: 'RANKMATH',
} as const;

export function articleTitle(ctx: PipelineContext): string {
  const t = ctx.task;
  return t.selectedTitle ?? t.recommendedTitle ?? t.exampleTitle ?? t.keyword;
}

export function headingCount(html: string): number {
  const m = computeMetrics(html, '');
  return m.h2Count + m.h3Count;
}

/**
 * Puts "<line of the website> <previous article>" at the end of the article body (Websites → Internal link line).
 * Never stops the article: when the previous article cannot be found, an existing link is kept.
 */
export async function applyInternalLink(ctx: PipelineContext, waitMs: number): Promise<void> {
  const t = ctx.task;
  if (!t.bodyHtml) return;
  const log = ctx.log('SEO');
  try {
    const result = await resolveInternalLink(t, {
      waitMs,
      onWait: (keyword) => log.info(`Internal link: waiting for the previous article "${keyword}" to get its title`),
      shouldStop: () => ctx.isCancelRequested(),
    });
    if (!result.link && !result.disabled) {
      log.warn(`Internal link not added: ${result.note}`);
      return;
    }
    const html = withInternalLink(t.bodyHtml, result.link ? renderInternalLink(result.link) : null);
    if (html !== t.bodyHtml) await ctx.update({ bodyHtml: html });
    if (result.link) log.info(`Internal link: ${result.link.line} "${result.link.title}" → ${result.link.url} (${result.note})`);
  } catch (err) {
    log.warn(`Internal link not added: ${(err as Error).message}`);
  }
}

/** The images stage of both writers — its stored pictures carry the media id of the featured image. */
const IMAGES_STAGE_KEY = 'IMAGES';

/**
 * The task's post when WordPress already has it scheduled, published, pending or private (null for a draft or no
 * post yet). Asked through WordPress itself, so a post scheduled by the workflow or by hand is both recognised.
 */
async function livePost(ctx: PipelineContext): Promise<{ id: string; status: string } | null> {
  const t = ctx.task;
  const id = t.wpPostId ?? (t.wpEditUrl ? postIdFromUrl(t.wpEditUrl) : null);
  if (!id) return null;
  const status = await (await ctx.wordpress()).postStatus(id);
  if (status === 'trash') throw new ConfigurationError('The WordPress post of this article is in the trash — restore it first.');
  return status && ['future', 'publish', 'pending', 'private'].includes(status) ? { id, status } : null;
}

export async function openEditor(ctx: PipelineContext): Promise<PostEditor> {
  if (ctx.editor && !ctx.editor.page.isClosed()) return ctx.editor;
  const wp = await ctx.wordpress();
  await ctx.setStatus('OPENING_WORDPRESS');
  await wp.openDashboard();
  const editUrl = ctx.task.wpEditUrl;
  if (editUrl) ctx.log('WORDPRESS').info('Opening the existing draft (no duplicate post will be created)', { editUrl });
  const editor = editUrl ? await wp.openPost(editUrl) : await wp.createNewPost();
  await editor.assertDraft();
  ctx.editor = editor;
  return editor;
}

/**
 * Optional (Settings → External links): ChatGPT suggests links for names, titles, universities and places in the
 * article; only links that pass the checks (trusted site, page exists, page is about those words) are added.
 * Problems here never stop the article — it simply goes on without links.
 */
export function externalLinksStage(promptKey: string): PipelineStage {
  return {
    key: SHARED_STAGE_KEYS.externalLinks,
    label: 'External Links',
    kind: 'chatgpt',
    status: 'OPTIMIZING',
    progress: 72,
    async run(ctx) {
      const t = ctx.task;
      const s = ctx.settings;
      if (!s.externalLinks) return { outcome: 'completed', output: 'Skipped — external links are switched off in Settings.', data: { skipped: true } };
      if (!t.bodyHtml) return { outcome: 'completed', output: 'Skipped — there is no final article yet.', data: { skipped: true } };
      const log = ctx.log('CHATGPT');

      const existing = (extractInternalLink(t.bodyHtml).html.match(/<a\s[^>]*href=["']https?:/gi) ?? []).length;
      const room = s.maxExternalLinks - existing;
      if (room <= 0) return { outcome: 'completed', output: `The article already has ${existing} link(s).`, data: { skipped: true } };

      const german = contentLocale(t.language ?? s.defaultLanguage) === 'de';
      let prompt: string;
      let answer: { text: string; html: string };
      try {
        ({ prompt, answer } = await ctx.askChatGPT(SHARED_STAGE_KEYS.externalLinks, promptKey, {
          link_count: `${room} to ${room + 2}`,
          wikipedia_site: german ? 'de.wikipedia.org' : 'en.wikipedia.org',
        }));
      } catch (err) {
        if (err instanceof LoginRequiredError || err instanceof UsageLimitError || err instanceof TaskCancelledError) throw err;
        log.warn(`External links skipped: ${(err as Error).message}`);
        return { outcome: 'completed', output: `Skipped — ${(err as Error).message}`, data: { skipped: true } };
      }

      const own = [t.keyword, deriveSubjectName(t.keyword, asBioRows(t.quickBio))].map((v) => v.toLowerCase());
      const checks: LinkCheck[] = [];
      for (const suggestion of parseLinkSuggestions(answer.text)) {
        if (own.includes(suggestion.phrase.toLowerCase())) {
          checks.push({ ...suggestion, ok: false, reason: 'is the article’s own subject' });
          continue;
        }
        checks.push(await verifyLink(suggestion, { language: t.language ?? s.defaultLanguage }));
      }
      // Other sites (IMDb, official websites, Britannica…) go in first and Wikipedia gets at most half of the links,
      // so an article is not linked to Wikipedia only. No paragraph gets more than two external links.
      const verified = checks.filter((c) => c.ok);
      const ordered = [...verified.filter((c) => !isWikipediaUrl(c.url)), ...verified.filter((c) => isWikipediaUrl(c.url))];
      const { html, inserted, skipped } = insertExternalLinks(t.bodyHtml, ordered, room, {
        perParagraph: MAX_LINKS_PER_PARAGRAPH,
        wikipediaMax: Math.ceil(room / 2),
      });
      if (inserted.length) await ctx.update({ bodyHtml: html });

      const reasonOf = (c: LinkCheck) => (c.ok ? skipped.find((s) => s.link.url === c.url)?.reason ?? 'the same page or words were already linked' : c.reason);
      const rejected = checks.filter((c) => !c.ok || !inserted.some((l) => l.url === c.url));
      for (const link of inserted) log.info(`External link added: "${link.anchor}" → ${link.url}`);
      for (const c of rejected) log.info(`External link not used: "${c.phrase}" → ${c.url} (${reasonOf(c)})`);
      log.info(`External links: ${inserted.length} added, ${rejected.length} not used`);
      return {
        outcome: 'completed',
        prompt,
        output: answer.text,
        outputHtml: answer.html,
        data: {
          added: inserted.map((l) => ({ anchor: l.anchor, url: l.url })),
          notUsed: rejected.map((c) => ({ phrase: c.phrase, url: c.url, reason: reasonOf(c) })),
        } as unknown as Prisma.InputJsonValue,
      };
    },
  };
}

export function assemblyStage(opts: { missingArticle: string; assembledMessage: string }): PipelineStage {
  return {
    key: SHARED_STAGE_KEYS.assembly,
    label: 'Article Assembly',
    kind: 'local',
    status: 'SEO_CHECKING',
    progress: 74,
    async run(ctx) {
      if (!ctx.task.bodyHtml) throw new ConfigurationError(opts.missingArticle);
      await applyInternalLink(ctx, 10 * 60_000);
      const t = ctx.task;
      if (!t.bodyHtml) throw new ConfigurationError(opts.missingArticle);
      const contentHtml = assembleTaskContent(t);
      if (!contentHtml) throw new ConfigurationError('Article assembly produced no content.');
      const subject = deriveSubjectName(t.keyword, asBioRows(t.quickBio));
      const title = articleTitle(ctx);
      const locale = contentLocale(t.language ?? ctx.settings.defaultLanguage);
      await ctx.update({
        contentHtml,
        seoTitle: t.seoTitle || buildSeoTitle(title, t.keyword, 60, locale),
        metaDescription:
          t.metaDescription || buildMetaDescription({ introText: introText(t.bodyHtml), keyword: t.keyword, subjectName: subject, locale }),
        slug: t.slug || slugify(t.keyword, 75, locale),
        focusKeyword: t.focusKeyword || t.keyword,
        tags: asStringArray(t.tags).length ? asStringArray(t.tags) : [t.keyword],
      });
      ctx.log('SYSTEM').info(opts.assembledMessage);
      return { outcome: 'completed', outputHtml: contentHtml };
    },
  };
}

export const seoCheckStage: PipelineStage = {
  key: SHARED_STAGE_KEYS.seoCheck,
  label: 'SEO Check',
  kind: 'local',
  status: 'SEO_CHECKING',
  progress: 78,
  async run(ctx) {
    const report = await runInternalSeoCheck(ctx.taskId, ctx.settings);
    await ctx.reload();
    const failed = report.checks.filter((c) => c.status === 'fail').map((c) => c.label);
    ctx.log('SEO').info(`SEO Readiness Score: ${report.score}/100`, { metrics: report.metrics, failed });
    return { outcome: 'completed', data: { score: report.score, failed } };
  },
};

export const articleApprovalStage: PipelineStage = {
  key: SHARED_STAGE_KEYS.articleApproval,
  label: 'Article Approval',
  kind: 'gate',
  status: 'SEO_CHECKING',
  progress: 80,
  async run(ctx) {
    const t = ctx.task;
    if (ctx.settings.manualArticleApproval && !t.articleApprovedAt) {
      return { outcome: 'paused', status: 'AWAITING_ARTICLE_APPROVAL', message: 'Review the article, then approve it to create the WordPress draft.' };
    }
    if (!ctx.settings.autoSendToWordPress && !t.articleApprovedAt) {
      return { outcome: 'paused', status: 'NEEDS_REVIEW', message: 'Article ready. Automatic WordPress sending is off — click "Send to WordPress".' };
    }
    if (!t.websiteId) {
      return { outcome: 'paused', status: 'NEEDS_REVIEW', message: 'Article ready. Select a website, then click "Send to WordPress".' };
    }
    return { outcome: 'completed' };
  },
};

export interface WordPressDraftHooks {
  /** Runs before the editor opens (it may use the WordPress window, e.g. to upload images); returns the HTML to paste. */
  prepareContent?: (ctx: PipelineContext, html: string) => Promise<string>;
  /** Runs after the draft exists, before the final save; anything it returns is added to the review reasons. */
  afterDraft?: (ctx: PipelineContext, editor: PostEditor) => Promise<string[]>;
}

export function wordPressDraftStage(hooks: WordPressDraftHooks = {}): PipelineStage {
  return {
    key: SHARED_STAGE_KEYS.wordpressDraft,
    label: 'WordPress Draft',
    kind: 'wordpress',
    status: 'OPENING_WORDPRESS',
    progress: 88,
    async run(ctx) {
      // Assemble again from the saved parts, so "Send to WordPress" also applies later fixes (headings, tables) and
      // links the previous article under its final title/address.
      await applyInternalLink(ctx, 0);
      const reassembled = assembleTaskContent(ctx.task);
      if (reassembled && reassembled !== ctx.task.contentHtml) await ctx.update({ contentHtml: reassembled });
      const t = ctx.task;
      if (!t.contentHtml) throw new ConfigurationError('No assembled article to send to WordPress.');
      const html = hooks.prepareContent ? await hooks.prepareContent(ctx, t.contentHtml) : t.contentHtml;
      if (html !== t.contentHtml) await ctx.update({ contentHtml: html });

      // A post that is already scheduled or live has no "Save draft" in the editor: its text is replaced through
      // WordPress's own interface instead, and it keeps its publish time.
      const live = await livePost(ctx);
      if (live) {
        const wp = await ctx.wordpress();
        await ctx.setStatus('CREATING_DRAFT');
        const featured = (await storedImages(ctx.taskId, IMAGES_STAGE_KEY)).find((image) => image.role === 'featured' && image.mediaId)?.mediaId ?? null;
        await wp.updateLivePost(live.id, { title: articleTitle(ctx), html, featuredMedia: featured });
        await ctx.update({ wpDraftSavedAt: new Date() });
        const message = `The ${live.status === 'future' ? 'scheduled' : 'live'} post was updated; its publish time stays as it was.`;
        ctx.log('WORDPRESS').info(message, { postId: live.id, editUrl: t.wpEditUrl });
        return { outcome: 'completed', output: message, data: { editUrl: t.wpEditUrl, postStatus: live.status } };
      }

      const editor = await openEditor(ctx);
      await ctx.setStatus('CREATING_DRAFT');

      await editor.setTitle(articleTitle(ctx));
      await editor.setContent(html, headingCount(html));

      // Save immediately so a retry re-opens this post instead of creating another one.
      const first = await editor.saveDraft();
      await ctx.update({ wpEditUrl: first.editUrl, wpPostId: first.postId ?? t.wpPostId, wpDraftSavedAt: new Date() });

      const reasons: string[] = [];
      if (t.categoryName) {
        const result = await editor.selectCategory(t.categoryName, { createIfMissing: ctx.settings.createMissingCategory });
        if (!result.selected) reasons.push(result.message);
      } else {
        reasons.push('No WordPress category was selected for this article.');
      }
      const tags = asStringArray(t.tags);
      for (const tag of tags.length ? tags : [t.keyword]) {
        const result = await editor.addTag(tag);
        if (!result.added && !result.existingTerm) reasons.push(`Tag "${tag}": ${result.message}`);
      }
      if (t.slug && !(await editor.setSlug(t.slug))) {
        ctx.log('WORDPRESS').warn('Slug field not found in the editor; it will be set through Rank Math if available');
      }
      if (hooks.afterDraft) reasons.push(...(await hooks.afterDraft(ctx, editor)));

      const saved = await editor.saveDraft();
      await ctx.update({ wpEditUrl: saved.editUrl, wpPostId: saved.postId ?? first.postId, wpDraftSavedAt: new Date(), reviewReasons: reasons });
      ctx.log('WORDPRESS').info('Draft Created Successfully', { editUrl: saved.editUrl, reviewReasons: reasons });
      return { outcome: 'completed', data: { editUrl: saved.editUrl, reviewReasons: reasons } };
    },
  };
}

async function reviseContentForRankMath(ctx: PipelineContext, issues: string[], promptKey: string): Promise<string | null> {
  const t = ctx.task;
  if (!t.bodyHtml) return null;
  const { answer } = await ctx.askChatGPT(SHARED_STAGE_KEYS.rankMath, promptKey, {
    rankmath_issues: issues.map((i) => `- ${i}`).join('\n'),
  });
  const revised = cleanChatGPTHtml(answer.html, { title: articleTitle(ctx), fallbackText: answer.text });
  const before = computeMetrics(t.bodyHtml, t.keyword);
  const after = computeMetrics(revised, t.keyword);
  const rejection =
    // Up to 15% more than the Settings maximum, or than the article itself when it is already longer (Celebrity Writer 2.0).
    after.bodyWordCount > Math.max(ctx.settings.maxArticleWordCount, before.bodyWordCount) * 1.15
      ? `too long (${after.bodyWordCount} words)`
      : after.wordCount < before.wordCount * 0.7
        ? `too much content removed (${after.wordCount} vs ${before.wordCount} words)`
        : after.h2Count < Math.max(2, before.h2Count - 2)
          ? 'headings were lost'
          : after.keywordDensity > 2.5
            ? `keyword density too high (${after.keywordDensity}%)`
            : null;
  if (rejection) {
    ctx.log('RANKMATH').warn(`Rejected SEO correction from ChatGPT: ${rejection}. Keeping the current article.`);
    return null;
  }
  return revised;
}

async function saveRankMathReport(ctx: PipelineContext, score: number | null, issues: string[], attempt: number): Promise<void> {
  await prisma.sEOReport.create({
    data: {
      taskId: ctx.taskId,
      source: 'RANKMATH',
      score,
      checks: issues.map((message) => ({ status: 'fail', message })) as Prisma.InputJsonValue,
      metrics: { attempt } as Prisma.InputJsonValue,
    },
  });
}

export function rankMathStage(
  correctionPromptKey: string,
  /** Applied to the article whenever it is written into the editor again (e.g. to keep its images). */
  transformContent?: (ctx: PipelineContext, html: string) => Promise<string>,
): PipelineStage {
  return {
    key: SHARED_STAGE_KEYS.rankMath,
    label: 'Rank Math Check',
    kind: 'wordpress',
    status: 'RUNNING_RANKMATH',
    progress: 97,
    async run(ctx) {
      if (!ctx.task.wpEditUrl) throw new ConfigurationError('The WordPress draft has not been created yet.');
      // Rank Math is set while the article is still a draft; a scheduled or live post can only be saved with its own
      // Schedule / Update button, which the automation never presses.
      const live = await livePost(ctx);
      if (live) {
        const message = `Skipped — the post is already ${live.status === 'future' ? 'scheduled' : 'live'}; its Rank Math fields stay as they were set before.`;
        ctx.log('RANKMATH').info(message);
        return { outcome: 'completed', output: message, data: { skipped: true, postStatus: live.status } };
      }
      const editor = await openEditor(ctx);
      await ctx.setStatus('RUNNING_RANKMATH');
      const log = ctx.log('RANKMATH');
      const reasons = asStringArray(ctx.task.reviewReasons);

      const panel = await editor.rankMath();
      if (!panel || !(await panel.open())) {
        log.warn('Rank Math panel not found — is the Rank Math plugin active on this site?');
        reasons.push('Rank Math panel was not found, so the focus keyword, SEO title and meta description were not set.');
        await ctx.update({ reviewReasons: reasons });
        return { outcome: 'completed', data: { rankMath: false } };
      }

      let t = ctx.task;
      if (!(await panel.setFocusKeyword(t.focusKeyword || t.keyword))) reasons.push('Could not set the Rank Math focus keyword.');
      const snippet = await panel.setSnippet({ title: t.seoTitle, description: t.metaDescription, permalink: t.slug });
      if (!snippet.title) reasons.push('Could not set the SEO title in Rank Math.');
      if (!snippet.description) reasons.push('Could not set the meta description in Rank Math.');
      await editor.saveDraft();

      const target = ctx.settings.rankMathTargetScore;
      let score = await panel.readScore();
      let issues = score !== null && score < target ? await panel.readFailedChecks() : [];
      log.info(score === null ? 'Rank Math score not visible' : `Actual Rank Math Score: ${score}`, { issues });
      await saveRankMathReport(ctx, score, issues, 0);

      let manualIssues: string[] = [];
      for (let attempt = 1; score !== null && score < target && attempt <= ctx.settings.maxRankMathAttempts; attempt++) {
        t = ctx.task;
        const plan = planRankMathFixes(issues, {
          keyword: t.focusKeyword || t.keyword,
          articleTitle: articleTitle(ctx),
          seoTitle: t.seoTitle ?? '',
          metaDescription: t.metaDescription ?? '',
          slug: t.slug ?? '',
          introText: introText(t.bodyHtml ?? ''),
          subjectName: deriveSubjectName(t.keyword, asBioRows(t.quickBio)),
          locale: contentLocale(t.language ?? ctx.settings.defaultLanguage),
        });
        manualIssues = plan.manualIssues;
        log.info(`Rank Math optimization attempt ${attempt}/${ctx.settings.maxRankMathAttempts} (score ${score}, target ${target})`, plan);
        if (!planHasAutomaticFixes(plan)) {
          log.info('No safe automatic corrections are available for the remaining recommendations');
          break;
        }

        let changed = false;
        if (plan.seoTitle || plan.metaDescription || plan.slug) {
          await ctx.update({
            seoTitle: plan.seoTitle ?? t.seoTitle,
            metaDescription: plan.metaDescription ?? t.metaDescription,
            slug: plan.slug ?? t.slug,
          });
          await panel.setSnippet({ title: plan.seoTitle, description: plan.metaDescription, permalink: plan.slug });
          changed = true;
        }
        if (plan.contentIssues.length) {
          const revised = await reviseContentForRankMath(ctx, plan.contentIssues, correctionPromptKey);
          if (revised) {
            // ChatGPT may drop or move the internal link line — keep the one the article had.
            await ctx.update({ bodyHtml: withInternalLink(revised, extractInternalLink(ctx.task.bodyHtml ?? '').paragraph) });
            const assembled = assembleTaskContent(ctx.task);
            const contentHtml = assembled && transformContent ? await transformContent(ctx, assembled) : assembled;
            if (contentHtml) {
              await ctx.update({ contentHtml });
              await editor.setContent(contentHtml, headingCount(contentHtml));
              await runInternalSeoCheck(ctx.taskId, ctx.settings);
              await ctx.reload();
              changed = true;
            }
          }
        }
        if (!changed) break;

        await editor.saveDraft();
        await panel.open();
        score = await panel.readScore();
        issues = score !== null && score < target ? await panel.readFailedChecks() : [];
        log.info(`Rank Math score after attempt ${attempt}: ${score ?? 'not visible'}`, { issues });
        await saveRankMathReport(ctx, score, issues, attempt);
      }

      if (score === null) reasons.push('The Rank Math score was not visible in the editor.');
      else if (score < target) {
        reasons.push(`Rank Math score ${score} is below the target of ${target}.`);
        if (manualIssues.length) reasons.push(`Manual Rank Math suggestions: ${manualIssues.slice(0, 5).join(' | ')}`);
      }

      const saved = await editor.saveDraft();
      await ctx.update({ rankMathScore: score, reviewReasons: reasons, wpEditUrl: saved.editUrl, wpDraftSavedAt: new Date() });
      return { outcome: 'completed', data: { score, target } };
    },
  };
}
