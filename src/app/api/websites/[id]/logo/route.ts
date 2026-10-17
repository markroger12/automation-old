import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { HttpError, param, route } from '@/lib/api';
import { templatesRoot } from '@/lib/paths';

const TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
const MAX_BYTES = 4 * 1024 * 1024;

/** Stores the website's logo for the image template (one file per website, the old one is replaced). */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) throw new HttpError(404, 'Website not found');

  const form = await req.formData().catch(() => null);
  const file = form?.get('logo');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a logo file');
  const extension = TYPES[file.type];
  if (!extension) throw new HttpError(400, 'The logo must be a PNG, JPEG, WEBP or SVG file');
  if (file.size > MAX_BYTES) throw new HttpError(400, 'The logo file is larger than 4 MB');

  const root = templatesRoot();
  await fs.mkdir(root, { recursive: true });
  // One file per website; a logo in another format is removed so only the new one is left.
  for (const old of Object.values(TYPES)) await fs.rm(path.join(root, `${id}-logo${old}`), { force: true });
  const name = `${id}-logo${extension}`;
  await fs.writeFile(path.join(root, name), Buffer.from(await file.arrayBuffer()));
  const updated = await prisma.website.update({ where: { id }, data: { logoFile: name } });
  return { website: updated };
});

/** Removes the logo again; the images then carry no logo. */
export const DELETE = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) throw new HttpError(404, 'Website not found');
  if (website.logoFile) await fs.rm(path.join(templatesRoot(), website.logoFile), { force: true });
  const updated = await prisma.website.update({ where: { id }, data: { logoFile: null } });
  return { website: updated };
});
