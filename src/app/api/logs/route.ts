import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { logQuerySchema } from '@/lib/validation';

export const GET = route(async (req) => {
  const q = logQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.LogWhereInput = {};
  if (q.taskId) where.taskId = q.taskId;
  if (q.level) where.level = q.level;
  if (q.category) where.category = q.category;
  if (q.q) where.message = { contains: q.q };

  const logs = await prisma.log.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { task: { select: { keyword: true } } },
  });
  const hasMore = logs.length > q.limit;
  const page = hasMore ? logs.slice(0, q.limit) : logs;
  return { logs: page, nextCursor: hasMore ? page[page.length - 1].id : null };
});
