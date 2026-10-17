import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { downloadGalleryPicture } from '@/automation/images/download';
import { imagesRoot } from '@/lib/paths';
import { stripChatGPTDirectives, stripChatGPTDirectivesHtml } from '@/content/cleanup';
import {
  CHATGPT_EXTENSION_QUEUE,
  EXTENSION_STALE_MS,
  type ExtensionImageFile,
  type ExtensionJobData,
  type ExtensionJobResult,
} from '@/lib/chatgpt-extension';
import { prisma } from '@/lib/db';
import type { AutomationLogger } from '@/lib/logger';
import { sleep } from '../browser/locators';
import {
  AutomationTimeoutError,
  ConversationLostError,
  GenerationError,
  ExtensionUpdateRequiredError,
  LoginRequiredError,
  TaskCancelledError,
  UsageLimitError,
} from '../errors';

/**
 * A chat ChatGPT can open again, or null. "/c/local-chatgpt:<id>" is the page's placeholder while ChatGPT has not
 * created the chat (or refused to, HTTP 429): saved as the task's chat on 8 October 2026, every later stage failed with
 * "ChatGPT did not open https://chatgpt.com/c/local-chatgpt…".
 */
export function realChatUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /\/c\/local-/i.test(decodeURIComponent(url)) ? null : url;
}

export interface ChatGPTAnswer {
  text: string;
  html: string;
  conversationUrl: string | null;
  /** true when an answer already in the conversation was returned instead of sending the prompt again */
  reusedExisting: boolean;
  durationMs: number;
  /** Images ChatGPT created for this prompt (only when the prompt asked for images). */
  files: ExtensionImageFile[];
}

/** How long a prompt may wait for the extension to pick it up before the task pauses as "Login Required". */
export const EXTENSION_PICKUP_TIMEOUT_MS = 30 * 60_000;

export interface ExtensionAskOptions extends Omit<ExtensionJobData, 'taskId' | 'stageKey'> {
  taskId: string;
  stageKey: string;
  logger: AutomationLogger;
  shouldAbort: () => Promise<boolean>;
  /** Shown on the task while nothing has picked the prompt up yet (null clears it). */
  onWaiting?: (message: string | null) => Promise<unknown>;
  /** Called as soon as ChatGPT assigned the conversation URL, so a crash mid-answer can still resume it. */
  onConversationUrl?: (url: string) => Promise<unknown>;
  pollIntervalMs?: number;
  pickupTimeoutMs?: number;
  /** Downloads a gallery picture the extension could only hand over as an address (a test passes its own). */
  downloadPicture?: (url: string, fileBase: string) => Promise<ExtensionImageFile>;
}

/** Gallery pictures shown straight from the publisher's site: downloaded next to the extension's own files. */
async function downloadLinkedPictures(
  links: NonNullable<ExtensionJobResult['imageLinks']>,
  jobId: string,
  taskId: string,
  logger: AutomationLogger,
  download: (url: string, fileBase: string) => Promise<ExtensionImageFile>,
): Promise<ExtensionImageFile[]> {
  const folder = path.join(imagesRoot(), taskId.replace(/[^a-zA-Z0-9_-]/g, ''));
  await fs.mkdir(folder, { recursive: true });
  const files: ExtensionImageFile[] = [];
  const problems: string[] = [];
  for (const [index, link] of links.entries()) {
    try {
      files.push(await download(link.url, path.join(folder, `${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}-site-${index + 1}`)));
    } catch (err) {
      problems.push(`${new URL(link.url).hostname}: ${(err as Error).message}`);
    }
  }
  if (files.length) logger.info(`${files.length} gallery picture(s) downloaded from the publishers' sites`);
  if (problems.length) logger.warn(`${problems.length} gallery picture(s) could not be downloaded — ${problems.slice(0, 3).join(' | ')}`);
  return files;
}

async function closeJob(id: string, error: string, code: ExtensionJobResult['code']): Promise<void> {
  await prisma.queueJob.updateMany({
    where: { id, status: { in: ['WAITING', 'ACTIVE'] } },
    data: { status: 'FAILED', error, result: { code } as Prisma.InputJsonValue, finishedAt: new Date() },
  });
}

function errorFor(code: ExtensionJobResult['code'], message: string): Error {
  switch (code) {
    case 'UPDATE_REQUIRED':
      return new ExtensionUpdateRequiredError(message);
    case 'LOGIN':
    case 'VERIFICATION':
      return new LoginRequiredError('chatgpt', message);
    case 'USAGE_LIMIT':
      return new UsageLimitError(message);
    case 'CONVERSATION_LOST':
      return new ConversationLostError(message);
    case 'CANCELLED':
      return new TaskCancelledError();
    default:
      return new GenerationError(message);
  }
}

/**
 * Sends one prompt through the ChatGPT Worker Chrome extension: queues it, waits while a ChatGPT tab
 * in the user's Chrome answers it, and returns the answer.
 */
export async function askChatGPTViaExtension(options: ExtensionAskOptions): Promise<ChatGPTAnswer> {
  const { logger, shouldAbort, onWaiting, onConversationUrl } = options;
  const pollMs = options.pollIntervalMs ?? 1000;
  const pickupTimeoutMs = options.pickupTimeoutMs ?? EXTENSION_PICKUP_TIMEOUT_MS;
  const data: ExtensionJobData = {
    taskId: options.taskId,
    stageKey: options.stageKey,
    keyword: options.keyword,
    prompt: options.prompt,
    conversationUrl: realChatUrl(options.conversationUrl),
    allowReuse: options.allowReuse,
    chatgptUrl: options.chatgptUrl,
    navigationTimeoutMs: options.navigationTimeoutMs,
    generationTimeoutMs: options.generationTimeoutMs,
    ...(options.images ? { images: options.images } : {}),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
  };
  const started = Date.now();
  const job = await prisma.queueJob.create({
    data: {
      queue: CHATGPT_EXTENSION_QUEUE,
      name: options.stageKey,
      taskId: options.taskId,
      data: data as unknown as Prisma.InputJsonValue,
    },
  });

  let waitingShown = false;
  let pickedUp = false;
  let knownUrl = options.conversationUrl;
  // Generous: the tab may first wait for the user to finish a "Verify you are human" check.
  const answerTimeoutMs = options.generationTimeoutMs + options.navigationTimeoutMs * 2 + 15 * 60_000;

  try {
    for (;;) {
      if (await shouldAbort()) {
        await closeJob(job.id, 'Task cancelled', 'CANCELLED');
        throw new TaskCancelledError();
      }
      const row = await prisma.queueJob.findUnique({ where: { id: job.id } });
      if (!row) throw new GenerationError('The ChatGPT prompt was removed from the queue');
      const result = (row.result as ExtensionJobResult | null) ?? {};

      if (row.status === 'COMPLETED') {
        const files = [...(result.files ?? [])];
        if (result.imageLinks?.length) {
          files.push(...(await downloadLinkedPictures(result.imageLinks, job.id, options.taskId, logger, options.downloadPicture ?? downloadGalleryPicture)));
        }
        // An image answer may carry no text at all.
        if (!result.text?.trim() && !files.length) throw new GenerationError('ChatGPT returned an empty response');
        if (result.note) logger.warn(result.note);
        return {
          // Without ChatGPT's writing-document marks (":::writing{…}" … ":::"), which the conversation data carries.
          text: stripChatGPTDirectives(result.text ?? '').trim(),
          html: stripChatGPTDirectivesHtml(result.html ?? ''),
          conversationUrl: realChatUrl(result.conversationUrl),
          reusedExisting: Boolean(result.reusedExisting),
          durationMs: Date.now() - started,
          files,
        };
      }
      if (row.status === 'FAILED') {
        if (result.debug) logger.warn('ChatGPT page state reported by the extension', { debug: result.debug });
        throw errorFor(result.code, row.error ?? 'The ChatGPT extension reported an error');
      }

      if (row.status === 'WAITING') {
        if (!waitingShown && Date.now() - started > 15_000) {
          waitingShown = true;
          const message = 'Waiting for the ChatGPT Chrome extension — it opens ChatGPT tabs by itself once Chrome with the extension is open';
          logger.warn(message);
          await onWaiting?.(message);
        }
        if (Date.now() - started > pickupTimeoutMs) {
          const message =
            'The ChatGPT Chrome extension did not pick up the prompt. Open the Chrome profile with the extension (automatic start must not be paused) — the task continues automatically once it connects.';
          await closeJob(job.id, message, 'LOGIN');
          throw new LoginRequiredError('chatgpt', message);
        }
      } else if (row.status === 'ACTIVE') {
        if (!pickedUp) {
          pickedUp = true;
          logger.info('ChatGPT extension picked up the prompt');
          if (waitingShown) await onWaiting?.(null);
        }
        const chatUrl = realChatUrl(result.conversationUrl);
        if (chatUrl && chatUrl !== knownUrl) {
          knownUrl = chatUrl;
          await onConversationUrl?.(chatUrl);
        }
        const lastBeat = (row.heartbeatAt ?? row.startedAt ?? row.createdAt).getTime();
        if (Date.now() - lastBeat > EXTENSION_STALE_MS) {
          const message = 'The ChatGPT extension tab stopped responding (closed, reloaded or Chrome was quit)';
          await closeJob(job.id, message, 'ERROR');
          throw new GenerationError(message);
        }
        if (row.startedAt && Date.now() - row.startedAt.getTime() > answerTimeoutMs) {
          const message = `ChatGPT response did not complete within ${Math.round(answerTimeoutMs / 60_000)} minutes`;
          await closeJob(job.id, message, 'ERROR');
          throw new AutomationTimeoutError(message);
        }
      }
      await sleep(pollMs);
    }
  } catch (err) {
    // Never leave a prompt queued that nobody is waiting for.
    await closeJob(job.id, (err as Error).message ?? 'Stopped', 'ERROR').catch(() => undefined);
    throw err;
  } finally {
    // Attached photos are only needed while the tab sends the prompt: the database does not keep them.
    if (data.attachments) {
      const { attachments: _photos, ...rest } = data;
      await prisma.queueJob.update({ where: { id: job.id }, data: { data: rest as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
    }
  }
}
