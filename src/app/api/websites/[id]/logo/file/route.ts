import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { HttpError, param, route } from '@/lib/api';
import { templatesRoot } from '@/lib/paths';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/** Shows the stored logo on the Websites page. */
export const GET = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const website = await prisma.website.findUnique({ where: { id }, select: { logoFile: true } });
  if (!website?.logoFile) throw new HttpError(404, 'This website has no logo');
  // The name comes from the upload route, but never trust it with a path.
  const file = path.join(templatesRoot(), path.basename(website.logoFile));
  const body = await fs.readFile(file).catch(() => null);
  if (!body) throw new HttpError(404, 'The logo file is missing');
  return new Response(new Uint8Array(body), {
    headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' },
  });
});
