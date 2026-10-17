import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', status: 'ACTIVE' }, select: { name: true, taskId: true, result: true } });
  for (const j of jobs) { const d = ((j.result ?? {}) as any).debug ?? {}; const lr = d.conversationRead?.lastRead; if (lr) console.log(new Date().toISOString().slice(11, 19), j.name, j.taskId?.slice(-6), 'gen', d.generating, JSON.stringify(lr)); }
  await prisma.$disconnect();
})();
