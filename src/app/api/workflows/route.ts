import { z } from 'zod';
import { parseBody, route } from '@/lib/api';
import { ensureWorkflow, listWorkflows } from '@/lib/services/workflow';

/** Every website with its workflow (a website without one is listed so it can be switched on). */
export const GET = route(async () => ({ websites: await listWorkflows() }));

/** Makes the workflow of a website, or returns the one it already has. */
export const POST = route(async (req) => {
  const input = await parseBody(req, z.object({ websiteId: z.string().min(1) }));
  return { workflow: await ensureWorkflow(input.websiteId) };
});
