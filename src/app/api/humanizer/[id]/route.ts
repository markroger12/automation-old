import { HttpError, param, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { HUMANIZER_QUEUE } from '@/lib/queue';

async function jobId(ctx: Parameters<typeof param>[0]): Promise<string> {
  const id = await param(ctx, 'id');
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new HttpError(400, 'Invalid job id');
  return id;
}

export const GET = route(async (_req, ctx) => {
  const job = await prisma.queueJob.findFirst({ where: { id: await jobId(ctx), queue: HUMANIZER_QUEUE } });
  if (!job) throw new HttpError(404, 'This humanizer test is gone (finished tests are kept for a day)');
  const result = (job.result ?? null) as Record<string, unknown> | null;
  const finished = job.status === 'COMPLETED';
  return {
    id: job.id,
    state: job.status.toLowerCase(),
    progress: !finished && typeof result?.progress === 'string' ? result.progress : null,
    result: finished ? result : null,
    error: job.error,
    input: job.data,
  };
});

/** Stops a waiting or running test; a prompt already in ChatGPT is withdrawn by the worker. */
export const DELETE = route(async (_req, ctx) => {
  await prisma.queueJob.updateMany({
    where: { id: await jobId(ctx), queue: HUMANIZER_QUEUE, status: { in: ['WAITING', 'ACTIVE'] } },
    data: { status: 'FAILED', error: 'Stopped on the Humanizer page', finishedAt: new Date() },
  });
  return { ok: true };
});
