import type { Prisma, QueueJob } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface JobRunnerOptions<TData, TResult> {
  queue: string;
  workerId: string;
  concurrency: number;
  handler: (data: TData, job: QueueJob) => Promise<TResult>;
  pollIntervalMs?: number;
  label?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Processes jobs from the database-backed queue. Jobs are claimed with a conditional update
 * (WAITING → ACTIVE), so a job can never be picked up twice. Jobs for the same article task never
 * run at the same time.
 */
export class JobRunner<TData, TResult> {
  private readonly running = new Map<string, Promise<void>>();
  private stopped = false;
  private loopPromise: Promise<void> | null = null;
  concurrency: number;

  constructor(private readonly opts: JobRunnerOptions<TData, TResult>) {
    this.concurrency = opts.concurrency;
  }

  get activeJobIds(): string[] {
    return Array.from(this.running.keys());
  }

  start(): void {
    this.loopPromise ??= this.loop();
  }

  private async loop(): Promise<void> {
    const interval = this.opts.pollIntervalMs ?? 1000;
    while (!this.stopped) {
      try {
        while (!this.stopped && this.running.size < this.concurrency) {
          const job = await this.claim();
          if (!job) break;
          this.execute(job);
        }
      } catch (err) {
        console.error(`[worker:${this.opts.label ?? this.opts.queue}] queue poll failed: ${(err as Error).message}`);
      }
      await sleep(interval);
    }
  }

  private async claim(): Promise<QueueJob | null> {
    const candidates = await prisma.queueJob.findMany({
      // A job can carry a time it may not start before (the workflow schedules work ahead).
      where: { queue: this.opts.queue, status: 'WAITING', OR: [{ runAt: null }, { runAt: { lte: new Date() } }] },
      orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
    });
    for (const candidate of candidates) {
      if (candidate.taskId) {
        const busy = await prisma.queueJob.count({ where: { queue: this.opts.queue, taskId: candidate.taskId, status: 'ACTIVE' } });
        if (busy) continue;
      }
      const now = new Date();
      const claimed = await prisma.queueJob.updateMany({
        where: { id: candidate.id, status: 'WAITING' },
        data: { status: 'ACTIVE', lockedBy: this.opts.workerId, startedAt: now, heartbeatAt: now, attempts: { increment: 1 } },
      });
      if (claimed.count === 1) return { ...candidate, status: 'ACTIVE' };
    }
    return null;
  }

  private execute(job: QueueJob): void {
    const work = (async () => {
      try {
        const result = await this.opts.handler(job.data as unknown as TData, job);
        await prisma.queueJob
          .update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              finishedAt: new Date(),
              ...(result === undefined ? {} : { result: result as unknown as Prisma.InputJsonValue }),
            },
          })
          .catch(() => undefined); // job row may have been removed (e.g. task deleted)
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        console.error(`[worker:${this.opts.label ?? this.opts.queue}] job ${job.id} (${job.name}) failed: ${message}`);
        await prisma.queueJob
          .update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 2000) } })
          .catch(() => undefined);
      } finally {
        this.running.delete(job.id);
      }
    })();
    this.running.set(job.id, work);
  }

  /** Marks running jobs as alive (used to detect jobs abandoned by a crashed worker). */
  async heartbeat(): Promise<void> {
    const ids = this.activeJobIds;
    if (ids.length) await prisma.queueJob.updateMany({ where: { id: { in: ids } }, data: { heartbeatAt: new Date() } });
  }

  /** Stops claiming new jobs and waits for running ones to finish. */
  async close(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled(Array.from(this.running.values()));
    await this.loopPromise?.catch(() => undefined);
  }
}
