import { prisma } from '@/lib/db';
(async () => {
  const last = new Map<string, string>();
  const end = Date.now() + 25 * 60_000;
  while (Date.now() < end) {
    const tasks = await prisma.articleTask.findMany({ where: { updatedAt: { gte: new Date(Date.now() - 3 * 3600_000) } }, select: { id: true, keyword: true, status: true, currentStage: true, progress: true, error: true } });
    for (const t of tasks) { const k = `${t.status} ${t.currentStage ?? ''} ${t.progress}%${t.error ? ' ERR ' + t.error.slice(0, 120) : ''}`; if (last.get(t.id) !== k) { console.log(new Date().toISOString().slice(11, 19), t.keyword, '→', k); last.set(t.id, k); } }
    const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', finishedAt: { gte: new Date(Date.now() - 20_000) } }, select: { name: true, status: true, taskId: true, startedAt: true, finishedAt: true, error: true } });
    for (const j of jobs) { const k = `job ${j.taskId}${j.name}${j.finishedAt?.getTime()}`; if (!last.has(k)) { last.set(k, '1'); console.log(new Date().toISOString().slice(11, 19), '  chatgpt', j.name, j.status, j.startedAt && j.finishedAt ? Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000) + 's' : '', (j.error ?? '').slice(0, 100)); } }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  await prisma.$disconnect();
})();
