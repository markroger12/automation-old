import { prisma } from '@/lib/db';
(async () => {
  const jobs = await prisma.queueJob.findMany({ where: { status: { in: ['WAITING', 'ACTIVE'] } } });
  let n = 0;
  for (const j of jobs) {
    const raw = (j as any).data;
    const d = (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
    if (d.conversationUrl && /local-/i.test(decodeURIComponent(d.conversationUrl))) {
      d.conversationUrl = null;
      await prisma.queueJob.update({ where: { id: j.id }, data: { data: typeof raw === 'string' ? JSON.stringify(d) : d } as any });
      n++;
    }
  }
  console.log('jobs', jobs.length, 'local cleared', n, jobs.map((j: any) => `${j.queue ?? j.type}:${j.status}`).join(' '));
  const failed = await prisma.articleTask.findMany({ where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 3 * 3600e3) } }, select: { id: true, keyword: true, statusMessage: true } });
  console.log('failed', JSON.stringify(failed));
  const active = await prisma.articleTask.findMany({ where: { updatedAt: { gte: new Date(Date.now() - 6 * 3600e3) } }, select: { keyword: true, status: true, currentStage: true, statusMessage: true } as any });
  console.log(active.map((t: any) => `${t.keyword} | ${t.status} | ${t.currentStage ?? ''} | ${t.statusMessage ?? ''}`).join('\n'));
  await prisma.$disconnect();
})();
