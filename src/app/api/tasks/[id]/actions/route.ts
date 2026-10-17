import { param, parseBody, route } from '@/lib/api';
import { performTaskAction } from '@/lib/services/tasks';
import { taskActionSchema } from '@/lib/validation';

export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, taskActionSchema);
  return performTaskAction(id, input);
});
