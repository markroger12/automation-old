import { z } from 'zod';
import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { defaultPromptContent } from '@/lib/services/prompts';
import { writeLog } from '@/lib/logger';
import { promptUpdateSchema } from '@/lib/validation';

export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const { content } = await parseBody(req, promptUpdateSchema);
  const prompt = await prisma.promptTemplate.update({ where: { id }, data: { content } });
  await writeLog({ category: 'SYSTEM', message: `Prompt "${prompt.name}" updated` });
  return { prompt };
});

/** POST { action: "reset" } restores the built-in default text. */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  await parseBody(req, z.object({ action: z.literal('reset') }));
  const existing = await prisma.promptTemplate.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Prompt not found');
  const content = defaultPromptContent(existing.moduleKey, existing.key);
  if (!content) throw new HttpError(400, 'No default exists for this prompt');
  const prompt = await prisma.promptTemplate.update({ where: { id }, data: { content } });
  await writeLog({ category: 'SYSTEM', message: `Prompt "${prompt.name}" reset to default` });
  return { prompt };
});
