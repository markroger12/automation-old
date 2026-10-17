import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', status: 'ACTIVE' }, select: { name: true, taskId: true, result: true } });
  for (const j of jobs) { const d = ((j.result ?? {}) as any).debug ?? {}; console.log(j.name, j.taskId?.slice(-6), 'gen', d.generating, 'step', d.step, JSON.stringify(d.conversationRead?.lastRead ?? null), '| level', d.conversationRead?.level); }
  await prisma.$disconnect();
})();
