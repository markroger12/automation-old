import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', status: 'ACTIVE' }, select: { name: true, taskId: true, startedAt: true, result: true } });
  for (const j of jobs) { const d = ((j.result ?? {}) as any).debug ?? {}; if (d.conversationRead?.lastRead) console.log(new Date().toISOString().slice(11, 19), j.name, j.taskId?.slice(-6), 'since', j.startedAt?.toISOString().slice(11, 19), d.step, 'gen', d.generating, JSON.stringify(d.conversationRead)); }
  await prisma.$disconnect();
})();
