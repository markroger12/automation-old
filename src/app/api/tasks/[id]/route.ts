import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { sanitizeArticleHtml, stripAllHtml } from '@/lib/html/sanitize';
import { runInternalSeoCheck } from '@/lib/services/articles';
import { deleteTask } from '@/lib/services/tasks';
import { RUNNING_STATUSES } from '@/lib/task-status';
import { updateTaskSchema } from '@/lib/validation';

export const GET = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const task = await prisma.articleTask.findUnique({
    where: { id },
    include: {
      website: { select: { id: true, name: true, url: true, profileId: true } },
      category: { select: { id: true, name: true } },
      stages: { orderBy: { position: 'asc' } },
      seoReports: { orderBy: { createdAt: 'desc' }, take: 10 },
      _count: { select: { responses: true, logs: true } },
    },
  });
  if (!task) throw new HttpError(404, 'Article task not found');
  const internalReport = task.seoReports.find((r) => r.source === 'INTERNAL') ?? null;
  const rankMathReport = task.seoReports.find((r) => r.source === 'RANKMATH') ?? null;
  return { task: { ...task, seoReports: undefined }, internalReport, rankMathReport };
});

export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, updateTaskSchema);
  const task = await prisma.articleTask.findUnique({ where: { id } });
  if (!task) throw new HttpError(404, 'Article task not found');
  if ((RUNNING_STATUSES as string[]).includes(task.status)) {
    throw new HttpError(409, 'This article is being processed right now. Edit it after the current step finishes.');
  }

  const data: Prisma.ArticleTaskUpdateInput = {};
  if (input.keyword !== undefined) data.keyword = input.keyword;
  if (input.selectedTitle !== undefined) data.selectedTitle = stripAllHtml(input.selectedTitle);
  if (input.bodyHtml !== undefined) data.bodyHtml = sanitizeArticleHtml(input.bodyHtml);
  if (input.faqs !== undefined) data.faqs = input.faqs.map((f) => ({ question: stripAllHtml(f.question), answer: stripAllHtml(f.answer) }));
  if (input.quickBio !== undefined) {
    data.quickBio = input.quickBio.map((r) => ({ attribute: stripAllHtml(r.attribute), details: stripAllHtml(r.details) }));
  }
  if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle ? stripAllHtml(input.seoTitle) : null;
  if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription ? stripAllHtml(input.metaDescription) : null;
  if (input.slug !== undefined) data.slug = input.slug || null;
  if (input.focusKeyword !== undefined) data.focusKeyword = input.focusKeyword ? stripAllHtml(input.focusKeyword) : null;
  if (input.tags !== undefined) data.tags = Array.from(new Set(input.tags.map(stripAllHtml).filter(Boolean)));
  if (input.secondaryKeywords !== undefined && input.secondaryKeywords.length) data.secondaryKeywords = input.secondaryKeywords;

  const websiteId = input.websiteId !== undefined ? input.websiteId : task.websiteId;
  if (input.websiteId !== undefined) data.website = websiteId ? { connect: { id: websiteId } } : { disconnect: true };
  if (input.categoryId !== undefined || input.websiteId !== undefined) {
    const categoryId = input.categoryId !== undefined ? input.categoryId : task.categoryId;
    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category || category.websiteId !== websiteId) throw new HttpError(400, 'Category does not belong to the selected website');
      data.category = { connect: { id: category.id } };
      data.categoryName = category.name;
    } else {
      data.category = { disconnect: true };
      data.categoryName = null;
    }
  }

  await prisma.articleTask.update({ where: { id }, data });
  const hasContent = Boolean(input.bodyHtml ?? task.bodyHtml);
  const report = hasContent ? await runInternalSeoCheck(id) : null;
  return { ok: true, seoScore: report?.score ?? null };
});

export const DELETE = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  await deleteTask(id);
  return { ok: true };
});
