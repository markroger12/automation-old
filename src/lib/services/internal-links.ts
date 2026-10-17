// Internal link at the end of each article: "<line of the website> <previous article of the same website>".
import * as cheerio from 'cheerio';
import type { ArticleTask, Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { contentLocale } from '@/lib/content-locale';
import { normalizeWhitespace, slugify } from '@/lib/utils';
import type { InternalLink } from '@/content/internal-link';

/** Setting row holding { websiteId: line } — each website has its own line ("Das könnte Ihnen gefallen:"). */
export const INTERNAL_LINK_LINES_SETTING = 'websiteInternalLinkLines';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function getInternalLinkLines(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: INTERNAL_LINK_LINES_SETTING } });
  const value = row?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''));
}

/** Saves the line for one website; an empty line switches the internal link off for that website. */
export async function setInternalLinkLine(websiteId: string, line: string | null | undefined): Promise<void> {
  const lines = await getInternalLinkLines();
  const clean = normalizeWhitespace(line ?? '');
  if (clean) lines[websiteId] = clean;
  else delete lines[websiteId];
  await prisma.setting.upsert({
    where: { key: INTERNAL_LINK_LINES_SETTING },
    create: { key: INTERNAL_LINK_LINES_SETTING, value: lines as Prisma.InputJsonValue },
    update: { value: lines as Prisma.InputJsonValue },
  });
}

export interface FeedPost {
  title: string;
  url: string;
  postId: string | null;
}

/** Newest published posts of a WordPress site, read from its public feed (/feed/). Empty when it cannot be read. */
export async function readSiteFeed(siteUrl: string, fetchImpl: FetchLike = fetch): Promise<FeedPost[]> {
  try {
    const res = await fetchImpl(`${siteUrl.replace(/\/+$/, '')}/feed/`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36',
        accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xml: true });
    return $('item')
      .toArray()
      .map((item) => {
        const el = $(item);
        return {
          title: normalizeWhitespace(el.children('title').first().text()),
          url: el.children('link').first().text().trim(),
          postId: /[?&]p=(\d+)/.exec(el.children('guid').first().text())?.[1] ?? null,
        };
      })
      .filter((post) => post.title && /^https?:\/\//i.test(post.url));
  } catch {
    return [];
  }
}

type LinkTask = Pick<ArticleTask, 'id' | 'websiteId' | 'createdAt'>;
type EarlierTask = Pick<ArticleTask, 'id' | 'keyword' | 'status' | 'selectedTitle' | 'recommendedTitle' | 'slug' | 'language' | 'wpPostId'>;

export interface InternalLinkResult {
  link: InternalLink | null;
  /** True when the website has no internal link line (the feature is off for it). */
  disabled: boolean;
  note: string;
}

export interface ResolveInternalLinkOptions {
  fetch?: FetchLike;
  /** How long to wait for the previous article's title while it is still being written. */
  waitMs?: number;
  pollMs?: number;
  onWait?: (keyword: string) => void;
  shouldStop?: () => Promise<boolean>;
}

// A task in one of these states will not get a title soon — do not wait for it.
const NOT_PROGRESSING: TaskStatus[] = ['QUEUED', 'LOGIN_REQUIRED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW', 'DRAFT_CREATED', 'AWAITING_TITLE_APPROVAL'];

const titleOf = (task: EarlierTask) => task.selectedTitle ?? task.recommendedTitle ?? null;

/**
 * Finds the article this task should link to: the previous article for the same website — by publish time for an
 * article of a workflow, otherwise by the order they were added. With no earlier article in the app, the newest post
 * of the website is used. The link uses the published address from the website feed when the post is live, otherwise
 * the address its slug will have.
 */
export async function resolveInternalLink(task: LinkTask, options: ResolveInternalLinkOptions = {}): Promise<InternalLinkResult> {
  if (!task.websiteId) return { link: null, disabled: true, note: 'the article has no website' };
  const [website, lines] = await Promise.all([prisma.website.findUnique({ where: { id: task.websiteId } }), getInternalLinkLines()]);
  if (!website) return { link: null, disabled: true, note: 'the website was not found' };
  const line = lines[website.id];
  if (!line) return { link: null, disabled: true, note: `no internal link line is set for ${website.name}` };

  const select = { id: true, keyword: true, status: true, selectedTitle: true, recommendedTitle: true, slug: true, language: true, wpPostId: true } as const;
  // An article of a workflow links to the article that goes live just before it on the website — the publishing
  // order, which is not always the order the articles were added in. Every other article follows the adding order.
  const slot = await prisma.workflowKeyword.findFirst({ where: { taskId: task.id, publishAt: { not: null } }, select: { publishAt: true } });
  const earlier: EarlierTask[] = slot?.publishAt
    ? (
        await prisma.workflowKeyword.findMany({
          where: {
            workflow: { websiteId: website.id },
            publishAt: { lt: slot.publishAt },
            state: { notIn: ['FAILED', 'SKIPPED'] },
            task: { id: { not: task.id }, status: { not: 'CANCELLED' } },
          },
          orderBy: { publishAt: 'desc' },
          take: 20,
          select: { task: { select } },
        })
      ).flatMap((row) => (row.task ? [row.task] : []))
    : await prisma.articleTask.findMany({
        where: {
          websiteId: website.id,
          id: { not: task.id },
          status: { not: 'CANCELLED' },
          OR: [{ createdAt: { lt: task.createdAt } }, { createdAt: task.createdAt, id: { lt: task.id } }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select,
      });

  // The previous article is usually still being written when several run at once: wait for its title.
  const previous = earlier[0];
  if (previous && !titleOf(previous) && !NOT_PROGRESSING.includes(previous.status) && options.waitMs) {
    options.onWait?.(previous.keyword);
    const deadline = Date.now() + options.waitMs;
    while (Date.now() < deadline && !(await options.shouldStop?.())) {
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 15_000));
      const fresh = await prisma.articleTask.findUnique({ where: { id: previous.id }, select });
      if (!fresh) break;
      earlier[0] = fresh;
      if (titleOf(fresh) || NOT_PROGRESSING.includes(fresh.status)) break;
    }
  }

  const feed = await readSiteFeed(website.url, options.fetch);
  const siteUrl = website.url.replace(/\/+$/, '');
  for (const candidate of earlier) {
    const title = titleOf(candidate);
    if (!title) continue;
    const published = candidate.wpPostId ? feed.find((post) => post.postId === candidate.wpPostId) : undefined;
    const skipped = earlier.indexOf(candidate);
    const note = `previous article "${candidate.keyword}"${skipped ? ` (${skipped} newer article(s) without a title skipped)` : ''}`;
    if (published) return { link: { line, url: published.url, title: published.title }, disabled: false, note: `${note}, published` };
    const slug = candidate.slug || slugify(candidate.keyword, 75, contentLocale(candidate.language));
    return { link: { line, url: `${siteUrl}/${slug}/`, title }, disabled: false, note };
  }

  // First article for this website: link the newest post that is not one of the app's own articles.
  const ownPosts = await prisma.articleTask.findMany({ where: { websiteId: website.id, wpPostId: { not: null } }, select: { wpPostId: true } });
  const own = new Set(ownPosts.map((t) => t.wpPostId));
  const newest = feed.find((post) => !post.postId || !own.has(post.postId));
  if (newest) return { link: { line, url: newest.url, title: newest.title }, disabled: false, note: 'newest post on the website (no earlier article in the app)' };
  return { link: null, disabled: false, note: `no earlier article found and the feed of ${siteUrl} could not be read` };
}
