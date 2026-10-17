import type { Prisma, QueueJob } from '@prisma/client';
import { askChatGPTViaExtension } from '@/automation/chatgpt/extension-bridge';
import { ConfigurationError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/automation/errors';
import { humanize, type HumanizeResult } from '@/content/humanizer/humanize';
import { prisma } from '@/lib/db';
import { createLogger, writeLog } from '@/lib/logger';
import type { HumanizerJobData } from '@/lib/queue';
import { getSettings } from '@/lib/settings';

export interface HumanizerJobResult extends HumanizeResult {
  conversationUrls: string[];
  durationMs: number;
}

/**
 * One Humanizer test run. Every part goes to a new chat: seen live on 27 September 2026, ChatGPT answered part 1 in a
 * writing block (canvas), and part 2 sent into that chat never showed up as the last prompt of the conversation.
 */
export async function handleHumanizerJob(data: HumanizerJobData, job: QueueJob): Promise<HumanizerJobResult> {
  const settings = await getSettings();
  const logger = createLogger({ category: 'CHATGPT', stage: 'HUMANIZER' });
  const started = Date.now();
  const conversationUrls: string[] = [];

  const result = await humanize({
    input: data.input,
    keyword: data.keyword,
    promptTemplate: data.prompt,
    rewriteAll: data.rewriteAll,
    stopOn: (err) => err instanceof TaskCancelledError || err instanceof LoginRequiredError || err instanceof UsageLimitError || err instanceof ConfigurationError,
    onProgress: (message) =>
      prisma.queueJob
        .update({ where: { id: job.id }, data: { result: { progress: message } as Prisma.InputJsonValue } })
        .catch(() => undefined),
    ask: async (prompt) => {
      const answer = await askChatGPTViaExtension({
        taskId: `humanizer-${job.id}`,
        stageKey: 'HUMANIZER',
        keyword: data.keyword || 'Humanizer test',
        prompt,
        conversationUrl: null,
        allowReuse: false,
        chatgptUrl: settings.chatgptUrl,
        navigationTimeoutMs: settings.browserTimeoutSec * 1000,
        generationTimeoutMs: settings.generationTimeoutSec * 1000,
        logger,
        // "Stop" on the page marks the job failed; the prompt is then withdrawn.
        shouldAbort: async () => (await prisma.queueJob.findUnique({ where: { id: job.id }, select: { status: true } }))?.status !== 'ACTIVE',
      });
      if (answer.conversationUrl) conversationUrls.push(answer.conversationUrl);
      return answer.text;
    },
  });

  await writeLog({
    category: 'CHATGPT',
    stage: 'HUMANIZER',
    level: result.failedPrompts.length ? 'WARN' : 'INFO',
    message: `Humanizer test: ${result.rewritten} of ${result.sent} paragraph(s) rewritten, ${result.keptOriginal} kept as they were; signals per 1,000 words ${result.before.signalsPer1000} → ${result.after.signalsPer1000}${result.failedPrompts.length ? `; failed: ${result.failedPrompts.join(' | ')}` : ''}`,
  });
  return { ...result, conversationUrls, durationMs: Date.now() - started };
}
