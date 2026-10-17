// The workflow of each website, one step at a time. Runs every minute in the worker.
//
//   WAITING   the keyword is in the list and has no time yet
//   WRITING   an article is being written for it (the normal pipeline)
//   READY     the article is finished and waiting to be scheduled in WordPress
//   SCHEDULED WordPress holds it and publishes it at its time
//   PUBLISHED it is live
//   INDEXED   Google has been asked to index it
//
// Nothing here opens a browser: the two steps that need one are put on the workflow queue.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { writeLog } from '@/lib/logger';
import { getSettings } from '@/lib/settings';
import { enqueueWorkflowJob } from '@/lib/queue';
import { createArticleTasks, performTaskAction } from '@/lib/services/tasks';
import { celebrityCategory, moduleForKind, type KeywordKindValue } from '@/lib/workflow/keyword-kind';
import { localStamp12, nextPublishSlots, WORKFLOW_TIMEZONE } from '@/lib/workflow/time';

/** How often a keyword is tried again before it is left alone. */
const MAX_ATTEMPTS = 3;
/** An article that is not finished by this long before its time loses the slot and takes the next one. */
const TOO_LATE_MS = 5 * 60 * 1000;
/**
 * How many articles of one website may be written ahead at the same time. Keywords are added by the hundred, and
 * ChatGPT would not get through them in one go — the rest follow as these are finished.
 */
const MAX_AHEAD = 10;

/**
 * Whether the article for a publish time should start being written now.
 * `writeAheadHours` of 0 means "as soon as the keyword is in the list", whatever its time is.
 */
export function startsNow(slot: Date, writeAheadHours: number, now: Date): boolean {
  if (writeAheadHours <= 0) return true;
  return slot.getTime() - writeAheadHours * 3600_000 <= now.getTime();
}
/** How long to wait for a scheduled article to really appear before saying something is wrong. */
const LIVE_GRACE_MS = 20 * 60 * 1000;

/** The address a page names as its own (`<link rel="canonical">`), when it is on the same site. */
export function canonicalAddress(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?canonical["'\s>/]/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) return null;
    try {
      const url = new URL(href.replace(/&amp;/g, '&'), pageUrl);
      return url.host === new URL(pageUrl).host ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The address of the article once it answers (a published article does, a scheduled one does not), else null.
 * WordPress gives a scheduled post only its short address (`/?p=123`); once live, that leads on to the real one —
 * which is the address Google must be given.
 */
async function liveAddress(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': 'BlogAutomationStudio/1.0 (publish check)' } });
    if (!response.ok) return null;
    return canonicalAddress(await response.text(), response.url) ?? response.url;
  } catch {
    return null;
  }
}

const pkt = (date: Date) => `${localStamp12(date, WORKFLOW_TIMEZONE)} PK`;

type WorkflowRow = Prisma.WorkflowGetPayload<{ include: { website: true } }>;

/** Everything that still has to happen, with the article it belongs to. */
const keywordsOf = (workflowId: string, states: string[]) =>
  prisma.workflowKeyword.findMany({
    where: { workflowId, state: { in: states as never } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { task: { select: { id: true, status: true, wpEditUrl: true, recommendedTitle: true, titleOptions: true, keyword: true } } },
  });

/** Puts a keyword back in the list so it takes the next free time, and says why in the log. */
async function pushToNextSlot(keyword: { id: string; keyword: string; attempts: number }, reason: string, workflow: WorkflowRow): Promise<void> {
  const attempts = keyword.attempts + 1;
  const giveUp = attempts >= MAX_ATTEMPTS;
  await prisma.workflowKeyword.update({
    where: { id: keyword.id },
    data: {
      attempts,
      lastError: reason.slice(0, 500),
      state: giveUp ? 'FAILED' : 'WAITING',
      publishAt: null,
    },
  });
  await writeLog({
    level: giveUp ? 'ERROR' : 'WARN',
    category: 'QUEUE',
    message: giveUp
      ? `Workflow ${workflow.website.name}: "${keyword.keyword}" was left out after ${attempts} tries — ${reason}`
      : `Workflow ${workflow.website.name}: "${keyword.keyword}" moves to the next free time — ${reason}`,
  });
}

/** Articles being written: approvals are given automatically, finished ones move on, failed ones try again later. */
async function advanceWriting(workflow: WorkflowRow): Promise<void> {
  for (const keyword of await keywordsOf(workflow.id, ['WRITING'])) {
    const task = keyword.task;
    if (!task) {
      await pushToNextSlot(keyword, 'Its article is gone.', workflow);
      continue;
    }
    switch (task.status) {
      // The workflow runs without stopping, so the gates are answered for it.
      case 'AWAITING_TITLE_APPROVAL': {
        const options = Array.isArray(task.titleOptions) ? (task.titleOptions as string[]) : [];
        const title = task.recommendedTitle || options[0] || task.keyword;
        await performTaskAction(task.id, { action: 'approve-title', title });
        await writeLog({ taskId: task.id, category: 'QUEUE', message: `Workflow: title approved by itself — ${title}` });
        break;
      }
      case 'AWAITING_ARTICLE_APPROVAL': {
        await performTaskAction(task.id, { action: 'approve-article' });
        await writeLog({ taskId: task.id, category: 'QUEUE', message: 'Workflow: article approved by itself' });
        break;
      }
      case 'DRAFT_CREATED':
      case 'NEEDS_REVIEW': {
        await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { state: 'READY', lastError: null } });
        break;
      }
      case 'FAILED':
      case 'CANCELLED': {
        await pushToNextSlot(keyword, `The article ${task.status === 'FAILED' ? 'failed' : 'was cancelled'}.`, workflow);
        break;
      }
      case 'LOGIN_REQUIRED': {
        // Nothing to do but say so: the article carries on once the login works again.
        await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { lastError: 'Waiting for a login (ChatGPT or WordPress).' } });
        break;
      }
      default:
        break;
    }
  }
}

/** Gives the keywords at the top of the list their publish time and starts writing them early enough. */
async function startWriting(workflow: WorkflowRow): Promise<void> {
  const open = await keywordsOf(workflow.id, ['WAITING']);
  if (!open.length) return;
  const now = new Date();
  const inFlight = await prisma.workflowKeyword.count({ where: { workflowId: workflow.id, state: { in: ['WRITING', 'READY'] } } });
  let room = MAX_AHEAD - inFlight;
  if (room <= 0) return;
  const taken = await prisma.workflowKeyword.findMany({
    where: { workflowId: workflow.id, publishAt: { not: null }, state: { in: ['WRITING', 'READY', 'SCHEDULED'] } },
    select: { publishAt: true },
  });
  const used = taken.map((row) => (row.publishAt as Date).getTime());
  const slots = nextPublishSlots({ times: workflow.publishTimes, days: workflow.days, from: now, count: open.length + used.length + 5 }).filter(
    (slot) => !used.some((time) => Math.abs(time - slot.getTime()) < 60_000),
  );
  // The Celebrity writer has no category step of its own, so its articles go in the website's celebrity category.
  const celebrity = celebrityCategory(await prisma.category.findMany({ where: { websiteId: workflow.websiteId }, orderBy: { name: 'asc' } }));

  for (const [index, keyword] of open.entries()) {
    const slot = slots[index];
    if (!slot) return;
    // Either a set time before it goes live, or straight away when the workflow is set to 0 hours.
    if (!startsNow(slot, workflow.writeAheadHours, now)) return;
    const kind = keyword.kind as KeywordKindValue;
    if (kind === 'UNKNOWN') {
      await prisma.workflowKeyword.update({
        where: { id: keyword.id },
        data: { lastError: 'Choose the writer for this keyword — the app could not tell.' },
      });
      continue;
    }
    const { tasks } = await createArticleTasks(
      [
        {
          // Celebrity keywords go to the writer chosen in Settings (Celebrity Writer 1.0 or 2.0).
          moduleKey: kind === 'CELEBRITY' ? (await getSettings()).workflowCelebrityWriter : moduleForKind(kind),
          keyword: keyword.keyword,
          secondaryKeywords: Array.isArray(keyword.secondaryKeywords) ? (keyword.secondaryKeywords as string[]) : [],
          websiteId: workflow.websiteId,
          categoryId: kind === 'CELEBRITY' ? (celebrity?.id ?? null) : null,
          // A Tigram article has ChatGPT pick one of the website's categories; a celebrity article on a website
          // without a celebrity category takes the website's default.
          autoCategory: kind !== 'CELEBRITY',
          exampleTitle: keyword.title,
          targetCountry: null,
          language: null,
        },
      ],
      null,
    );
    await prisma.workflowKeyword.update({
      where: { id: keyword.id },
      data: { state: 'WRITING', taskId: tasks[0].id, publishAt: slot, lastError: null },
    });
    await writeLog({
      taskId: tasks[0].id,
      category: 'QUEUE',
      message: `Workflow ${workflow.website.name}: writing "${keyword.keyword}" (${kind === 'CELEBRITY' ? 'celebrity' : 'Tigram'}) for ${pkt(slot)}`,
    });
    // More follow as these are finished.
    if (--room <= 0) return;
  }
}

/** Finished articles: WordPress is asked to hold them until their time. */
async function scheduleReady(workflow: WorkflowRow): Promise<void> {
  const ready = await keywordsOf(workflow.id, ['READY']);
  if (!ready.length) return;
  if (!workflow.website.canPublish) {
    await prisma.workflowKeyword.updateMany({
      where: { id: { in: ready.map((row) => row.id) }, lastError: null },
      data: { lastError: 'The article is a draft. Switch "This website may publish by itself" on to schedule it.' },
    });
    return;
  }
  const now = Date.now();
  for (const keyword of ready) {
    if (!keyword.task?.wpEditUrl) {
      await pushToNextSlot(keyword, 'The article has no WordPress draft.', workflow);
      continue;
    }
    // The time has passed while it was being written: it takes the next free one instead of going out late.
    if (!keyword.publishAt || keyword.publishAt.getTime() - now < TOO_LATE_MS) {
      const next = nextPublishSlots({ times: workflow.publishTimes, days: workflow.days, from: new Date(), count: 1 })[0];
      if (!next) continue;
      await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { publishAt: next } });
      await writeLog({
        level: 'WARN',
        category: 'QUEUE',
        message: `Workflow ${workflow.website.name}: "${keyword.keyword}" was not finished in time and now goes live at ${pkt(next)}`,
      });
      continue;
    }
    if (await enqueueWorkflowJob({ action: 'schedule-post', keywordId: keyword.id })) {
      await writeLog({ taskId: keyword.taskId, category: 'QUEUE', message: `Workflow: scheduling "${keyword.keyword}" for ${pkt(keyword.publishAt)}` });
    }
  }
}

/** Scheduled articles whose time has come: check they are live, then ask Google to index them. */
async function checkPublished(workflow: WorkflowRow): Promise<void> {
  const now = new Date();
  for (const keyword of await keywordsOf(workflow.id, ['SCHEDULED'])) {
    if (!keyword.publishAt || keyword.publishAt > now) continue;
    // WordPress publishes on its own clock, so the address is checked before Google is told about it.
    const address = keyword.publishedUrl ? await liveAddress(keyword.publishedUrl) : null;
    if (keyword.publishedUrl && !address) {
      const waited = now.getTime() - keyword.publishAt.getTime();
      if (waited < LIVE_GRACE_MS) continue;
      await prisma.workflowKeyword.update({
        where: { id: keyword.id },
        data: { lastError: 'WordPress has not published it yet — open the post and check its date.' },
      });
      await writeLog({
        level: 'WARN',
        category: 'WORDPRESS',
        message: `Workflow ${workflow.website.name}: "${keyword.keyword}" should be live since ${pkt(keyword.publishAt)} but its address does not answer yet`,
      });
      continue;
    }
    await prisma.workflowKeyword.update({
      where: { id: keyword.id },
      data: { state: 'PUBLISHED', publishedAt: keyword.publishAt, publishedUrl: address ?? keyword.publishedUrl, lastError: null },
    });
    await writeLog({ taskId: keyword.taskId, category: 'WORDPRESS', message: `Workflow ${workflow.website.name}: "${keyword.keyword}" is live` });
  }

  for (const keyword of await keywordsOf(workflow.id, ['PUBLISHED'])) {
    if (!workflow.indexAfterPublish || !workflow.website.searchConsoleProperty) {
      await prisma.workflowKeyword.update({ where: { id: keyword.id }, data: { state: 'DONE' } });
      continue;
    }
    await enqueueWorkflowJob({ action: 'request-indexing', keywordId: keyword.id });
  }
}

/** One round for every workflow that is switched on. */
export async function runWorkflowTick(): Promise<void> {
  const workflows = await prisma.workflow.findMany({ where: { isActive: true }, include: { website: true } });
  for (const workflow of workflows) {
    if (!workflow.website.isActive) continue;
    try {
      await advanceWriting(workflow);
      await startWriting(workflow);
      await scheduleReady(workflow);
      await checkPublished(workflow);
    } catch (err) {
      console.error(`[worker] workflow for ${workflow.website.name} failed: ${(err as Error).message}`);
      await writeLog({ level: 'ERROR', category: 'QUEUE', message: `Workflow ${workflow.website.name} failed: ${(err as Error).message}` }).catch(() => undefined);
    }
  }
}
