import fs from 'node:fs/promises';
import { HttpError, param, route } from '@/lib/api';
import { resolveScreenshotPath } from '@/lib/paths';

/** Serves failure screenshots to authenticated users only (never from a public folder). */
export const GET = route(async (_req, ctx) => {
  const relative = await param(ctx, 'path');
  if (relative.includes('..')) throw new HttpError(400, 'Invalid path');
  const file = resolveScreenshotPath(relative);
  if (!file) throw new HttpError(400, 'Invalid path');
  const data = await fs.readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, 'Screenshot not found');
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
