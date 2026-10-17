import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError, parseBody, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { HUMANIZER_QUEUE, type HumanizerJobData } from '@/lib/queue';

const startSchema = z.object({
  input: z.string().trim().min(40, 'Paste an article of at least a few sentences').max(300_000, 'The article is too long'),
  keyword: z.string().trim().max(200).optional(),
  prompt: z.string().max(20_000).optional(),
  rewriteAll: z.boolean().optional(),
});

/** Articles that can be loaded into the Humanizer, and a test that is still running (so a reload picks it up). */
export const GET = route(async () => {
  const [articles, running] = await Promise.all([
    prisma.articleTask.findMany({
      where: { OR: [{ contentHtml: { not: null } }, { bodyHtml: { not: null } }] },
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: { id: true, keyword: true, status: true, updatedAt: true, website: { select: { name: true } } },
    }),
    prisma.queueJob.findFirst({
      where: { queue: HUMANIZER_QUEUE, status: { in: ['WAITING', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ]);
  return {
    articles: articles.map((a) => ({ id: a.id, keyword: a.keyword, status: a.status, website: a.website?.name ?? null, updatedAt: a.updatedAt })),
    runningId: running?.id ?? null,
  };
});

/** Starts a Humanizer test run in the worker (ChatGPT answers through the extension). */
export const POST = route(async (req) => {
  const body = await parseBody(req, startSchema);
  const busy = await prisma.queueJob.findFirst({ where: { queue: HUMANIZER_QUEUE, status: { in: ['WAITING', 'ACTIVE'] } }, select: { id: true } });
  if (busy) throw new HttpError(409, 'A humanizer test is already running. Wait for it or stop it first.');
  const data: HumanizerJobData = { input: body.input, keyword: body.keyword || undefined, prompt: body.prompt || undefined, rewriteAll: body.rewriteAll };
  const job = await prisma.queueJob.create({
    data: { queue: HUMANIZER_QUEUE, name: 'humanize', data: data as unknown as Prisma.InputJsonValue },
  });
  return { id: job.id };
});
