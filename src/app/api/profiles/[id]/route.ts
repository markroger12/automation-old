import { z } from 'zod';
import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { enqueueControlJob } from '@/lib/queue';

export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(2).max(100) }));
  const profile = await prisma.browserProfile.update({ where: { id }, data: { name } });
  return { profile: { id: profile.id, name: profile.name } };
});

/** Deleting a profile removes its cookies/session directory — done by the worker that owns the browser. */
export const DELETE = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const profile = await prisma.browserProfile.findUnique({ where: { id } });
  if (!profile) throw new HttpError(404, 'Browser profile not found');
  if (profile.kind === 'CHATGPT') throw new HttpError(400, 'The ChatGPT profile cannot be deleted. Use "Reset Browser Session" instead.');
  const jobId = await enqueueControlJob({ action: 'delete-profile', profileId: id });
  return { jobId };
});
