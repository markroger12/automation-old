import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { categorySchema } from '@/lib/validation';

/** Adds local category names for a website (categories are managed locally — no WordPress API). */
export const POST = route(async (req, ctx) => {
  const websiteId = await param(ctx, 'id');
  const { names } = await parseBody(req, categorySchema);
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) throw new HttpError(404, 'Website not found');
  const existing = await prisma.category.findMany({ where: { websiteId }, select: { name: true } });
  const known = new Set(existing.map((c) => c.name.toLowerCase()));
  const toCreate = names.filter((name) => !known.has(name.toLowerCase()));
  if (toCreate.length) await prisma.category.createMany({ data: toCreate.map((name) => ({ websiteId, name })) });
  const categories = await prisma.category.findMany({ where: { websiteId }, orderBy: { name: 'asc' } });
  return { categories };
});
