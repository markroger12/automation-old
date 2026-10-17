import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', finishedAt: { gte: new Date(Date.now() - 8 * 60_000) } }, orderBy: { finishedAt: 'asc' } });
  for (const j of jobs as any[]) {
    const r = (j.result ?? {}) as any;
    console.log(j.name, j.taskId?.slice(-6), j.status, j.startedAt?.toISOString().slice(11, 19), '→', j.finishedAt?.toISOString().slice(11, 19), j.error);
    const d = r.debug ?? {};
    console.log('   ', JSON.stringify({ step: d.step, title: d.title, url: d.url ?? d.location, tab: d.tabId ?? r.tabId, cr: d.conversationRead ? { level: d.conversationRead.level, problem: d.conversationRead.problem } : undefined, client: j.data?.clientId ?? r.clientId }).slice(0, 400));
  }
  await prisma.$disconnect();
})();
