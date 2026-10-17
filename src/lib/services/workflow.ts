// One workflow per website: the keyword list, the times its articles go live, and what the app does with each
// keyword. The worker picks the work up from here (see src/worker/workflow-scheduler.ts).
import type { KeywordState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { HttpError } from '@/lib/http-error';
import { parseKeywordLines, type KeywordLine } from '@/lib/workflow/keyword-lines';

export { parseKeywordLines, type KeywordLine };
import { detectKeywordKind, type KeywordKindValue } from '@/lib/workflow/keyword-kind';
import { formatTime, nextPublishSlots, parseTimes } from '@/lib/workflow/time';
import { enqueueWorkflowJob, WORKFLOW_QUEUE } from '@/lib/queue';

/** The times the articles of a new workflow go live, until they are changed. */
export const DEFAULT_PUBLISH_TIMES = ['04:00', '04:30', '05:00', '05:30', '06:00'];

/** Keywords that still have to be written, in the order they will be taken. */
export const OPEN_STATES: KeywordState[] = ['WAITING', 'WRITING', 'READY'];

export const workflowInclude = {
  website: { select: { id: true, name: true, url: true, canPublish: true, siteTimezone: true, searchConsoleProperty: true, isActive: true } },
} satisfies Prisma.WorkflowInclude;

/** Every website with its workflow (websites without one are listed too, so it can be switched on). */
export async function listWorkflows() {
  const websites = await prisma.website.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      url: true,
      isActive: true,
      canPublish: true,
      siteTimezone: true,
      searchConsoleProperty: true,
      tigramImages: true,
      workflow: { select: { id: true, isActive: true, publishTimes: true, days: true, writeAheadHours: true, images: true, indexAfterPublish: true } },
    },
  });
  const counts = await prisma.workflowKeyword.groupBy({ by: ['workflowId', 'state'], _count: { _all: true } });
  return websites.map((website) => ({
    ...website,
    counts: Object.fromEntries(
      counts.filter((row) => row.workflowId === website.workflow?.id).map((row) => [row.state, row._count._all]),
    ) as Record<string, number>,
  }));
}

/** The workflow of a website, made on first use. */
export async function ensureWorkflow(websiteId: string) {
  const website = await prisma.website.findUnique({ where: { id: websiteId }, select: { id: true } });
  if (!website) throw new HttpError(404, 'Website not found');
  return prisma.workflow.upsert({
    where: { websiteId },
    create: { websiteId, publishTimes: DEFAULT_PUBLISH_TIMES },
    update: {},
    include: workflowInclude,
  });
}

export async function getWorkflow(id: string) {
  const workflow = await prisma.workflow.findUnique({ where: { id }, include: workflowInclude });
  if (!workflow) throw new HttpError(404, 'Workflow not found');
  return workflow;
}

export interface WorkflowSettings {
  isActive?: boolean;
  publishTimes?: string[];
  days?: number[];
  writeAheadHours?: number;
  images?: boolean | null;
  indexAfterPublish?: boolean;
}

export async function updateWorkflow(id: string, settings: WorkflowSettings) {
  const data: Prisma.WorkflowUpdateInput = {};
  if (settings.isActive !== undefined) data.isActive = settings.isActive;
  if (settings.publishTimes !== undefined) {
    const times = parseTimes(settings.publishTimes).map(formatTime);
    if (!times.length) throw new HttpError(400, 'Add at least one publish time, for example 04:00.');
    data.publishTimes = times;
  }
  if (settings.days !== undefined) data.days = [...new Set(settings.days.filter((day) => day >= 0 && day <= 6))].sort();
  if (settings.writeAheadHours !== undefined) data.writeAheadHours = Math.min(72, Math.max(0, settings.writeAheadHours));
  if (settings.images !== undefined) data.images = settings.images;
  if (settings.indexAfterPublish !== undefined) data.indexAfterPublish = settings.indexAfterPublish;
  // Switching a workflow on only makes sense once it has times and keywords.
  if (data.isActive === true) {
    const workflow = await getWorkflow(id);
    const times = parseTimes((data.publishTimes as string[]) ?? workflow.publishTimes);
    if (!times.length) throw new HttpError(400, 'Add at least one publish time before switching the workflow on.');
    const waiting = await prisma.workflowKeyword.count({ where: { workflowId: id, state: { in: OPEN_STATES } } });
    if (!waiting) throw new HttpError(400, 'Add keywords before switching the workflow on.');
  }
  return prisma.workflow.update({ where: { id }, data, include: workflowInclude });
}

/** Adds keywords to the end of the list, skipping the ones that are already there. */
export async function addKeywordLines(workflowId: string, lines: KeywordLine[]): Promise<{ added: number; skipped: number }> {
  if (!lines.length) return { added: 0, skipped: 0 };
  const existing = await prisma.workflowKeyword.findMany({ where: { workflowId }, select: { keyword: true } });
  const known = new Set(existing.map((row) => row.keyword.toLowerCase()));
  const fresh = lines.filter((line) => !known.has(line.keyword.toLowerCase()));
  const last = await prisma.workflowKeyword.aggregate({ where: { workflowId }, _max: { position: true } });
  let position = (last._max.position ?? 0) + 1;
  for (const line of fresh) {
    await prisma.workflowKeyword.create({
      data: {
        workflowId,
        keyword: line.keyword,
        title: line.title || null,
        secondaryKeywords: line.secondaryKeywords,
        position: position++,
        // A kind given in the file is treated as chosen by hand, so the detection leaves it alone.
        ...(line.kind && line.kind !== 'UNKNOWN' ? { kind: line.kind, kindSource: 'manual', kindNote: 'It was set in the file you uploaded.' } : {}),
      },
    });
  }
  return { added: fresh.length, skipped: lines.length - fresh.length };
}

/** Adds the lines of the keyword box to the end of the list. */
export const addKeywords = (workflowId: string, text: string) => addKeywordLines(workflowId, parseKeywordLines(text));

/** Works out which writer each keyword belongs to. Only keywords nobody has set by hand are touched. */
export async function detectKinds(workflowId: string, limit = 60): Promise<{ checked: number; celebrity: number; tigram: number; unknown: number }> {
  const keywords = await prisma.workflowKeyword.findMany({
    where: { workflowId, kind: 'UNKNOWN', kindSource: null },
    orderBy: { position: 'asc' },
    take: limit,
    select: { id: true, keyword: true },
  });
  const result = { checked: 0, celebrity: 0, tigram: 0, unknown: 0 };
  for (const row of keywords) {
    const guess = await detectKeywordKind(row.keyword);
    await prisma.workflowKeyword.update({
      where: { id: row.id },
      // A guess nobody could make stays open, but is not asked again on the next run.
      data: { kind: guess.kind, kindSource: guess.kind === 'UNKNOWN' ? null : guess.source, kindNote: guess.note },
    });
    result.checked++;
    if (guess.kind === 'CELEBRITY') result.celebrity++;
    else if (guess.kind === 'TIGRAM') result.tigram++;
    else result.unknown++;
  }
  return result;
}

export interface KeywordPatch {
  keyword?: string;
  title?: string | null;
  kind?: KeywordKindValue;
  state?: 'WAITING' | 'SKIPPED';
  position?: number;
}

export async function updateKeyword(workflowId: string, id: string, patch: KeywordPatch) {
  const existing = await prisma.workflowKeyword.findFirst({ where: { id, workflowId } });
  if (!existing) throw new HttpError(404, 'Keyword not found');
  const data: Prisma.WorkflowKeywordUpdateInput = {};
  if (patch.keyword !== undefined) data.keyword = patch.keyword.trim().slice(0, 200);
  if (patch.title !== undefined) data.title = patch.title ? patch.title.trim().slice(0, 300) : null;
  if (patch.kind !== undefined) {
    data.kind = patch.kind;
    data.kindSource = patch.kind === 'UNKNOWN' ? null : 'manual';
    data.kindNote = patch.kind === 'UNKNOWN' ? null : 'You chose this writer.';
  }
  if (patch.state !== undefined) {
    // Only the two states a person sets themselves; the rest belong to the worker.
    if (!['WAITING', 'SKIPPED'].includes(patch.state)) throw new HttpError(400, 'This state cannot be set by hand');
    data.state = patch.state;
    if (patch.state === 'WAITING') data.lastError = null;
  }
  if (patch.position !== undefined) data.position = patch.position;
  return prisma.workflowKeyword.update({ where: { id }, data });
}

export async function deleteKeywords(workflowId: string, ids: string[]): Promise<number> {
  const { count } = await prisma.workflowKeyword.deleteMany({ where: { workflowId, id: { in: ids }, state: { notIn: ['WRITING', 'SCHEDULED'] } } });
  return count;
}

export interface PlannedKeyword {
  id: string;
  keyword: string;
  kind: string;
  state: string;
  publishAt: string | null;
  plannedFor: string | null;
}

/**
 * The keyword list of one workflow with the plan behind it: what is already scheduled keeps its time, everything
 * else gets the next free publish moments, so the page can show what happens when.
 */
export async function workflowKeywords(workflowId: string, options: { limit?: number } = {}) {
  const workflow = await getWorkflow(workflowId);
  const keywords = await prisma.workflowKeyword.findMany({
    where: { workflowId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: options.limit ?? 500,
    include: { task: { select: { id: true, status: true, moduleKey: true, wpEditUrl: true } } },
  });
  const taken = keywords.filter((row) => row.publishAt).map((row) => row.publishAt as Date);
  const open = keywords.filter((row) => !row.publishAt && ['WAITING', 'WRITING', 'READY'].includes(row.state));
  const slots = nextPublishSlots({
    times: workflow.publishTimes,
    days: workflow.days,
    // Free moments only: one article per publish time.
    from: new Date(),
    count: open.length + taken.length + 5,
  }).filter((slot) => !taken.some((used) => Math.abs(used.getTime() - slot.getTime()) < 60_000));

  const plan = new Map<string, Date>();
  open.forEach((row, index) => {
    const slot = slots[index];
    if (slot) plan.set(row.id, slot);
  });
  const logs = await prisma.log.findMany({
    where: { stage: { in: keywords.map((row) => `INDEXING:${row.id}`) } },
    orderBy: { createdAt: 'desc' }, distinct: ['stage'],
    select: { stage: true, message: true, screenshotPath: true, data: true, createdAt: true },
  });
  const evidence = new Map(logs.map((log) => [log.stage, {
    message: log.message, screenshotPath: log.screenshotPath, capturedAt: log.createdAt,
    outcome: (log.data as { outcome?: string } | null)?.outcome ?? null,
  }]));
  return { workflow, keywords: keywords.map((row) => ({ ...row, indexingEvidence: evidence.get(`INDEXING:${row.id}`) ?? null })), plan };
}

/** Retry indexing only: never rewrite, reschedule or republish the article. */
export async function requestWorkflowIndexing(workflowId: string, keywordId: string) {
  const keyword = await prisma.workflowKeyword.findFirst({ where: { id: keywordId, workflowId }, include: { workflow: { include: { website: true } } } });
  if (!keyword) throw new HttpError(404, 'Keyword not found');
  if (!keyword.publishedUrl || !['PUBLISHED', 'DONE', 'INDEXED'].includes(keyword.state)) throw new HttpError(400, 'The article must already be published.');
  if (!keyword.workflow.website.searchConsoleProperty) throw new HttpError(400, 'Set the website’s Search Console property first.');
  if (keyword.state === 'INDEXED') return { message: 'Indexing was already confirmed. See the saved screenshot.' };
  const data = { action: 'request-indexing' as const, keywordId };
  const existing = await prisma.queueJob.findFirst({ where: { queue: WORKFLOW_QUEUE, name: data.action, status: { in: ['WAITING', 'ACTIVE'] }, data: { equals: data } } });
  if (existing?.status === 'ACTIVE') return { message: 'Search Console is already checking this article.' };
  await prisma.workflowKeyword.update({ where: { id: keywordId }, data: { state: 'PUBLISHED', lastError: null, attempts: 0 } });
  if (existing) await prisma.queueJob.update({ where: { id: existing.id }, data: { runAt: new Date() } });
  else await enqueueWorkflowJob(data);
  return { message: 'Indexing check queued. The confirmation screenshot will appear here.' };
}
