import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { createArticleTasks } from '@/lib/services/tasks';
import { STATUS_META, TASK_STATUSES, type StatusGroup, type TaskStatusValue } from '@/lib/task-status';
import { bulkCreateSchema, bulkItemsCreateSchema, createTaskSchema } from '@/lib/validation';
import { z } from 'zod';

const listQuery = z.object({
  group: z.enum(['all', 'queued', 'running', 'waiting', 'done', 'failed', 'active']).default('all'),
  status: z.enum(TASK_STATUSES).optional(),
  moduleKey: z.string().max(60).optional(),
  websiteId: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function statusesFor(group: StatusGroup | 'active'): TaskStatusValue[] {
  if (group === 'active') return TASK_STATUSES.filter((s) => ['queued', 'running', 'waiting'].includes(STATUS_META[s].group));
  return TASK_STATUSES.filter((s) => STATUS_META[s].group === group);
}

export const GET = route(async (req) => {
  const q = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.ArticleTaskWhereInput = {};
  if (q.status) where.status = q.status;
  else if (q.group !== 'all') where.status = { in: statusesFor(q.group) };
  if (q.moduleKey) where.moduleKey = q.moduleKey;
  if (q.websiteId) where.websiteId = q.websiteId;
  if (q.q) {
    where.OR = [
      // SQLite LIKE matching is case-insensitive for plain letters.
      { keyword: { contains: q.q } },
      { selectedTitle: { contains: q.q } },
    ];
  }

  const [total, tasks] = await Promise.all([
    prisma.articleTask.count({ where }),
    prisma.articleTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        moduleKey: true,
        keyword: true,
        selectedTitle: true,
        status: true,
        progress: true,
        currentStage: true,
        statusMessage: true,
        loginRequiredFor: true,
        categoryName: true,
        wordCount: true,
        seoScore: true,
        rankMathScore: true,
        wpEditUrl: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        website: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, tasks };
});

export const POST = route(async (req, _ctx, session) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body && Array.isArray(body.items)) {
    const { items, ...shared } = bulkItemsCreateSchema.parse(body);
    const result = await createArticleTasks(
      items.map((item) =>
        createTaskSchema.parse({
          ...shared,
          keyword: item.keyword,
          secondaryKeywords: item.secondaryKeywords.length ? item.secondaryKeywords : shared.secondaryKeywords,
        }),
      ),
      session.userId,
    );
    return { created: result.tasks.length, tasks: result.tasks, warning: result.warning };
  }
  if (body && Array.isArray(body.keywords)) {
    const input = bulkCreateSchema.parse(body);
    const { keywords, ...shared } = input;
    const result = await createArticleTasks(
      keywords.map((keyword) => createTaskSchema.parse({ ...shared, keyword })),
      session.userId,
    );
    return { created: result.tasks.length, tasks: result.tasks, warning: result.warning };
  }
  const input = createTaskSchema.parse(body ?? {});
  const result = await createArticleTasks([input], session.userId);
  return { created: 1, tasks: result.tasks, warning: result.warning };
});
