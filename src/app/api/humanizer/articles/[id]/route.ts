import { param, notFound, route } from '@/lib/api';
import { prisma } from '@/lib/db';

/** An article's assembled HTML (or its body when it was not assembled yet), to try the Humanizer on. */
export const GET = route(async (_req, ctx) => {
  const task = await prisma.articleTask.findUnique({
    where: { id: await param(ctx, 'id') },
    select: { keyword: true, focusKeyword: true, contentHtml: true, bodyHtml: true },
  });
  if (!task) notFound('Article');
  return { keyword: task.focusKeyword || task.keyword, html: task.contentHtml || task.bodyHtml || '' };
});
