import { z } from 'zod';
import { param, parseBody, route } from '@/lib/api';
import { addKeywords, deleteKeywords, updateKeyword } from '@/lib/services/workflow';

const addSchema = z.object({ text: z.string().max(200_000) });
const patchSchema = z.object({
  id: z.string().min(1),
  keyword: z.string().trim().min(2).max(200).optional(),
  title: z.string().trim().max(300).nullable().optional(),
  kind: z.enum(['UNKNOWN', 'CELEBRITY', 'TIGRAM']).optional(),
  state: z.enum(['WAITING', 'SKIPPED']).optional(),
  position: z.number().int().min(0).optional(),
});
const deleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) });

/** Adds the keywords from the box to the end of the list. */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, addSchema);
  return await addKeywords(id, input.text);
});

/** Changes one keyword: its writer, its wording, or putting it back in the queue. */
export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, patchSchema);
  const { id: keywordId, ...patch } = input;
  return { keyword: await updateKeyword(id, keywordId, patch) };
});

/** Removes keywords that are not being written or already scheduled. */
export const DELETE = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, deleteSchema);
  return { removed: await deleteKeywords(id, input.ids) };
});
