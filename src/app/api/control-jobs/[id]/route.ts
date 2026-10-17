import { HttpError, param, route } from '@/lib/api';
import { getControlJob } from '@/lib/queue';

export const GET = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new HttpError(400, 'Invalid job id');
  const job = await getControlJob(id);
  if (!job) throw new HttpError(404, 'Job not found (it may have expired)');
  return job;
});
