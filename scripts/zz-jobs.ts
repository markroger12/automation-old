import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { createdAt: 'asc' }, select: { name: true, taskId: true, status: true, error: true, createdAt: true, startedAt: true, finishedAt: true } });
  console.log('chatgpt jobs (24h)', jobs.length);
  for (const j of jobs.slice(-40)) {
    const secs = j.finishedAt && j.startedAt ? Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000) : null;
    console.log(`${j.createdAt.toISOString().slice(5, 19)} ${j.name.padEnd(14)} ${j.taskId?.slice(-6)} ${j.status.padEnd(9)} ${secs ?? '-'}s ${(j.error ?? '').slice(0, 120)}`);
  }
  await prisma.$disconnect();
})();
