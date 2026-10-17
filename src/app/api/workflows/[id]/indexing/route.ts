import { z } from 'zod';
import { param, parseBody, route } from '@/lib/api';
import { requestWorkflowIndexing } from '@/lib/services/workflow';

export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const { keywordId } = await parseBody(req, z.object({ keywordId: z.string().min(1).max(80) }));
  return requestWorkflowIndexing(id, keywordId);
});
