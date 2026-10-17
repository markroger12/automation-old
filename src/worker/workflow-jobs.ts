// The two steps of a workflow that need a browser: handing a finished article to WordPress with its publish time,
// and asking Google Search Console to index it once it is live.
import type { BrowserManager } from '@/automation/browser/browser-manager';
import { LoginRequiredError } from '@/automation/errors';
import { requestIndexing } from '@/automation/google/search-console';
import { readSiteTimezone, schedulePost } from '@/automation/wordpress/schedule-post';
import { normalizeAdminUrl } from '@/automation/wordpress/wordpress-client';
import { prisma } from '@/lib/db';
import { createLogger, writeLog } from '@/lib/logger';
import { retryWorkflowJobLater, type WorkflowJobData } from '@/lib/queue';
import { localStamp, localStamp12, WORKFLOW_TIMEZONE } from '@/lib/workflow/time';
import path from 'node:path';
import { ensurePrivateDir, screenshotsRoot } from '@/lib/paths';

/** A quota that is used up is tried again this much later (Google counts a day). */
const QUOTA_RETRY_MS = 6 * 60 * 60 * 1000;
/** Any other problem asking Google is tried again this much later — not every minute. */
const INDEX_RETRY_MS = 30 * 60 * 1000;
/** How often Google is asked for one article before it is left with the reason. */
const MAX_INDEX_TRIES = 3;

const keywordWithEverything = (id: string) =>
  prisma.workflowKeyword.findUnique({
    where: { id },
    include: { workflow: { include: { website: { include: { profile: true } } } }, task: true },
  });

/** The post id of the article, from the task or from the address of its editor page. */
function postIdOf(task: { wpPostId: string | null; wpEditUrl: string | null } | null): string | null {
  if (task?.wpPostId) return task.wpPostId;
  const match = task?.wpEditUrl ? /[?&]post=(\d+)/.exec(task.wpEditUrl) : null;
  return match?.[1] ?? null;
}

async function scheduleArticle(keywordId: string, browser: BrowserManager): Promise<{ ok: boolean; message: string }> {
  const keyword = await keywordWithEverything(keywordId);
  if (!keyword) return { ok: false, message: 'The keyword is gone.' };
  const website = keyword.workflow.website;
  const logger = createLogger({ taskId: keyword.taskId, category: 'WORDPRESS', stage: 'WORKFLOW' });

  // The one place that may publish, and only because the website is set to allow it.
  if (!website.canPublish) return { ok: false, message: 'This website may not publish by itself.' };
  if (!website.profile) return { ok: false, message: 'This website has no browser profile to work in.' };
  const postId = postIdOf(keyword.task);
  if (!postId) return { ok: false, message: 'The article has no WordPress post yet.' };
  if (!keyword.publishAt) return { ok: false, message: 'The article has no publish time.' };

  const adminUrl = normalizeAdminUrl(website.url, website.adminUrl);
  const lease = await browser.acquire(website.profile);
  try {
    const page = await lease.newPage();
    // WordPress keeps its own time zone; the publish time is entered in that one.
    let timezone = website.siteTimezone;
    if (!timezone) {
      timezone = await readSiteTimezone(page, adminUrl);
      if (timezone) await prisma.website.update({ where: { id: website.id }, data: { siteTimezone: timezone } });
    }
    const localDate = `${localStamp(keyword.publishAt, timezone ?? WORKFLOW_TIMEZONE).replace(' ', 'T')}:00`;
    const result = await schedulePost(page, { adminUrl, postId, localDate, logger });
    // The tries from here on count the requests to Google only.
    await prisma.workflowKeyword.update({
      where: { id: keyword.id },
      data: { state: 'SCHEDULED', publishedUrl: result.link || null, lastError: null, attempts: 0 },
    });
    await writeLog({
      taskId: keyword.taskId,
      category: 'WORDPRESS',
      message: `Workflow: "${keyword.keyword}" is scheduled for ${localStamp12(keyword.publishAt, WORKFLOW_TIMEZONE)} PK (${localDate} on the website)`,
      data: { link: result.link },
    });
    return { ok: true, message: `Scheduled for ${localDate}` };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { lastError: message.slice(0, 500), attempts: { increment: 1 } } });
    await writeLog({ level: 'ERROR', taskId: keyword.taskId, category: 'WORDPRESS', message: `Workflow: "${keyword.keyword}" could not be scheduled — ${message}` });
    if (err instanceof LoginRequiredError) return { ok: false, message };
    throw err;
  } finally {
    await lease.release();
  }
}

async function indexArticle(keywordId: string, browser: BrowserManager): Promise<{ ok: boolean; message: string }> {
  const keyword = await keywordWithEverything(keywordId);
  if (!keyword) return { ok: false, message: 'The keyword is gone.' };
  if (keyword.state === 'INDEXED') return { ok: true, message: 'Indexing was already confirmed for this article.' };
  const website = keyword.workflow.website;
  const logger = createLogger({ taskId: keyword.taskId, category: 'BROWSER', stage: 'WORKFLOW' });
  const property = website.searchConsoleProperty;
  const url = keyword.publishedUrl;

  /** Tried again a little later; after a few times the keyword is left with the reason. */
  const failed = async (message: string) => {
    const attempts = keyword.attempts + 1;
    const giveUp = attempts >= MAX_INDEX_TRIES;
    await prisma.workflowKeyword.update({
      where: { id: keyword.id },
      data: { lastError: message.slice(0, 500), attempts, ...(giveUp ? { state: 'DONE' } : {}) },
    });
    if (!giveUp) await retryWorkflowJobLater({ action: 'request-indexing', keywordId }, new Date(Date.now() + INDEX_RETRY_MS));
    return { ok: false, message };
  };
  if (!property) return failed('No Search Console property is set for this website.');
  if (!url) return failed('The article has no address yet.');
  if (!website.profile) return failed('This website has no browser profile to work in.');

  const lease = await browser.acquire(website.profile);
  try {
    const evidenceFolder = path.join(screenshotsRoot(), 'workflow-indexing');
    await ensurePrivateDir(evidenceFolder);
    const relativeScreenshot = `workflow-indexing/${keyword.id}-${Date.now()}.png`;
    const result = await requestIndexing(await lease.newPage(), { property, url, logger, screenshotPath: path.join(screenshotsRoot(), relativeScreenshot) });
    await writeLog({
      taskId: keyword.taskId, category: 'BROWSER', stage: `INDEXING:${keyword.id}`, level: result.ok ? 'INFO' : 'WARN',
      message: result.message, screenshotPath: result.screenshotPath ? relativeScreenshot : null,
      data: { keywordId: keyword.id, url, outcome: result.outcome ?? (result.quotaReached ? 'quota' : 'unconfirmed') },
    });
    if (result.ok) {
      await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { state: 'INDEXED', indexedAt: new Date(), lastError: null, ...(result.outcome === 'requested' ? { attempts: { increment: 1 } } : {}) } });
      await writeLog({ taskId: keyword.taskId, category: 'BROWSER', message: `Workflow: "${keyword.keyword}" — ${result.message} (${url})` });
      return { ok: true, message: result.message };
    }
    await writeLog({
      level: 'WARN',
      taskId: keyword.taskId,
      category: 'BROWSER',
      message: `Workflow: "${keyword.keyword}" is live but was not sent for indexing — ${result.message}`,
    });
    // A used-up quota is not a mistake: it is tried again later today and does not count as a try.
    if (result.quotaReached) {
      await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { lastError: result.message.slice(0, 500) } });
      await retryWorkflowJobLater({ action: 'request-indexing', keywordId }, new Date(Date.now() + QUOTA_RETRY_MS));
      return { ok: false, message: result.message };
    }
    return await failed(result.message);
  } catch (err) {
    const message = (err as Error).message;
    await writeLog({ level: 'ERROR', taskId: keyword.taskId, category: 'BROWSER', message: `Workflow: indexing "${keyword.keyword}" failed — ${message}` });
    return await failed(message);
  } finally {
    await lease.release();
  }
}

export async function handleWorkflowJob(data: WorkflowJobData, browser: BrowserManager): Promise<{ ok: boolean; message: string }> {
  if (data.action === 'schedule-post') return scheduleArticle(data.keywordId, browser);
  if (data.action === 'request-indexing') return indexArticle(data.keywordId, browser);
  return { ok: false, message: `Unknown workflow action "${String(data.action)}"` };
}
