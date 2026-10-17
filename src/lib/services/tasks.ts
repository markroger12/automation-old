import type { ArticleTask, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../http-error';
import { writeLog } from '../logger';
import { enqueueArticleJob, getArticleJobState, removeWaitingArticleJob } from '../queue';
import { getSettings } from '../settings';
import { websiteLanguage } from '../content-locale';
import { RUNNING_STATUSES, isInFlight } from '../task-status';
import type { BulkTaskActionInput, CreateTaskInput, TaskActionInput } from '../validation';
import { getModule } from '@/modules/registry';
import { runInternalSeoCheck } from './articles';

const QUEUE_WARNING = 'Saved, but the task could not be queued. It will be queued automatically when the worker starts.';

async function safeEnqueue(taskId: string, mode: 'run' | 'regenerate', stage?: string): Promise<string | null> {
  try {
    const res = await enqueueArticleJob({ taskId, mode, stage });
    return res.queued ? null : (res.reason ?? null);
  } catch (err) {
    console.error('[queue] enqueue failed', err);
    return QUEUE_WARNING;
  }
}

export async function createArticleTasks(
  inputs: CreateTaskInput[],
  userId: string | null,
): Promise<{ tasks: Pick<ArticleTask, 'id' | 'keyword'>[]; warning: string | null }> {
  const settings = await getSettings();
  const created: Pick<ArticleTask, 'id' | 'keyword'>[] = [];

  for (const input of inputs) {
    const manifest = getModule(input.moduleKey);
    if (!manifest || manifest.status !== 'active') throw new HttpError(400, `Module "${input.moduleKey}" is not available`);

    const website = input.websiteId ? await prisma.website.findUnique({ where: { id: input.websiteId } }) : null;
    if (input.websiteId && !website) throw new HttpError(400, 'Selected website was not found');

    let category = input.categoryId ? await prisma.category.findUnique({ where: { id: input.categoryId } }) : null;
    if (input.categoryId && (!category || category.websiteId !== website?.id)) {
      throw new HttpError(400, 'Selected category does not belong to the selected website');
    }
    if (!category && !input.autoCategory && website?.defaultCategoryId) {
      category = await prisma.category.findUnique({ where: { id: website.defaultCategoryId } });
    }

    const task = await prisma.articleTask.create({
      data: {
        moduleKey: manifest.key,
        keyword: input.keyword,
        exampleTitle: input.exampleTitle,
        secondaryKeywords: input.secondaryKeywords,
        // A task's own language wins, then the website's (German for .de sites), then Settings.
        targetCountry: input.targetCountry ?? (input.language ? null : websiteLanguage(website?.url)?.country) ?? settings.targetCountry,
        language: input.language ?? websiteLanguage(website?.url)?.language ?? settings.defaultLanguage,
        websiteId: website?.id ?? null,
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
        createdById: userId,
        stages: { create: manifest.stages.map((s, position) => ({ key: s.key, label: s.label, position })) },
      },
      select: { id: true, keyword: true },
    });
    created.push(task);
  }

  let warning: string | null = null;
  for (const task of created) {
    const w = await safeEnqueue(task.id, 'run');
    if (w === QUEUE_WARNING) warning = w;
    await writeLog({ taskId: task.id, category: 'QUEUE', message: `Article task created for "${task.keyword}"` });
  }
  return { tasks: created, warning };
}

/** Re-enqueues tasks that were waiting for a login once the session works again. */
export async function resumeTasksWaitingForLogin(service: 'chatgpt' | 'wordpress', profileId?: string): Promise<number> {
  const tasks = await prisma.articleTask.findMany({
    where: {
      status: 'LOGIN_REQUIRED',
      loginRequiredFor: service,
      ...(service === 'wordpress' && profileId ? { website: { profileId } } : {}),
    },
    select: { id: true },
  });
  for (const t of tasks) {
    await prisma.articleTask.update({ where: { id: t.id }, data: { status: 'QUEUED', statusMessage: 'Resuming after login', loginRequiredFor: null } });
    await safeEnqueue(t.id, 'run');
    await writeLog({ taskId: t.id, category: 'QUEUE', message: `Resumed after ${service === 'chatgpt' ? 'ChatGPT' : 'WordPress'} login` });
  }
  return tasks.length;
}

async function loadTask(id: string) {
  const task = await prisma.articleTask.findUnique({ where: { id } });
  if (!task) throw new HttpError(404, 'Article task not found');
  return task;
}

async function assertNotRunning(task: ArticleTask): Promise<void> {
  if (!isInFlight(task.status)) return;
  const state = await getArticleJobState(task.id).catch(() => null);
  if (state) {
    throw new HttpError(409, 'This task is already queued or running. Wait for it to finish or cancel it first.');
  }
}

export async function performTaskAction(id: string, input: TaskActionInput): Promise<{ message: string; warning?: string | null }> {
  const task = await loadTask(id);
  const manifest = getModule(task.moduleKey);

  switch (input.action) {
    case 'retry':
    case 'resume': {
      await assertNotRunning(task);
      await prisma.articleStage.updateMany({ where: { taskId: id, status: { in: ['FAILED', 'RUNNING'] } }, data: { status: 'PENDING' } });
      await prisma.articleTask.update({
        where: { id },
        data: { status: 'QUEUED', error: null, loginRequiredFor: null, cancelRequested: false, statusMessage: 'Continuing from the last completed stage', completedAt: null },
      });
      const warning = await safeEnqueue(id, 'run');
      await writeLog({ taskId: id, category: 'QUEUE', message: 'Task re-queued; it will continue from the last completed stage' });
      return { message: 'Task queued. It will continue from the last completed stage.', warning };
    }

    case 'cancel': {
      if (!isInFlight(task.status) && !['AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL', 'LOGIN_REQUIRED'].includes(task.status)) {
        throw new HttpError(409, 'Only queued, running or waiting tasks can be cancelled');
      }
      const removed = await removeWaitingArticleJob(id).catch(() => true);
      const running = !removed;
      await prisma.articleTask.update({
        where: { id },
        data: running
          ? { cancelRequested: true, statusMessage: 'Cancelling after the current step…' }
          : { status: 'CANCELLED', cancelRequested: false, statusMessage: 'Cancelled by user' },
      });
      await writeLog({ taskId: id, level: 'WARN', category: 'QUEUE', message: running ? 'Cancellation requested' : 'Task cancelled' });
      return { message: running ? 'Cancellation requested — the task stops after the current browser step.' : 'Task cancelled.' };
    }

    case 'approve-title': {
      await prisma.articleTask.update({
        where: { id },
        data: { selectedTitle: input.title, titleApprovedAt: new Date(), ...(task.status === 'AWAITING_TITLE_APPROVAL' ? { status: 'QUEUED' } : {}) },
      });
      await writeLog({ taskId: id, category: 'SYSTEM', message: `Title approved: ${input.title}` });
      if (task.status !== 'AWAITING_TITLE_APPROVAL') return { message: 'Title updated.' };
      const warning = await safeEnqueue(id, 'run');
      return { message: 'Title approved. The article workflow continues.', warning };
    }

    case 'approve-article':
    case 'send-to-wordpress': {
      await assertNotRunning(task);
      if (!task.contentHtml && !task.bodyHtml) throw new HttpError(409, 'The article has not been generated yet');
      if (!task.websiteId) throw new HttpError(409, 'Select a website for this article first');
      await prisma.articleStage.updateMany({
        where: { taskId: id, key: { in: ['ARTICLE_APPROVAL', 'WORDPRESS_DRAFT', 'RANKMATH'] } },
        data: { status: 'PENDING', error: null },
      });
      await prisma.articleTask.update({
        where: { id },
        data: { articleApprovedAt: new Date(), status: 'QUEUED', error: null, reviewReasons: [], statusMessage: 'Queued for WordPress', completedAt: null },
      });
      const warning = await safeEnqueue(id, 'run');
      await writeLog({ taskId: id, category: 'QUEUE', message: task.wpEditUrl ? 'Queued to update the existing WordPress draft' : 'Queued to create the WordPress draft' });
      return { message: task.wpEditUrl ? 'Queued — the existing draft will be updated.' : 'Queued — a WordPress draft will be created.', warning };
    }

    case 'regenerate': {
      await assertNotRunning(task);
      const stage = manifest?.stages.find((s) => s.key === input.stage);
      if (!stage?.regenerable) throw new HttpError(400, 'This stage cannot be regenerated');
      await prisma.articleTask.update({
        where: { id },
        data: { status: 'QUEUED', error: null, cancelRequested: false, statusMessage: `Regenerating ${stage.label}` },
      });
      const warning = await safeEnqueue(id, 'regenerate', stage.key);
      await writeLog({ taskId: id, category: 'QUEUE', stage: stage.key, message: `Regeneration queued: ${stage.label}` });
      return { message: `${stage.label} will be regenerated in the same ChatGPT conversation.`, warning };
    }

    case 'seo-check': {
      if (!task.bodyHtml && !task.contentHtml) throw new HttpError(409, 'There is no article content to check yet');
      const report = await runInternalSeoCheck(id);
      return { message: `SEO Readiness Score: ${report.score}/100` };
    }
  }
}

/** Moves an article to another website (and category), e.g. before sending generate-only articles to WordPress. */
export async function assignTaskWebsite(id: string, websiteId: string, categoryId: string | null): Promise<void> {
  const task = await loadTask(id);
  if ((RUNNING_STATUSES as string[]).includes(task.status)) {
    throw new HttpError(409, 'This article is being processed right now');
  }
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) throw new HttpError(400, 'Selected website was not found');
  let category = categoryId ? await prisma.category.findUnique({ where: { id: categoryId } }) : null;
  if (categoryId && (!category || category.websiteId !== website.id)) throw new HttpError(400, 'Category does not belong to the selected website');
  if (!category && website.defaultCategoryId) category = await prisma.category.findUnique({ where: { id: website.defaultCategoryId } });
  await prisma.articleTask.update({
    where: { id },
    data: { websiteId: website.id, categoryId: category?.id ?? null, categoryName: category?.name ?? null },
  });
}

export interface BulkActionResult {
  succeeded: number;
  failed: number;
  results: { id: string; keyword: string; ok: boolean; message: string }[];
}

/** Applies one action to many articles; every article is handled on its own, so one failure does not stop the rest. */
export async function performBulkTaskAction(input: BulkTaskActionInput): Promise<BulkActionResult> {
  const ids = Array.from(new Set(input.ids));
  const tasks = await prisma.articleTask.findMany({ where: { id: { in: ids } }, select: { id: true, keyword: true } });
  const keywords = new Map(tasks.map((t) => [t.id, t.keyword]));
  const results: BulkActionResult['results'] = [];

  for (const id of ids) {
    const keyword = keywords.get(id) ?? id;
    try {
      let message: string;
      switch (input.action) {
        case 'delete':
          await deleteTask(id);
          message = 'Deleted';
          break;
        case 'assign-website':
          await assignTaskWebsite(id, input.websiteId!, input.categoryId);
          message = 'Website assigned';
          break;
        default:
          message = (await performTaskAction(id, { action: input.action })).message;
      }
      results.push({ id, keyword, ok: true, message });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : 'Unexpected error — see the server log';
      if (!(err instanceof HttpError)) console.error('[bulk] action failed', id, err);
      results.push({ id, keyword, ok: false, message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  await writeLog({
    category: 'QUEUE',
    message: `Bulk action "${input.action}" on ${ids.length} article(s): ${succeeded} done, ${ids.length - succeeded} skipped`,
  });
  return { succeeded, failed: results.length - succeeded, results };
}

export async function deleteTask(id: string): Promise<void> {
  const task = await loadTask(id);
  if (isInFlight(task.status)) {
    const removed = await removeWaitingArticleJob(id).catch(() => true);
    if (!removed) throw new HttpError(409, 'This task is running. Cancel it first, then delete it.');
  }
  await prisma.articleTask.delete({ where: { id } });
}

export type TaskListWhere = Prisma.ArticleTaskWhereInput;
