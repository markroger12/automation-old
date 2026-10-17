// Built-in job queue stored in the database (no Redis needed).
// The web app adds jobs; the worker process claims and runs them (see src/worker/job-runner.ts).
import type { Prisma } from '@prisma/client';
import { prisma } from './db';

export const ARTICLE_QUEUE = 'article';
export const CONTROL_QUEUE = 'control';
/** Browser work a workflow needs: scheduling a finished article and asking Google to index it. */
export const WORKFLOW_QUEUE = 'workflow';

export type ArticleJobMode = 'run' | 'regenerate';

export interface ArticleJobData {
  taskId: string;
  mode: ArticleJobMode;
  /** Stage key when mode = regenerate */
  stage?: string;
}

export const CONTROL_ACTIONS = [
  'open-login',
  'open-browser',
  'test-session',
  'refresh-session',
  'reset-session',
  'delete-profile',
  'close-browser',
  'sync-categories',
  'open-chatgpt-chrome',
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export interface ControlJobData {
  action: ControlAction;
  profileId: string;
  websiteId?: string;
  url?: string;
}

export interface ControlJobResult {
  ok: boolean;
  message: string;
  loggedIn?: boolean;
  resumedTasks?: number;
  categories?: number;
}

/**
 * Enqueue a task. One job per task at a time: if a job for the task is already waiting or
 * running, nothing is added (prevents duplicate generation of the same article).
 */
export async function enqueueArticleJob(data: ArticleJobData): Promise<{ queued: boolean; reason?: string }> {
  const existing = await prisma.queueJob.findFirst({
    where: { queue: ARTICLE_QUEUE, taskId: data.taskId, status: { in: ['WAITING', 'ACTIVE'] } },
    select: { status: true },
  });
  if (existing) {
    return { queued: false, reason: `A job for this task is already ${existing.status === 'ACTIVE' ? 'running' : 'queued'}` };
  }
  await prisma.queueJob.create({
    data: { queue: ARTICLE_QUEUE, name: data.mode, taskId: data.taskId, data: data as unknown as Prisma.InputJsonValue },
  });
  return { queued: true };
}

/** 'active' | 'waiting' when the task has a pending job, otherwise null. */
export async function getArticleJobState(taskId: string): Promise<'active' | 'waiting' | null> {
  const job = await prisma.queueJob.findFirst({
    where: { queue: ARTICLE_QUEUE, taskId, status: { in: ['WAITING', 'ACTIVE'] } },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (!job) return null;
  return job.status === 'ACTIVE' ? 'active' : 'waiting';
}

/** Removes a waiting job. Returns false when the job is currently running. */
export async function removeWaitingArticleJob(taskId: string): Promise<boolean> {
  if ((await getArticleJobState(taskId)) === 'active') return false;
  await prisma.queueJob.deleteMany({ where: { queue: ARTICLE_QUEUE, taskId, status: 'WAITING' } });
  return true;
}

export type WorkflowAction = 'schedule-post' | 'request-indexing';

export interface WorkflowJobData {
  action: WorkflowAction;
  /** The keyword of the workflow this job belongs to. */
  keywordId: string;
}

/** Adds workflow browser work. One job per keyword and action at a time. */
export async function enqueueWorkflowJob(data: WorkflowJobData): Promise<boolean> {
  const existing = await prisma.queueJob.findFirst({
    where: { queue: WORKFLOW_QUEUE, name: data.action, status: { in: ['WAITING', 'ACTIVE'] }, data: { equals: data as unknown as Prisma.InputJsonValue } },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.queueJob.create({ data: { queue: WORKFLOW_QUEUE, name: data.action, data: data as unknown as Prisma.InputJsonValue } });
  return true;
}

/**
 * Puts the same workflow work back on the queue for later, from inside the job that is running it now — that job is
 * still ACTIVE, so only a waiting copy counts as a duplicate. While it waits, the workflow round adds no other one.
 */
export async function retryWorkflowJobLater(data: WorkflowJobData, runAt: Date): Promise<void> {
  const waiting = await prisma.queueJob.findFirst({
    where: { queue: WORKFLOW_QUEUE, name: data.action, status: 'WAITING', data: { equals: data as unknown as Prisma.InputJsonValue } },
    select: { id: true },
  });
  if (waiting) return;
  await prisma.queueJob.create({ data: { queue: WORKFLOW_QUEUE, name: data.action, data: data as unknown as Prisma.InputJsonValue, runAt } });
}

/** The Humanizer test page: one article checked and rewritten through ChatGPT (src/content/humanizer). */
export const HUMANIZER_QUEUE = 'humanizer';

export interface HumanizerJobData {
  input: string;
  keyword?: string;
  /** The rewrite prompt as edited on the page (empty: the built-in one). */
  prompt?: string;
  rewriteAll?: boolean;
}

export async function enqueueControlJob(data: ControlJobData): Promise<string> {
  const job = await prisma.queueJob.create({
    data: { queue: CONTROL_QUEUE, name: data.action, data: data as unknown as Prisma.InputJsonValue },
  });
  return job.id;
}

export async function getControlJob(
  id: string,
): Promise<{ state: 'waiting' | 'active' | 'completed' | 'failed'; result: ControlJobResult | null; error: string | null } | null> {
  const job = await prisma.queueJob.findFirst({ where: { id, queue: CONTROL_QUEUE } });
  if (!job) return null;
  return {
    state: job.status.toLowerCase() as 'waiting' | 'active' | 'completed' | 'failed',
    result: (job.result as unknown as ControlJobResult | null) ?? null,
    error: job.error,
  };
}

/** The worker writes a heartbeat every few seconds; the dashboard uses it to show whether automation is running. */
export const WORKER_STATUS_ID = 'main';
export const WORKER_HEARTBEAT_MS = 10_000;

export async function isWorkerOnline(): Promise<boolean> {
  const status = await prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } });
  return Boolean(status && Date.now() - status.lastSeenAt.getTime() < WORKER_HEARTBEAT_MS * 4);
}
