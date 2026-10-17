import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BrowserManager } from '@/automation/browser/browser-manager';
import { runPipeline } from '@/automation/pipeline/engine';
import { CHATGPT_EXTENSION_QUEUE } from '@/lib/chatgpt-extension';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { writeLog } from '@/lib/logger';
import { ensurePrivateDir, profilesRoot, screenshotsRoot } from '@/lib/paths';
import {
  ARTICLE_QUEUE,
  CONTROL_QUEUE,
  HUMANIZER_QUEUE,
  WORKFLOW_QUEUE,
  WORKER_HEARTBEAT_MS,
  WORKER_STATUS_ID,
  enqueueArticleJob,
  getArticleJobState,
  type ArticleJobData,
  type ControlJobData,
  type ControlJobResult,
  type HumanizerJobData,
  type WorkflowJobData,
} from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { ensureDefaultPrompts } from '@/lib/services/prompts';
import { IN_FLIGHT_STATUSES, type TaskStatusValue } from '@/lib/task-status';
import { PIPELINES } from '@/modules/pipelines.server';
import { handleControlJob } from './control';
import { handleHumanizerJob, type HumanizerJobResult } from './humanizer-job';
import { handleWorkflowJob } from './workflow-jobs';
import { runWorkflowTick } from './workflow-scheduler';
import { openExtensionChromeIfNeeded } from './extension-chrome';
import { JobRunner } from './job-runner';

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

function processIsAlive(pid: number | undefined): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Refuse to start a second worker: two workers would fight over the same Chrome profiles. */
async function assertSingleWorker(): Promise<void> {
  const status = await prisma.workerStatus.findUnique({ where: { id: WORKER_STATUS_ID } });
  const info = status?.info as { workerId?: string; pid?: number } | null;
  const recent = status && Date.now() - status.lastSeenAt.getTime() < WORKER_HEARTBEAT_MS * 2;
  // A heartbeat left behind by a worker that crashed or whose window was closed is ignored.
  if (recent && info?.workerId !== WORKER_ID && processIsAlive(info?.pid)) {
    throw new Error(
      `Another automation worker (pid ${info?.pid ?? '?'}) is already running. Stop it first — only one worker may use the browser profiles.`,
    );
  }
}

async function heartbeat(runners: JobRunner<unknown, unknown>[]): Promise<void> {
  const now = new Date();
  const info = { workerId: WORKER_ID, pid: process.pid, activeJobs: runners.reduce((n, r) => n + r.activeJobIds.length, 0) };
  await prisma.workerStatus.upsert({
    where: { id: WORKER_STATUS_ID },
    create: { id: WORKER_STATUS_ID, lastSeenAt: now, info },
    update: { lastSeenAt: now, info },
  });
  await Promise.all(runners.map((r) => r.heartbeat()));
}

/** Jobs left ACTIVE by a previous worker that stopped unexpectedly go back to the queue. */
async function recoverInterruptedJobs(): Promise<void> {
  const reset = await prisma.queueJob.updateMany({
    where: { queue: { in: [ARTICLE_QUEUE, CONTROL_QUEUE, WORKFLOW_QUEUE] }, status: 'ACTIVE', lockedBy: { not: WORKER_ID } },
    data: { status: 'WAITING', lockedBy: null },
  });
  if (reset.count) console.log(`[worker] re-queued ${reset.count} job(s) interrupted by a previous shutdown`);
  // Nobody waits for ChatGPT extension prompts of the previous worker; the re-run recovers answers from the conversation.
  // A Humanizer test that was running is not started again by itself: the page shows it failed, and Humanize runs it anew.
  await prisma.queueJob.updateMany({
    where: { OR: [{ queue: CHATGPT_EXTENSION_QUEUE, status: { in: ['WAITING', 'ACTIVE'] } }, { queue: HUMANIZER_QUEUE, status: 'ACTIVE' }] },
    data: { status: 'FAILED', error: 'The automation worker restarted', finishedAt: new Date() },
  });
}

/** Re-queues tasks that were queued/running when the previous worker stopped and have no job anymore. */
async function recoverOrphanedTasks(): Promise<void> {
  const tasks = await prisma.articleTask.findMany({
    where: { status: { in: IN_FLIGHT_STATUSES as TaskStatusValue[] } },
    select: { id: true, keyword: true },
  });
  for (const task of tasks) {
    if (await getArticleJobState(task.id)) continue;
    await prisma.articleTask.update({ where: { id: task.id }, data: { status: 'QUEUED', statusMessage: 'Re-queued after worker restart' } });
    await enqueueArticleJob({ taskId: task.id, mode: 'run' });
    await writeLog({ taskId: task.id, category: 'QUEUE', message: `Re-queued "${task.keyword}" after a worker restart` });
  }
}

async function cleanupOldJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.queueJob.deleteMany({ where: { status: { in: ['COMPLETED', 'FAILED'] }, finishedAt: { lt: cutoff } } });
}

async function main(): Promise<void> {
  const config = env();
  await prisma.$connect();
  // WAL lets the dashboard read while the worker writes (persistent setting on the database file).
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => undefined);
  await assertSingleWorker();

  await ensurePrivateDir(profilesRoot());
  await ensurePrivateDir(screenshotsRoot());
  await ensureDefaultPrompts();
  const settings = await getSettings();

  const browser = new BrowserManager({
    channel: config.BROWSER_CHANNEL,
    executablePath: config.BROWSER_EXECUTABLE_PATH || undefined,
    getBrowserSettings: async () => {
      const s = await getSettings();
      return { browserMode: s.browserMode, browserTimeoutSec: s.browserTimeoutSec };
    },
  });

  const articleRunner = new JobRunner<ArticleJobData, void>({
    queue: ARTICLE_QUEUE,
    label: 'article',
    workerId: WORKER_ID,
    concurrency: settings.taskConcurrency,
    handler: async (data) => {
      const task = await prisma.articleTask.findUnique({ where: { id: data.taskId }, select: { moduleKey: true } });
      if (!task) return;
      const pipeline = PIPELINES[task.moduleKey];
      if (!pipeline) {
        await prisma.articleTask.update({
          where: { id: data.taskId },
          data: { status: 'FAILED', error: `No workflow is registered for module "${task.moduleKey}"` },
        });
        return;
      }
      await runPipeline({ taskId: data.taskId, mode: data.mode, stage: data.stage, browser, pipeline });
    },
  });

  const controlRunner = new JobRunner<ControlJobData, ControlJobResult>({
    queue: CONTROL_QUEUE,
    label: 'control',
    workerId: WORKER_ID,
    concurrency: 4,
    pollIntervalMs: 500,
    handler: (data) => handleControlJob(data, browser),
  });

  // Scheduling an article in WordPress and sending it for indexing: one at a time, they share the browser profiles.
  const workflowRunner = new JobRunner<WorkflowJobData, { ok: boolean; message: string }>({
    queue: WORKFLOW_QUEUE,
    label: 'workflow',
    workerId: WORKER_ID,
    concurrency: 1,
    pollIntervalMs: 2000,
    handler: (data) => handleWorkflowJob(data, browser),
  });

  // The Humanizer test page: one rewrite at a time; its prompts wait in line with the articles' for a ChatGPT tab.
  const humanizerRunner = new JobRunner<HumanizerJobData, HumanizerJobResult>({
    queue: HUMANIZER_QUEUE,
    label: 'humanizer',
    workerId: WORKER_ID,
    concurrency: 1,
    pollIntervalMs: 1000,
    handler: (data, job) => handleHumanizerJob(data, job),
  });

  const runners = [articleRunner, controlRunner, workflowRunner, humanizerRunner] as JobRunner<unknown, unknown>[];
  await recoverInterruptedJobs();
  await heartbeat(runners);
  articleRunner.start();
  controlRunner.start();
  workflowRunner.start();
  humanizerRunner.start();

  const heartbeatTimer = setInterval(() => void heartbeat(runners).catch(() => undefined), WORKER_HEARTBEAT_MS);
  // Articles waiting for ChatGPT but the extension's Chrome is closed → open that Chrome profile.
  const extensionTimer = setInterval(
    () => void openExtensionChromeIfNeeded().catch((err) => console.error('[worker] could not open Chrome for the extension:', err.message)),
    15_000,
  );
  // The workflows of the websites: what has to be written, scheduled, published and indexed.
  const workflowTimer = setInterval(
    () => void runWorkflowTick().catch((err) => console.error('[worker] workflow round failed:', err.message)),
    60_000,
  );
  setTimeout(() => void runWorkflowTick().catch(() => undefined), 5_000);

  const maintenanceTimer = setInterval(async () => {
    try {
      const s = await getSettings();
      if (articleRunner.concurrency !== s.taskConcurrency) {
        articleRunner.concurrency = s.taskConcurrency;
        console.log(`[worker] task concurrency changed to ${s.taskConcurrency}`);
      }
      await cleanupOldJobs();
    } catch {
      /* database temporarily busy */
    }
  }, 30_000);

  await recoverOrphanedTasks().catch((err) => console.error('[worker] orphan recovery failed:', err.message));
  console.log(
    `[worker] ready — ChatGPT via Chrome extension, WordPress browser: ${config.BROWSER_EXECUTABLE_PATH || config.BROWSER_CHANNEL} (${settings.browserMode}), concurrency: ${settings.taskConcurrency}`,
  );
  await writeLog({ category: 'SYSTEM', message: 'Automation worker started' });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      console.log('[worker] forced exit');
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[worker] ${signal} received — waiting for running jobs to finish (press Ctrl+C again to force)`);
    clearInterval(heartbeatTimer);
    clearInterval(extensionTimer);
    clearInterval(maintenanceTimer);
    clearInterval(workflowTimer);
    await Promise.allSettled([articleRunner.close(), controlRunner.close(), workflowRunner.close(), humanizerRunner.close()]);
    await browser.closeAll();
    await prisma.workerStatus.delete({ where: { id: WORKER_STATUS_ID } }).catch(() => undefined);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('[worker] fatal:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
