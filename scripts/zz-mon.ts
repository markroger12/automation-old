import { prisma } from '@/lib/db';
import { getExtensionStatus } from '@/lib/services/chatgpt-extension';
(async () => {
  const now = new Date();
  const w = await prisma.workerStatus.findUnique({ where: { id: 'main' } });
  console.log('now', now.toISOString(), 'worker', JSON.stringify(w));
  const s = await getExtensionStatus();
  console.log('ext', JSON.stringify({ versions: s.versions, online: s.online, automation: s.automationConnected, tabs: s.tabs.length, waiting: s.waitingPrompts, active: s.activePrompts, lastSeen: s.lastSeenAt }));
  const jobs = await prisma.queueJob.findMany({ where: { status: { in: ['WAITING', 'ACTIVE'] } }, orderBy: { createdAt: 'asc' }, select: { queue: true, name: true, status: true, taskId: true, createdAt: true, startedAt: true, result: true } });
  console.log('jobs', jobs.length);
  for (const j of jobs) { const d = ((j.result ?? {}) as any).debug ?? {}; console.log(' ', j.queue, j.name, j.status, j.taskId?.slice(-6), 'created', j.createdAt.toISOString().slice(5, 19), 'started', j.startedAt?.toISOString().slice(11, 19) ?? '-', j.queue === 'chatgpt' ? JSON.stringify({ step: d.step, gen: d.generating, title: d.title, cr: d.conversationRead, page: d.page ? { bodyChars: d.page.bodyChars, actionRows: d.page.actionRows } : undefined }) : ''); }
  const tasks = await prisma.articleTask.findMany({ where: { OR: [{ status: { notIn: ['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'] } }, { updatedAt: { gte: new Date(Date.now() - 6 * 3600_000) } }] }, orderBy: { createdAt: 'asc' }, select: { id: true, keyword: true, moduleKey: true, language: true, status: true, currentStage: true, progress: true, statusMessage: true, error: true, website: { select: { name: true } }, updatedAt: true } });
  console.log('tasks', tasks.length);
  for (const t of tasks) console.log(`  ${t.id.slice(-6)} | ${t.keyword} | ${t.moduleKey} | ${t.language} | ${t.website?.name} | ${t.status} ${t.currentStage ?? ''} ${t.progress}% | ${(t.statusMessage ?? '').slice(0, 70)} | ${(t.error ?? '').slice(0, 110)} | ${t.updatedAt.toISOString().slice(5, 19)}`);
  const logs = await prisma.log.findMany({ where: { createdAt: { gte: new Date(Date.now() - 2 * 3600_000) }, level: { in: ['WARN', 'ERROR'] } }, orderBy: { createdAt: 'desc' }, take: 30, select: { createdAt: true, level: true, category: true, stage: true, taskId: true, message: true } });
  console.log('warn/error logs (2h)', logs.length);
  for (const l of logs.reverse()) console.log(`  ${l.createdAt.toISOString().slice(5, 19)} ${l.level} ${l.stage ?? ''} ${l.taskId?.slice(-6) ?? ''} ${l.message.replace(/\s+/g, ' ').slice(0, 200)}`);
  await prisma.$disconnect();
})();
