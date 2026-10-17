import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, QueueJob } from '@prisma/client';
import { safeEqual } from '../auth/session';
import {
  CHATGPT_EXTENSION_QUEUE,
  EXTENSION_ONLINE_MS,
  EXTENSION_SERVICE_CLIENT_PREFIX,
  EXTENSION_STATUS_ID,
  EXTENSION_TOKEN_SETTING,
  IMAGE_SEARCH_UPDATE_MESSAGE,
  ATTACHMENTS_UPDATE_MESSAGE,
  supportsAttachments,
  supportsImageSearchDownloads,
  conversationKey,
  type AgentRequest,
  type ExtensionImageFile,
  type ExtensionJobData,
  type ExtensionJobResult,
} from '../chatgpt-extension';
import { prisma } from '../db';
import { HttpError } from '../http-error';
import { writeLog } from '../logger';
import { imagesRoot } from '../paths';
import { getSettings } from '../settings';
import { IN_FLIGHT_STATUSES, type TaskStatusValue } from '../task-status';

/** Task statuses in which an article still needs ChatGPT (queued, or in one of the ChatGPT steps). */
const NEEDS_CHATGPT_STATUSES: TaskStatusValue[] = [
  'QUEUED',
  'OPENING_CHATGPT',
  'GENERATING_TITLES',
  'RESEARCHING',
  'WRITING_ARTICLE',
  'OPTIMIZING',
  'GENERATING_FAQS',
  'GENERATING_BIO_TABLE',
];
import { resumeTasksWaitingForLogin } from './tasks';

interface ClientInfo {
  imageSearch?: boolean;
  seenAt: string;
  url: string | null;
  ready: boolean;
  attention: string | null;
  version: string | null;
  /** Runs in the separate automation Chrome. */
  automation: boolean;
}

// In-memory view of connected extension tabs (also persisted, throttled, for the Settings page).
const clients = new Map<string, ClientInfo>();
let lastPersistAt = 0;
let lastResumeAt = 0;

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Creates a new connection key (shown to the user once). Any previous key stops working. */
export async function generateExtensionKey(): Promise<string> {
  const key = `bas_${randomBytes(24).toString('base64url')}`;
  const value = { hash: hashKey(key), createdAt: new Date().toISOString() };
  await prisma.setting.upsert({
    where: { key: EXTENSION_TOKEN_SETTING },
    create: { key: EXTENSION_TOKEN_SETTING, value },
    update: { value },
  });
  await writeLog({ level: 'WARN', category: 'SESSION', message: 'A new ChatGPT extension connection key was created' });
  return key;
}

export async function assertExtensionKey(authorization: string | null): Promise<void> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) throw new HttpError(401, 'Connection key missing. Paste the key from Settings into the extension.');
  const row = await prisma.setting.findUnique({ where: { key: EXTENSION_TOKEN_SETTING } });
  const stored = (row?.value as { hash?: string } | null)?.hash;
  if (!stored || !safeEqual(stored, hashKey(key))) {
    throw new HttpError(401, 'Wrong connection key. Create a new key in Settings and paste it into the extension.');
  }
}

async function touchClient(clientId: string, patch: Partial<ClientInfo>): Promise<void> {
  const previous = clients.get(clientId);
  const next: ClientInfo = {
    url: previous?.url ?? null,
    ready: previous?.ready ?? false,
    attention: previous?.attention ?? null,
    version: previous?.version ?? null,
    automation: previous?.automation ?? false,
    ...patch,
    seenAt: new Date().toISOString(),
  };
  clients.set(clientId, next);

  const now = Date.now();
  for (const [id, info] of clients) {
    if (now - Date.parse(info.seenAt) > 10 * 60_000) clients.delete(id);
  }
  // Write at most every 5s unless something the user must see changed.
  if (next.automation && !previous?.automation) await rememberAutomationChrome();
  if (now - lastPersistAt < 5000 && previous?.attention === next.attention && previous?.automation === next.automation) return;
  lastPersistAt = now;
  const info = { clients: Object.fromEntries(clients) } as unknown as Prisma.InputJsonValue;
  await prisma.workerStatus
    .upsert({
      where: { id: EXTENSION_STATUS_ID },
      create: { id: EXTENSION_STATUS_ID, lastSeenAt: new Date(), info },
      update: { lastSeenAt: new Date(), info },
    })
    .catch(() => undefined);
}

/** Setting row: when an extension in the automation Chrome first connected (its setup is done). */
export const AUTOMATION_CHROME_SEEN_SETTING = 'automationChromeSeenAt';

async function rememberAutomationChrome(): Promise<void> {
  const value = new Date().toISOString();
  await prisma.setting
    .upsert({ where: { key: AUTOMATION_CHROME_SEEN_SETTING }, create: { key: AUTOMATION_CHROME_SEEN_SETTING, value }, update: { value } })
    .catch(() => undefined);
}

/** Is an extension in the automation Chrome connected right now? */
function automationChromeOnline(): boolean {
  const now = Date.now();
  return [...clients.values()].some((c) => c.automation && now - Date.parse(c.seenAt) < 60_000);
}

/**
 * With the separate automation Chrome in use, an extension still installed in the normal Chrome stays idle: it takes no
 * prompts and opens no ChatGPT tabs (those windows would jump to the front again).
 */
async function standsBy(fromAutomationChrome: boolean | undefined): Promise<boolean> {
  if (fromAutomationChrome || !automationChromeOnline()) return false;
  return (await getSettings()).chatgptChromeMode === 'separate';
}

const STANDBY_REASON = 'The articles are written in the automation Chrome now — remove this extension from your normal Chrome.';

function onlineClients(exceptId: string): ClientInfo[] {
  const now = Date.now();
  return [...clients.entries()]
    .filter(([id, c]) => id !== exceptId && !id.startsWith(EXTENSION_SERVICE_CLIENT_PREFIX) && now - Date.parse(c.seenAt) < 15_000)
    .map(([, c]) => c);
}

async function claim(body: Extract<AgentRequest, { action: 'claim' }>) {
  await touchClient(body.clientId, {
    version: body.version ?? null,
    imageSearch: body.imageSearch === true,
    url: body.currentUrl ?? null,
    ready: Boolean(body.pageReady),
    attention: body.attention ?? null,
    automation: Boolean(body.automation),
  });
  if (!body.pageReady) return { job: null };
  if (await standsBy(body.automation)) return { job: null, idleReason: STANDBY_REASON };

  // A tab that asks for work holds no job any more (it finished, or it reloaded without resuming).
  await prisma.queueJob.updateMany({
    where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'ACTIVE', lockedBy: body.clientId },
    data: { status: 'FAILED', error: 'The ChatGPT tab was reloaded before the answer was returned', finishedAt: new Date() },
  });

  const waiting = await prisma.queueJob.findMany({
    where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'WAITING' },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });

  if (!waiting.length) {
    // The extension is connected and logged in: tasks paused for ChatGPT can continue.
    if (Date.now() - lastResumeAt > 2 * 60_000) {
      lastResumeAt = Date.now();
      const resumed = await resumeTasksWaitingForLogin('chatgpt').catch(() => 0);
      if (resumed) await writeLog({ category: 'SESSION', message: `ChatGPT extension connected — ${resumed} waiting task(s) resumed` });
    }
    return { job: null };
  }

  const here = conversationKey(body.currentUrl);
  const othersOn = new Set(onlineClients(body.clientId).map((c) => conversationKey(c.url)).filter(Boolean));
  const score = (job: QueueJob) => {
    const target = conversationKey((job.data as unknown as ExtensionJobData).conversationUrl);
    if (target && target === here) return 0; // this tab already shows the conversation
    // Leave a conversation to the tab that already has it open, unless that tab has not taken it for a while.
    if (target && othersOn.has(target) && Date.now() - job.createdAt.getTime() < 20_000) return 2;
    return 1;
  };
  const candidates = waiting.map((job) => ({ job, s: score(job) })).filter((c) => c.s < 2);
  candidates.sort((a, b) => a.s - b.s);

  for (const { job } of candidates) {
    if ((job.data as unknown as ExtensionJobData).images?.source === 'search' && (!body.imageSearch || !supportsImageSearchDownloads(body.version))) {
      // An old content script can otherwise wait ten minutes for ten generated pictures, ignoring the gallery.
      await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'WAITING' },
        data: { status: 'FAILED', error: IMAGE_SEARCH_UPDATE_MESSAGE, result: { code: 'UPDATE_REQUIRED' }, finishedAt: new Date() },
      });
      return { job: null, idleReason: IMAGE_SEARCH_UPDATE_MESSAGE };
    }
    if ((job.data as unknown as ExtensionJobData).attachments?.length && !supportsAttachments(body.version)) {
      // An older content script would send the prompt without the photos, and ChatGPT would answer about nothing.
      await prisma.queueJob.updateMany({
        where: { id: job.id, status: 'WAITING' },
        data: { status: 'FAILED', error: ATTACHMENTS_UPDATE_MESSAGE, result: { code: 'UPDATE_REQUIRED' }, finishedAt: new Date() },
      });
      return { job: null, idleReason: ATTACHMENTS_UPDATE_MESSAGE };
    }
    const now = new Date();
    const taken = await prisma.queueJob.updateMany({
      where: { id: job.id, status: 'WAITING' },
      data: { status: 'ACTIVE', lockedBy: body.clientId, startedAt: now, heartbeatAt: now, attempts: { increment: 1 } },
    });
    if (taken.count) return { job: { id: job.id, ...(job.data as unknown as ExtensionJobData) } };
  }
  return { job: null };
}

function ownJob(jobId: string, clientId: string) {
  return { id: jobId, queue: CHATGPT_EXTENSION_QUEUE, status: 'ACTIVE' as const, lockedBy: clientId };
}

async function sameChatHost(url: string | null | undefined): Promise<string | null> {
  const key = conversationKey(url);
  if (!key) return null;
  const { chatgptUrl } = await getSettings();
  return new URL(key).origin === new URL(chatgptUrl).origin ? key : null;
}

/** Handles one request from the Chrome extension (already authenticated with the connection key). */
export async function handleAgentRequest(body: AgentRequest): Promise<Record<string, unknown>> {
  switch (body.action) {
    case 'hello': {
      await touchClient(body.clientId, { version: body.version ?? null, automation: Boolean(body.automation) });
      const settings = await getSettings();
      return { ok: true, chatgptUrl: settings.chatgptUrl, concurrency: settings.taskConcurrency };
    }

    case 'status': {
      await touchClient(body.clientId, { version: body.version ?? null, automation: Boolean(body.automation) });
      const settings = await getSettings();
      if (await standsBy(body.automation)) {
        return { chatgptUrl: settings.chatgptUrl, concurrency: settings.taskConcurrency, waitingPrompts: 0, activePrompts: 0, work: false, wantedTabs: 0, standby: STANDBY_REASON };
      }
      const [waitingPrompts, activePrompts, activeTasks, chatgptTasks, waitingForChatGPT] = await Promise.all([
        prisma.queueJob.count({ where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'WAITING' } }),
        prisma.queueJob.count({ where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'ACTIVE' } }),
        prisma.articleTask.count({ where: { status: { in: IN_FLIGHT_STATUSES as TaskStatusValue[] } } }),
        prisma.articleTask.count({ where: { status: { in: NEEDS_CHATGPT_STATUSES } } }),
        prisma.articleTask.count({ where: { status: 'LOGIN_REQUIRED', loginRequiredFor: 'chatgpt' } }),
      ]);
      return {
        chatgptUrl: settings.chatgptUrl,
        concurrency: settings.taskConcurrency,
        waitingPrompts,
        activePrompts,
        work: waitingPrompts + activePrompts + activeTasks + waitingForChatGPT > 0,
        // One tab per article that still needs ChatGPT (at most Task Concurrency). Tabs beyond this are closed
        // once idle, e.g. when an article's ChatGPT steps are done and it moves on to WordPress.
        wantedTabs: Math.min(settings.taskConcurrency, Math.max(waitingPrompts + activePrompts, chatgptTasks + waitingForChatGPT)),
      };
    }

    case 'claim':
      return claim(body);

    case 'progress': {
      await touchClient(body.clientId, { attention: null });
      const conversationUrl = await sameChatHost(body.conversationUrl);
      const result: ExtensionJobResult = { ...(conversationUrl ? { conversationUrl } : {}), ...(body.debug ? { debug: body.debug } : {}) };
      const updated = await prisma.queueJob.updateMany({
        where: ownJob(body.jobId, body.clientId),
        data: { heartbeatAt: new Date(), ...(Object.keys(result).length ? { result: result as Prisma.InputJsonValue } : {}) },
      });
      // continue=false tells the tab to drop the prompt (task cancelled, timed out or taken back).
      return { continue: updated.count > 0 };
    }

    case 'complete': {
      await touchClient(body.clientId, { attention: null });
      const job = await prisma.queueJob.findFirst({ where: ownJob(body.jobId, body.clientId), select: { taskId: true } });
      if (!job) return { ok: false };
      // Images are written to data/images/<task>/ — only their paths go into the database.
      const files = body.images?.length ? await saveJobImages(job.taskId ?? 'unassigned', body.jobId, body.images) : undefined;
      const result: ExtensionJobResult = {
        text: body.text,
        html: body.html,
        conversationUrl: await sameChatHost(body.conversationUrl),
        reusedExisting: body.reusedExisting,
        ...(files ? { files } : {}),
        ...(body.imageLinks?.length ? { imageLinks: body.imageLinks } : {}),
        ...(body.note ? { note: body.note } : {}),
      };
      const updated = await prisma.queueJob.updateMany({
        where: ownJob(body.jobId, body.clientId),
        data: { status: 'COMPLETED', result: result as Prisma.InputJsonValue, finishedAt: new Date(), heartbeatAt: new Date() },
      });
      if (!updated.count && files) await Promise.all(files.map((f) => fs.rm(f.path, { force: true })));
      return { ok: updated.count > 0 };
    }

    case 'fail': {
      const updated = await prisma.queueJob.updateMany({
        where: ownJob(body.jobId, body.clientId),
        data: {
          status: 'FAILED',
          error: body.message,
          result: { code: body.code, ...(body.debug ? { debug: body.debug } : {}) } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      return { ok: updated.count > 0 };
    }
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function saveJobImages(
  taskId: string,
  jobId: string,
  images: { mime: string; data: string; width: number; height: number }[],
): Promise<ExtensionImageFile[]> {
  const folder = path.join(imagesRoot(), taskId.replace(/[^a-zA-Z0-9_-]/g, ''));
  await fs.mkdir(folder, { recursive: true });
  const files: ExtensionImageFile[] = [];
  for (const [index, image] of images.entries()) {
    const bytes = Buffer.from(image.data, 'base64');
    const file = path.join(folder, `${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}-${index + 1}.${IMAGE_EXTENSIONS[image.mime] ?? 'jpg'}`);
    await fs.writeFile(file, bytes);
    files.push({ path: file, mime: image.mime, width: image.width, height: image.height, bytes: bytes.length });
  }
  return files;
}

export interface ExtensionStatus {
  versions: string[];
  keyCreatedAt: string | null;
  online: boolean;
  lastSeenAt: string | null;
  tabs: { id: string; seenAt: string; ready: boolean; attention: string | null; online: boolean }[];
  waitingPrompts: number;
  activePrompts: number;
  /** An extension in the separate automation Chrome is connected. */
  automationConnected: boolean;
  /** An extension in the normal Chrome (not the automation Chrome) is connected. */
  normalChromeConnected: boolean;
}

export async function getExtensionStatus(): Promise<ExtensionStatus> {
  const [keyRow, status, waitingPrompts, activePrompts] = await Promise.all([
    prisma.setting.findUnique({ where: { key: EXTENSION_TOKEN_SETTING } }),
    prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } }),
    prisma.queueJob.count({ where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'WAITING' } }),
    prisma.queueJob.count({ where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'ACTIVE' } }),
  ]);
  const now = Date.now();
  const stored = ((status?.info as { clients?: Record<string, ClientInfo> } | null)?.clients ?? {}) as Record<string, ClientInfo>;
  const tabs = Object.entries(stored)
    .filter(([id]) => !id.startsWith(EXTENSION_SERVICE_CLIENT_PREFIX))
    .map(([id, c]) => ({ id, seenAt: c.seenAt, ready: c.ready, attention: c.attention, online: now - Date.parse(c.seenAt) < EXTENSION_ONLINE_MS }))
    .filter((t) => now - Date.parse(t.seenAt) < 10 * 60_000);
  const recent = Object.values(stored).filter((c) => now - Date.parse(c.seenAt) < 60_000);
  return {
    versions: [...new Set(recent.map((client) => client.version).filter((version): version is string => Boolean(version)))],
    automationConnected: recent.some((c) => c.automation),
    normalChromeConnected: recent.some((c) => !c.automation),
    keyCreatedAt: (keyRow?.value as { createdAt?: string } | null)?.createdAt ?? null,
    online: Boolean(status && now - status.lastSeenAt.getTime() < EXTENSION_ONLINE_MS),
    lastSeenAt: status?.lastSeenAt.toISOString() ?? null,
    tabs,
    waitingPrompts,
    activePrompts,
  };
}
