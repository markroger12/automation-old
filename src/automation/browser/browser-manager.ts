import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { ensurePrivateDir, resolveProfileDir } from '@/lib/paths';
import type { BrowserMode } from '@/lib/settings-schema';
import { BrowserLaunchError, ProfileBusyError } from '../errors';
import { EVALUATE_HELPERS_INIT_SCRIPT, waitUntil } from './locators';
import { findBrowserExecutable } from './system-browser';

export interface ProfileRef {
  id: string;
  directory: string;
  name?: string;
}

export interface BrowserManagerOptions {
  channel: 'chrome' | 'msedge' | 'chromium';
  executablePath?: string;
  getBrowserSettings: () => Promise<{ browserMode: BrowserMode; browserTimeoutSec: number }>;
  /** Close idle automation browsers after this many ms (keeps them warm between tasks). */
  idleCloseMs?: number;
}

interface Entry {
  profileId: string;
  profileName: string;
  context: BrowserContext;
  interactive: boolean;
  headless: boolean;
  leases: number;
  idleTimer?: NodeJS.Timeout;
  spareInitialPage: Page | null;
}

export interface BrowserLease {
  profileId: string;
  context: BrowserContext;
  newPage(): Promise<Page>;
  /** Releases the lease. Pages opened through it are closed unless keepPages is set. */
  release(options?: { keepPages?: boolean }): Promise<void>;
}

const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];

function isProfileLockError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  return /ProcessSingleton|SingletonLock|profile (appears to be )?in use|user data directory is already in use|lockfile/i.test(msg);
}

async function lockOwnerIsAlive(userDataDir: string): Promise<boolean> {
  try {
    const target = await fs.readlink(path.join(userDataDir, 'SingletonLock'));
    const pid = Number(target.split('-').pop());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleLocks(userDataDir: string): Promise<void> {
  if (await lockOwnerIsAlive(userDataDir)) {
    throw new ProfileBusyError('This browser profile is open in another Chrome process. Close that window and try again.');
  }
  for (const name of LOCK_FILES) {
    // On Windows an in-use lockfile cannot be deleted, which safely keeps a live profile protected.
    await fs.rm(path.join(userDataDir, name), { force: true }).catch(() => undefined);
  }
}

/**
 * Owns every Playwright persistent context in the worker process.
 * - One Chrome instance per browser profile (Chrome locks its user-data directory).
 * - Tasks lease the context and get their own tab; concurrent tasks share a logged-in profile.
 * - Login windows are opened as a normal browser (no automation attached) so the user can sign in and
 *   pass any "verify you are human" check themselves; automation waits until that window is closed.
 */
export class BrowserManager {
  private entries = new Map<string, Entry>();
  private launching = new Map<string, Promise<Entry>>();
  private manualWindows = new Map<string, ChildProcess>();
  private readonly idleCloseMs: number;

  constructor(private readonly options: BrowserManagerOptions) {
    this.idleCloseMs = options.idleCloseMs ?? 3 * 60_000;
  }

  /**
   * Opens the profile in a normal browser window that is NOT controlled by automation.
   * The user logs in there; cookies are saved to the profile when the window is closed.
   */
  async openManualWindow(profile: ProfileRef, url: string): Promise<void> {
    if (this.manualWindows.has(profile.id)) {
      throw new ProfileBusyError('A browser window for this profile is already open. Finish there and close it, then click "Test Session".');
    }
    const inflight = this.launching.get(profile.id);
    if (inflight) await inflight.catch(() => undefined);
    const entry = this.entries.get(profile.id);
    if (entry) {
      if (entry.leases > 0) {
        throw new ProfileBusyError(`"${entry.profileName}" is being used by a running task. Wait for it to finish, then open the login window.`);
      }
      await this.closeEntry(entry);
    }

    const executable = findBrowserExecutable(this.options.channel, this.options.executablePath);
    if (!executable) {
      throw new BrowserLaunchError('Google Chrome was not found. Install Chrome, or set BROWSER_EXECUTABLE_PATH in .env.');
    }
    const userDataDir = resolveProfileDir(profile.directory);
    await ensurePrivateDir(userDataDir);

    const child = spawn(executable, [`--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', '--new-window', url], {
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    this.manualWindows.set(profile.id, child);
    const forget = () => {
      if (this.manualWindows.get(profile.id) === child) this.manualWindows.delete(profile.id);
    };
    child.on('exit', forget);
    child.on('error', forget);
  }

  isManualWindowOpen(profileId: string): boolean {
    return this.manualWindows.has(profileId);
  }

  async acquire(profile: ProfileRef, opts: { interactive?: boolean; waitForManualWindowMs?: number } = {}): Promise<BrowserLease> {
    if (this.manualWindows.has(profile.id)) {
      const closed = opts.waitForManualWindowMs
        ? await waitUntil(async () => !this.manualWindows.has(profile.id), { timeout: opts.waitForManualWindowMs, interval: 1000 })
        : false;
      if (!closed) {
        throw new ProfileBusyError('The login window for this browser profile is still open. Close that Chrome window first, then try again.');
      }
    }
    const entry = await this.getOrLaunch(profile, Boolean(opts.interactive));
    entry.leases++;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    const pages: Page[] = [];
    let released = false;
    return {
      profileId: profile.id,
      context: entry.context,
      newPage: async () => {
        const page = await this.takePage(entry);
        pages.push(page);
        return page;
      },
      release: async (releaseOpts) => {
        if (released) return;
        released = true;
        if (!releaseOpts?.keepPages) {
          for (const p of pages) if (!p.isClosed()) await p.close().catch(() => undefined);
        }
        entry.leases = Math.max(0, entry.leases - 1);
        this.scheduleIdleClose(entry);
      },
    };
  }

  isOpen(profileId: string): boolean {
    return this.entries.has(profileId);
  }

  isBusy(profileId: string): boolean {
    return (this.entries.get(profileId)?.leases ?? 0) > 0;
  }

  async closeProfile(profileId: string, opts: { force?: boolean } = {}): Promise<void> {
    const manual = this.manualWindows.get(profileId);
    if (manual) {
      if (!opts.force) throw new ProfileBusyError('The login window for this browser profile is still open. Close it first.');
      manual.kill();
      this.manualWindows.delete(profileId);
    }
    const entry = this.entries.get(profileId);
    if (!entry) return;
    if (entry.leases > 0 && !opts.force) {
      throw new ProfileBusyError(`Browser profile "${entry.profileName}" is in use by a running task.`);
    }
    await this.closeEntry(entry);
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.entries.values()).map((e) => this.closeEntry(e)));
  }

  private async getOrLaunch(profile: ProfileRef, interactive: boolean): Promise<Entry> {
    const inflight = this.launching.get(profile.id);
    if (inflight) await inflight.catch(() => undefined);

    const existing = this.entries.get(profile.id);
    if (existing) {
      if (interactive && existing.headless) {
        if (existing.leases > 0) {
          throw new ProfileBusyError(
            `"${existing.profileName}" is currently used by a background task. Wait for it to finish before opening a visible browser.`,
          );
        }
        await this.closeEntry(existing);
      } else {
        return existing;
      }
    }

    const launch = this.launch(profile, interactive).finally(() => this.launching.delete(profile.id));
    this.launching.set(profile.id, launch);
    return launch;
  }

  private async launch(profile: ProfileRef, interactive: boolean): Promise<Entry> {
    const settings = await this.options.getBrowserSettings();
    const mode: BrowserMode = interactive ? 'visible' : settings.browserMode;
    const headless = mode === 'headless';
    const userDataDir = resolveProfileDir(profile.directory);
    await ensurePrivateDir(userDataDir);

    // HTTP/3 (QUIC) runs over UDP, which stalls now and then on this connection: pages of peakbuzz.co.uk hung with
    // half their files pending (26 September 2026). Plain HTTPS over TCP is used instead.
    const args: string[] = ['--disable-quic'];
    if (mode === 'background') args.push('--window-position=-2400,-2400', '--window-size=1440,960');
    if (mode === 'visible') args.push('--window-size=1440,960');

    const channel = this.options.executablePath || this.options.channel === 'chromium' ? undefined : this.options.channel;
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless,
      args,
      channel,
      executablePath: this.options.executablePath || undefined,
      viewport: headless ? { width: 1440, height: 900 } : null,
      acceptDownloads: false,
      locale: 'en-US',
    };

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    } catch (err) {
      if (isProfileLockError(err)) {
        await removeStaleLocks(userDataDir);
        try {
          context = await chromium.launchPersistentContext(userDataDir, launchOptions);
        } catch (retryErr) {
          if (isProfileLockError(retryErr)) {
            throw new ProfileBusyError('This browser profile is open in another Chrome window (for example a login window). Close that window and try again.');
          }
          throw new BrowserLaunchError(`Could not open browser profile: ${(retryErr as Error).message}`);
        }
      } else {
        const msg = (err as Error).message ?? String(err);
        const hint = /Executable doesn't exist|not found|chromium distribution/i.test(msg)
          ? ` — install Google Chrome, set BROWSER_CHANNEL=chromium and run "npm run playwright:install", or set BROWSER_EXECUTABLE_PATH.`
          : '';
        throw new BrowserLaunchError(`Failed to launch ${channel ?? 'chromium'}: ${msg.split('\n')[0]}${hint}`);
      }
    }

    await context.addInitScript({ content: EVALUATE_HELPERS_INIT_SCRIPT });
    for (const existing of context.pages()) {
      await existing.evaluate(EVALUATE_HELPERS_INIT_SCRIPT).catch(() => undefined);
    }

    const timeoutMs = settings.browserTimeoutSec * 1000;
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs * 2);

    const entry: Entry = {
      profileId: profile.id,
      profileName: profile.name ?? profile.directory,
      context,
      interactive,
      headless,
      leases: 0,
      spareInitialPage: context.pages()[0] ?? null,
    };
    this.entries.set(profile.id, entry);
    context.on('close', () => {
      if (this.entries.get(profile.id) === entry) this.entries.delete(profile.id);
    });

    if (interactive) {
      // Closing the last tab of a login window closes the context, which flushes cookies to disk.
      const watch = (page: Page) =>
        page.on('close', () => {
          setTimeout(() => {
            if (context.pages().length === 0) void context.close().catch(() => undefined);
          }, 750);
        });
      context.pages().forEach(watch);
      context.on('page', watch);
    }
    return entry;
  }

  private async takePage(entry: Entry): Promise<Page> {
    const spare = entry.spareInitialPage;
    entry.spareInitialPage = null;
    if (spare && !spare.isClosed() && spare.url() === 'about:blank') return spare;
    return entry.context.newPage();
  }

  private scheduleIdleClose(entry: Entry): void {
    if (entry.leases > 0 || entry.interactive) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (entry.leases === 0) void this.closeEntry(entry);
    }, this.idleCloseMs);
    entry.idleTimer.unref?.();
  }

  private async closeEntry(entry: Entry): Promise<void> {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (this.entries.get(entry.profileId) === entry) this.entries.delete(entry.profileId);
    await entry.context.close().catch(() => undefined);
  }
}
