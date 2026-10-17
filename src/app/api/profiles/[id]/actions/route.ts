import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { enqueueControlJob } from '@/lib/queue';
import { profileActionSchema } from '@/lib/validation';

/**
 * Session management: open login browser, test/refresh/reset session, close browser.
 * These run in the worker (which owns the browser); the UI polls /api/control-jobs/:id for the result.
 */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, profileActionSchema);
  const profile = await prisma.browserProfile.findUnique({ where: { id } });
  if (!profile) throw new HttpError(404, 'Browser profile not found');
  const jobId = await enqueueControlJob({ action: input.action, profileId: id, websiteId: input.websiteId ?? undefined });
  return { jobId };
});
