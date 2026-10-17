import { prisma } from '@/lib/db';
import { HttpError, param, route } from '@/lib/api';

export const DELETE = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) throw new HttpError(404, 'Category not found');
  await prisma.$transaction([
    prisma.website.updateMany({ where: { id: category.websiteId, defaultCategoryId: id }, data: { defaultCategoryId: null } }),
    prisma.category.delete({ where: { id } }),
  ]);
  return { ok: true };
});
