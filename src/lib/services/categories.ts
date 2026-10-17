import { prisma } from '@/lib/db';
import { writeLog } from '@/lib/logger';

export interface CategorySyncResult {
  total: number;
  added: string[];
  removed: string[];
}

/**
 * Makes the website's category list in the app match the categories on the WordPress site: new ones are added,
 * ones that no longer exist are removed. Articles keep the category name they were written with.
 */
export async function syncWebsiteCategories(websiteId: string, names: string[]): Promise<CategorySyncResult> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && name.length <= 100 && !wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
  }
  // An empty list means the page could not be read — never wipe the categories because of that.
  if (wanted.size === 0) return { total: await prisma.category.count({ where: { websiteId } }), added: [], removed: [] };

  const website = await prisma.website.findUniqueOrThrow({ where: { id: websiteId }, include: { categories: true } });
  const have = new Map(website.categories.map((c) => [c.name.toLowerCase(), c]));
  const added = [...wanted].filter(([key]) => !have.has(key)).map(([, name]) => name);
  const stale = website.categories.filter((c) => !wanted.has(c.name.toLowerCase()));

  // Same name with different capitals on the site: keep the site's spelling.
  const renames = website.categories.filter((c) => wanted.has(c.name.toLowerCase()) && wanted.get(c.name.toLowerCase()) !== c.name);

  await prisma.$transaction([
    ...(added.length ? [prisma.category.createMany({ data: added.map((name) => ({ websiteId, name })) })] : []),
    ...renames.map((c) => prisma.category.update({ where: { id: c.id }, data: { name: wanted.get(c.name.toLowerCase())! } })),
    ...(stale.length ? [prisma.category.deleteMany({ where: { id: { in: stale.map((c) => c.id) } } })] : []),
    ...(website.defaultCategoryId && stale.some((c) => c.id === website.defaultCategoryId)
      ? [prisma.website.update({ where: { id: websiteId }, data: { defaultCategoryId: null } })]
      : []),
  ]);

  const removed = stale.map((c) => c.name);
  if (added.length || removed.length) {
    await writeLog({
      category: 'SESSION',
      message: `Categories of "${website.name}" updated from WordPress: ${added.length} added, ${removed.length} removed`,
      data: { added, removed },
    });
  }
  return { total: wanted.size, added, removed };
}
