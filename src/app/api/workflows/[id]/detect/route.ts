import { param, route } from '@/lib/api';
import { detectKinds } from '@/lib/services/workflow';

/** Works out the writer of the keywords nobody has set yet (wording first, then Wikidata). */
export const POST = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  return await detectKinds(id);
});
