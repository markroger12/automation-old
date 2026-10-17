import type { LogLevel, Prisma } from '@prisma/client';
import { prisma } from './db';

export type LogCategory =
  | 'SYSTEM'
  | 'BROWSER'
  | 'CHATGPT'
  | 'WORDPRESS'
  | 'RANKMATH'
  | 'SEO'
  | 'QUEUE'
  | 'SESSION';

export interface LogEntry {
  taskId?: string | null;
  level?: LogLevel;
  category: LogCategory;
  stage?: string | null;
  message: string;
  data?: unknown;
  screenshotPath?: string | null;
}

const SENSITIVE_KEY = /pass(word|wd|phrase)?$|secret|token|cookie|authorization|credential|api[_-]?key|session[_-]?id/i;
const MAX_STRING = 60_000;

/** Deep-copies a value while masking anything that looks like a credential. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[depth-limit]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [truncated ${value.length - MAX_STRING} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export async function writeLog(entry: LogEntry): Promise<void> {
  const level = entry.level ?? 'INFO';
  const prefix = `[${new Date().toISOString()}] ${level} ${entry.category}${entry.stage ? `/${entry.stage}` : ''}${
    entry.taskId ? ` task=${entry.taskId}` : ''
  }`;
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(`${prefix} ${entry.message}`);
  try {
    await prisma.log.create({
      data: {
        taskId: entry.taskId ?? null,
        level,
        category: entry.category,
        stage: entry.stage ?? null,
        message: entry.message.slice(0, 5000),
        data: entry.data === undefined ? undefined : (redact(entry.data) as Prisma.InputJsonValue),
        screenshotPath: entry.screenshotPath ?? null,
      },
    });
  } catch (err) {
    console.error(`${prefix} failed to persist log: ${(err as Error).message}`);
  }
}

/** Minimal logger interface used by the automation layer (kept free of DB concerns). */
export interface AutomationLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(base: { taskId?: string | null; category: LogCategory; stage?: string | null }): AutomationLogger & {
  child(overrides: Partial<{ category: LogCategory; stage: string | null }>): AutomationLogger;
} {
  const emit = (level: LogLevel) => (message: string, data?: unknown) => {
    void writeLog({ ...base, level, message, data });
  };
  return {
    debug: emit('DEBUG'),
    info: emit('INFO'),
    warn: emit('WARN'),
    error: emit('ERROR'),
    child: (overrides) => createLogger({ ...base, ...overrides }),
  };
}
