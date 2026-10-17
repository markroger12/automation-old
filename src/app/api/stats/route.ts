import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { isWorkerOnline } from '@/lib/queue';
import { IN_FLIGHT_STATUSES, RUNNING_STATUSES, type TaskStatusValue } from '@/lib/task-status';

export const GET = route(async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [total, today, running, queued, completed, drafts, failed, needsReview, loginRequired, recentActivity, activeTasks, profiles, workerOnline] =
    await Promise.all([
      prisma.articleTask.count(),
      prisma.articleTask.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.articleTask.count({ where: { status: { in: RUNNING_STATUSES as TaskStatusValue[] } } }),
      prisma.articleTask.count({ where: { status: 'QUEUED' } }),
      prisma.articleTask.count({ where: { status: { in: ['DRAFT_CREATED', 'NEEDS_REVIEW'] }, contentHtml: { not: null } } }),
      prisma.articleTask.count({ where: { wpEditUrl: { not: null } } }),
      prisma.articleTask.count({ where: { status: 'FAILED' } }),
      prisma.articleTask.count({ where: { status: { in: ['NEEDS_REVIEW', 'AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL'] } } }),
      prisma.articleTask.count({ where: { status: 'LOGIN_REQUIRED' } }),
      prisma.log.findMany({
        where: { level: { in: ['INFO', 'WARN', 'ERROR'] }, taskId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, level: true, category: true, message: true, createdAt: true, taskId: true, task: { select: { keyword: true } } },
      }),
      prisma.articleTask.findMany({
        where: { status: { in: [...(IN_FLIGHT_STATUSES as TaskStatusValue[]), 'LOGIN_REQUIRED', 'AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, keyword: true, status: true, progress: true, statusMessage: true, updatedAt: true, loginRequiredFor: true },
      }),
      prisma.browserProfile.findMany({
        where: { kind: { not: 'CHATGPT' } },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, kind: true, sessionStatus: true, sessionDetail: true, lastCheckedAt: true, websites: { select: { id: true, name: true } } },
      }),
      isWorkerOnline(),
    ]);

  return {
    stats: { total, today, running, queued, completed, drafts, failed, needsReview, loginRequired },
    recentActivity,
    activeTasks,
    profiles,
    workerOnline,
  };
});
