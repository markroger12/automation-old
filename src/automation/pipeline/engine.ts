import { prisma } from '@/lib/db';
import { writeLog } from '@/lib/logger';
import type { ArticleJobMode } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { markProfileSession } from '@/lib/services/profiles';
import type { BrowserManager } from '../browser/browser-manager';
import { sleep } from '../browser/locators';
import { ConfigurationError, LoginRequiredError, TaskCancelledError, isRetryable } from '../errors';
import { PipelineContext } from './context';
import type { PipelineDefinition, PipelineStage, StageResult } from './types';

/** Makes sure every stage of the module has a row (modules may gain stages after an upgrade). */
export async function ensureStageRows(taskId: string, pipeline: PipelineDefinition): Promise<void> {
  const existing = await prisma.articleStage.findMany({ where: { taskId }, select: { key: true } });
  const have = new Set(existing.map((s) => s.key));
  const missing = pipeline.stages
    .map((s, position) => ({ taskId, key: s.key, label: s.label, position }))
    .filter((s) => !have.has(s.key));
  if (missing.length) await prisma.articleStage.createMany({ data: missing });
}

function stageWhere(taskId: string, key: string) {
  return { taskId_key: { taskId, key } };
}

function screenshotLabel(stage: PipelineStage | null): string {
  if (!stage) return 'error';
  if (stage.key === 'RANKMATH') return 'rankmath-error';
  return stage.kind === 'wordpress' ? 'wordpress-error' : stage.kind === 'chatgpt' ? 'chatgpt-error' : `${stage.key.toLowerCase()}-error`;
}

async function runStage(ctx: PipelineContext, stage: PipelineStage): Promise<StageResult> {
  const maxAttempts = 1 + ctx.settings.retryAttempts;
  for (let attempt = 1; ; attempt++) {
    ctx.attempt = attempt;
    ctx.currentStage = stage;
    await prisma.articleStage.update({
      where: stageWhere(ctx.taskId, stage.key),
      data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date(), error: null },
    });
    await ctx.update({
      status: stage.status,
      currentStage: stage.key,
      statusMessage: attempt > 1 ? `Retry ${attempt - 1} of ${maxAttempts - 1}` : null,
    });
    if (attempt === 1) ctx.logger.child({ stage: stage.key }).info(`Stage started: ${stage.label}`);

    try {
      const result = await stage.run(ctx);
      if (result.outcome === 'completed') {
        await prisma.articleStage.update({
          where: stageWhere(ctx.taskId, stage.key),
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            error: null,
            ...(result.prompt !== undefined ? { prompt: result.prompt } : {}),
            ...(result.output !== undefined ? { output: result.output } : {}),
            ...(result.outputHtml !== undefined ? { outputHtml: result.outputHtml } : {}),
            ...(result.data !== undefined ? { data: result.data } : {}),
          },
        });
        await ctx.update({ progress: stage.progress, statusMessage: null });
        ctx.logger.child({ stage: stage.key }).info(`Stage completed: ${stage.label}`);
      } else {
        await prisma.articleStage.update({ where: stageWhere(ctx.taskId, stage.key), data: { status: 'PENDING' } });
      }
      return result;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const finalAttempt = !isRetryable(err) || attempt >= maxAttempts;
      if (finalAttempt) {
        const keepPending = err instanceof LoginRequiredError || err instanceof TaskCancelledError;
        await prisma.articleStage.update({
          where: stageWhere(ctx.taskId, stage.key),
          data: { status: keepPending ? 'PENDING' : 'FAILED', error: message.slice(0, 2000) },
        });
        throw err;
      }
      await ctx.logWithScreenshot(
        'WARN',
        stage.kind === 'wordpress' ? (stage.key === 'RANKMATH' ? 'RANKMATH' : 'WORDPRESS') : stage.kind === 'chatgpt' ? 'CHATGPT' : 'SYSTEM',
        `Stage "${stage.label}" failed on attempt ${attempt}/${maxAttempts}; retrying — ${message}`,
        screenshotLabel(stage),
        { error: message, attempt },
      );
      await prisma.articleStage.update({ where: stageWhere(ctx.taskId, stage.key), data: { error: message.slice(0, 2000) } });
      await ctx.recoverForRetry();
      await sleep(Math.min(30_000, 4000 * attempt));
    }
  }
}

async function handleFailure(ctx: PipelineContext, err: unknown): Promise<void> {
  const stage = ctx.currentStage;
  const message = (err as Error)?.message ?? String(err);

  if (err instanceof TaskCancelledError) {
    await ctx.update({ status: 'CANCELLED', statusMessage: 'Cancelled by user', cancelRequested: false, currentStage: stage?.key ?? null });
    await writeLog({ taskId: ctx.taskId, level: 'WARN', category: 'QUEUE', stage: stage?.key, message: 'Task cancelled' });
    return;
  }

  if (err instanceof LoginRequiredError) {
    await ctx.logWithScreenshot('WARN', err.service === 'chatgpt' ? 'CHATGPT' : 'WORDPRESS', message, `${err.service}-login-required`);
    await ctx.update({
      status: 'LOGIN_REQUIRED',
      loginRequiredFor: err.service,
      statusMessage: message,
      error: null,
      currentStage: stage?.key ?? null,
    });
    if (err.service === 'wordpress' && ctx.task.website?.profileId) {
      await markProfileSession(ctx.task.website.profileId, 'LOGIN_REQUIRED', message);
    }
    return;
  }

  const category = stage?.key === 'RANKMATH' ? 'RANKMATH' : stage?.kind === 'wordpress' ? 'WORDPRESS' : stage?.kind === 'chatgpt' ? 'CHATGPT' : 'SYSTEM';
  await ctx.logWithScreenshot('ERROR', category, `Task failed${stage ? ` during "${stage.label}"` : ''}: ${message}`, screenshotLabel(stage), {
    error: message,
    stack: err instanceof ConfigurationError ? undefined : (err as Error)?.stack,
  });
  await ctx.update({
    status: 'FAILED',
    error: message.slice(0, 2000),
    statusMessage: err instanceof ConfigurationError ? message : null,
    currentStage: stage?.key ?? null,
  });
}

export interface RunPipelineParams {
  taskId: string;
  mode: ArticleJobMode;
  stage?: string;
  browser: BrowserManager;
  pipeline: PipelineDefinition;
}

/**
 * Runs a task's stages in order, skipping stages that already completed. Every stage result is
 * persisted immediately, so a crash, a login expiry or a retry resumes from the last completed stage.
 */
export async function runPipeline(params: RunPipelineParams): Promise<void> {
  const { taskId, mode, pipeline } = params;
  const settings = await getSettings();
  const ctx = new PipelineContext(taskId, mode, params.browser, settings, pipeline);

  try {
    await ctx.reload();
  } catch {
    await writeLog({ level: 'WARN', category: 'QUEUE', message: `Task ${taskId} no longer exists; job skipped` });
    return;
  }

  try {
    if (ctx.task.cancelRequested) throw new TaskCancelledError();
    await ensureStageRows(taskId, pipeline);

    let keys = pipeline.stages.map((s) => s.key);
    if (mode === 'regenerate') {
      if (!params.stage) throw new ConfigurationError('No stage specified for regeneration');
      keys = pipeline.regenerationPlan(params.stage, ctx.task);
      await prisma.articleStage.updateMany({ where: { taskId, key: { in: keys } }, data: { status: 'PENDING', error: null } });
    }

    await ctx.update({ startedAt: ctx.task.startedAt ?? new Date(), error: null, loginRequiredFor: null, statusMessage: null });
    await writeLog({
      taskId,
      category: 'QUEUE',
      message: `Worker started ${mode === 'regenerate' ? `regenerating ${params.stage}` : 'the article workflow'}`,
    });

    for (const stage of pipeline.stages) {
      if (!keys.includes(stage.key)) continue;
      const row = await prisma.articleStage.findUnique({ where: stageWhere(taskId, stage.key), select: { status: true } });
      if (row?.status === 'COMPLETED' || row?.status === 'SKIPPED') continue;
      if (await ctx.isCancelRequested(true)) throw new TaskCancelledError();

      const result = await runStage(ctx, stage);
      if (result.outcome === 'paused') {
        await ctx.update({ status: result.status, statusMessage: result.message, currentStage: stage.key });
        await writeLog({ taskId, category: 'QUEUE', stage: stage.key, message: `Paused: ${result.message}` });
        return;
      }
    }

    if (mode === 'regenerate') await pipeline.afterRegeneration(ctx, params.stage!);
    else await pipeline.finalize(ctx);
  } catch (err) {
    await handleFailure(ctx, err).catch((e) => console.error('Failed to record task failure', e));
  } finally {
    await ctx.dispose();
  }
}

