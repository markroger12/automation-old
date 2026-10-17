import { prisma } from '@/lib/db';
import { param, route } from '@/lib/api';

/** Every prompt sent to ChatGPT for this task and the response captured from the browser. */
export const GET = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const responses = await prisma.chatGPTResponse.findMany({
    where: { taskId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      stageKey: true,
      attempt: true,
      prompt: true,
      responseText: true,
      conversationUrl: true,
      reusedExisting: true,
      durationMs: true,
      createdAt: true,
    },
  });
  return { responses };
});
