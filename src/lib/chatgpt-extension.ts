// Shared contract between the worker, the web app and the "ChatGPT Worker" Chrome extension (extension/ folder).
// The worker puts each ChatGPT prompt in the built-in queue; the extension, running in the user's own Chrome
// profile, claims it, sends it on chatgpt.com and posts the answer back to /api/extension/agent.
import { z } from 'zod';

export const CHATGPT_EXTENSION_QUEUE = 'chatgpt';
/** WorkerStatus row that records when the extension last talked to the app. */
export const EXTENSION_STATUS_ID = 'chatgpt-extension';
/** Setting row holding the SHA-256 hash of the extension connection key (the key itself is never stored). */
export const EXTENSION_TOKEN_SETTING = 'chatgptExtensionKeyHash';
export const EXTENSION_AGENT_PATH = '/api/extension/agent';
export const IMAGE_SEARCH_UPDATE_MESSAGE = 'Update the ChatGPT Worker extension to 1.6.3 or newer in the Automation Chrome, then retry Images. The connected page script cannot save displayed gallery images.';

export function supportsImageSearchDownloads(version?: string): boolean {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return major > 1 || (major === 1 && (minor > 6 || (minor === 6 && patch >= 3)));
}

/** A claimed prompt with no progress report for this long is treated as abandoned (tab closed, Chrome quit). */
export const EXTENSION_STALE_MS = 90_000;
export const EXTENSION_ONLINE_MS = 30_000;
/** The extension's own background checks use client ids starting with this (they are not ChatGPT tabs). */
export const EXTENSION_SERVICE_CLIENT_PREFIX = 'extension-';

export interface ExtensionJobData {
  taskId: string;
  stageKey: string;
  keyword: string;
  prompt: string;
  /** Conversation to continue, or null to start a new chat. */
  conversationUrl: string | null;
  /** When the last message in the conversation already is this prompt, return its answer instead of re-sending. */
  allowReuse: boolean;
  chatgptUrl: string;
  navigationTimeoutMs: number;
  generationTimeoutMs: number;
  /** Collect generated images or a search gallery from ChatGPT as JPEG files. */
  images?: ExtensionImageRequest;
  /** Photos attached to the prompt (the paperclip), e.g. for the celebrity photo check. */
  attachments?: ExtensionAttachment[];
}

export interface ExtensionAttachment {
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  /** base64 */
  data: string;
}

export const ATTACHMENTS_UPDATE_MESSAGE =
  'Update the ChatGPT Worker extension to 1.6.8 or newer in the Automation Chrome: this prompt attaches photos.';

/** Extension 1.6.8 attaches photos to a prompt; an older one would send the prompt without them. */
export function supportsAttachments(version?: string): boolean {
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return major > 1 || (major === 1 && (minor > 6 || (minor === 6 && patch >= 8)));
}

export interface ExtensionImageRequest {
  /** Default: generated pictures. Search mode opens the image gallery returned by the prompt. */
  source?: 'generated' | 'search';
  count: number;
  width: number;
  height: number;
  /** Search: give up this long after ChatGPT's answer ended without a gallery (default 90 s; tests use less). */
  noGalleryAfterMs?: number;
}

/** An image the extension saved from the ChatGPT answer (the file is on this computer, not in the database). */
export interface ExtensionImageFile {
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export const EXTENSION_FAILURE_CODES = ['LOGIN', 'VERIFICATION', 'USAGE_LIMIT', 'CONVERSATION_LOST', 'UPDATE_REQUIRED', 'ERROR'] as const;
export type ExtensionFailureCode = (typeof EXTENSION_FAILURE_CODES)[number];

export interface ExtensionJobResult {
  text?: string;
  html?: string;
  conversationUrl?: string | null;
  reusedExisting?: boolean;
  files?: ExtensionImageFile[];
  /** Gallery pictures shown straight from the publisher's site, downloaded by the worker (see images/download.ts). */
  imageLinks?: { url: string; width: number; height: number }[];
  /** Why the ChatGPT page loaded again while the prompt was running. */
  note?: string;
  code?: ExtensionFailureCode | 'CANCELLED';
  /** Latest page diagnostics reported by the tab. */
  debug?: Record<string, unknown>;
}

const clientId = z.string().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const jobId = z.string().min(1).max(40);
const url = z.string().max(2000);
/** Page diagnostics from the tab (element counts, button labels — no answer text). */
const debug = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 4000, 'Diagnostics too large')
  .optional();

/** The extension runs in the separate automation Chrome (it has seen that Chrome's setup page). */
const automation = z.boolean().optional();

/** Page the worker opens in the automation Chrome; the extension recognises its Chrome by it. */
export const AUTOMATION_CHROME_PAGE = '/automation-chrome';

export const agentRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hello'), clientId, version: z.string().max(20).optional(), automation }),
  /** Background check by the extension: is there work, and how many ChatGPT tabs should be open? */
  z.object({ action: z.literal('status'), clientId, version: z.string().max(20).optional(), automation }),
  z.object({
    action: z.literal('claim'),
    clientId,
    version: z.string().max(20).optional(),
    imageSearch: z.boolean().optional(),
    automation,
    currentUrl: url.optional(),
    /** The tab is on ChatGPT, logged in, with the prompt box visible. */
    pageReady: z.boolean().optional(),
    /** Shown in Settings when the tab needs the user (login, "Verify you are human"). */
    attention: z.string().max(300).nullable().optional(),
  }),
  z.object({ action: z.literal('progress'), clientId, jobId, conversationUrl: url.nullable().optional(), debug }),
  z.object({
    action: z.literal('complete'),
    clientId,
    jobId,
    text: z.string().max(1_000_000),
    html: z.string().max(3_000_000),
    conversationUrl: url.nullable(),
    reusedExisting: z.boolean(),
    /** Images as base64: generated pictures are cropped, search pictures retain their original proportions. */
    images: z
      .array(
        z.object({
          mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
          data: z.string().max(12_000_000).regex(/^[A-Za-z0-9+/=]+$/),
          width: z.number().int().min(1).max(10_000),
          height: z.number().int().min(1).max(10_000),
        }),
      )
      .max(10)
      .optional(),
    /** Gallery pictures the page cannot read (publisher sites without CORS): the worker downloads these addresses. */
    imageLinks: z
      .array(
        z.object({
          url: z.string().max(2000).regex(/^https:\/\//),
          width: z.number().int().min(0).max(20_000),
          height: z.number().int().min(0).max(20_000),
        }),
      )
      .max(10)
      .optional(),
    /** Why the ChatGPT page loaded again while this prompt was running. */
    note: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal('fail'),
    clientId,
    jobId,
    code: z.enum(EXTENSION_FAILURE_CODES),
    message: z.string().max(2000),
    debug,
  }),
]);

export type AgentRequest = z.infer<typeof agentRequestSchema>;

/** "https://chatgpt.com/c/abc?model=x" → "https://chatgpt.com/c/abc" (used to match tabs to conversations). */
export function conversationKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const match = u.pathname.match(/\/c\/[a-zA-Z0-9-]+/);
    return match ? `${u.origin}${match[0]}` : null;
  } catch {
    return null;
  }
}
