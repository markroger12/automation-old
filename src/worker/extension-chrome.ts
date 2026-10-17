import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowserExecutable } from '@/automation/browser/system-browser';
import { CHATGPT_EXTENSION_QUEUE, EXTENSION_ONLINE_MS, EXTENSION_STATUS_ID } from '@/lib/chatgpt-extension';
import { AUTOMATION_CHROME_SEEN_SETTING } from '@/lib/services/chatgpt-extension';
import { prisma } from '@/lib/db';
import { writeLog } from '@/lib/logger';
import { dataRoot } from '@/lib/paths';
import { getSettings } from '@/lib/settings';

function chromeUserDataDir(): string | null {
  const home = os.homedir();
  const dir =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
        : path.join(home, '.config', 'google-chrome');
  return fs.existsSync(dir) ? dir : null;
}

/** Chrome shows profile names ("automation") but launches by folder ("Profile 19"); the mapping is in "Local State". */
export function findChromeProfileFolder(name: string): string | null {
  const dir = chromeUserDataDir();
  if (!dir || !name.trim()) return null;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'Local State'), 'utf8')) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const wanted = name.trim().toLowerCase();
    for (const [folder, info] of Object.entries(state.profile?.info_cache ?? {})) {
      if (folder.toLowerCase() === wanted || (info.name ?? '').trim().toLowerCase() === wanted) return folder;
    }
  } catch {
    /* Chrome not installed or file busy */
  }
  return null;
}

/** The automation Chrome's own folder: its ChatGPT login and the extension live here, apart from the normal Chrome. */
export function automationChromeDir(): string {
  return path.join(dataRoot(), 'chatgpt-chrome');
}

/**
 * Chrome normally stops drawing a window that is covered by other windows — ChatGPT's answer then never finishes and
 * the extension had to bring the window to the front. These switches keep it drawing in the background. They only
 * work for a Chrome started with its own folder (a profile inside the normal Chrome shares that Chrome's settings).
 */
export const AUTOMATION_CHROME_SWITCHES = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--no-first-run',
  '--no-default-browser-check',
];

export function automationChromeArgs(dir: string, urls: string[]): string[] {
  return [`--user-data-dir=${dir}`, ...AUTOMATION_CHROME_SWITCHES, ...(urls.length ? urls : ['--no-startup-window'])];
}

/** Starts the automation Chrome (a normal Chrome — nothing is attached to it). Returns false when Chrome is not installed. */
export function launchAutomationChrome(urls: string[] = []): boolean {
  const executable = findBrowserExecutable('chrome');
  if (!executable) return false;
  const dir = automationChromeDir();
  fs.mkdirSync(dir, { recursive: true });
  spawn(executable, automationChromeArgs(dir, urls), { detached: true, stdio: 'ignore' }).unref();
  return true;
}

let lastOpenedAt = 0;
let attempts = 0;
let warned = false;

/**
 * When ChatGPT prompts are waiting and the extension has not been in touch, open the Chrome profile that has
 * the extension (a normal Chrome, nothing attached). The extension then opens its ChatGPT tabs by itself.
 */
export async function openExtensionChromeIfNeeded(): Promise<void> {
  const waiting = await prisma.queueJob.findFirst({
    where: { queue: CHATGPT_EXTENSION_QUEUE, status: 'WAITING' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (!waiting) {
    attempts = 0;
    return;
  }
  // An open extension checks every 30 seconds; only step in when it clearly is not running.
  if (Date.now() - waiting.createdAt.getTime() < 45_000) return;
  const settings = await getSettings();
  const status = await prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } });
  const clients = Object.values(((status?.info as { clients?: Record<string, { seenAt: string; automation?: boolean }> } | null)?.clients ?? {}));
  const onlineWithin = (ms: number) => clients.filter((c) => Date.now() - Date.parse(c.seenAt) < ms);
  const separateReady = settings.chatgptChromeMode === 'separate' && Boolean(await prisma.setting.findUnique({ where: { key: AUTOMATION_CHROME_SEEN_SETTING } }));
  // With the automation Chrome set up, only its extension counts (one in the normal Chrome stays idle).
  const connected = separateReady ? onlineWithin(EXTENSION_ONLINE_MS * 2).some((c) => c.automation) : status && Date.now() - status.lastSeenAt.getTime() < EXTENSION_ONLINE_MS * 2;
  if (connected) {
    attempts = 0;
    return;
  }
  if (Date.now() - lastOpenedAt < 3 * 60_000) return;

  if (settings.chatgptChromeMode === 'separate') {
    lastOpenedAt = Date.now();
    // Always with a window: a Chrome with its own folder started with --no-startup-window exits at once.
    if (!launchAutomationChrome([settings.chatgptUrl])) {
      if (!warned) {
        warned = true;
        await writeLog({ level: 'WARN', category: 'BROWSER', message: 'Google Chrome was not found, so the automation Chrome for ChatGPT could not be opened.' });
      }
      return;
    }
    warned = false;
    await writeLog({ category: 'BROWSER', message: 'Opened the automation Chrome so the ChatGPT extension picks up the waiting articles' });
    return;
  }

  const folder = findChromeProfileFolder(settings.chatgptChromeProfile);
  const executable = findBrowserExecutable('chrome');
  if (!folder || !executable) {
    if (!warned) {
      warned = true;
      await writeLog({
        level: 'WARN',
        category: 'BROWSER',
        message: `Could not open the Chrome profile "${settings.chatgptChromeProfile}" for the ChatGPT extension: ${
          executable ? 'no Chrome profile has that name (Settings → Chrome profile with the extension)' : 'Google Chrome was not found'
        }. Open that Chrome profile yourself.`,
      });
    }
    return;
  }

  warned = false;
  lastOpenedAt = Date.now();
  attempts++;
  // First without a window (the extension opens its own ChatGPT tabs); if it still does not connect, with a window.
  const target = attempts === 1 ? '--no-startup-window' : settings.chatgptUrl;
  spawn(executable, [`--profile-directory=${folder}`, target], { detached: true, stdio: 'ignore' }).unref();
  await writeLog({
    category: 'BROWSER',
    message: `Opened Chrome profile "${settings.chatgptChromeProfile}" so the ChatGPT extension picks up the waiting articles`,
  });
}
