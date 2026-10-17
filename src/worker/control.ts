import fs from 'node:fs/promises';
import type { Page } from 'playwright';
import type { BrowserProfile, Website } from '@prisma/client';
import type { BrowserManager } from '@/automation/browser/browser-manager';
import { LoginRequiredError, ProfileBusyError } from '@/automation/errors';
import { WordPressClient, normalizeAdminUrl } from '@/automation/wordpress/wordpress-client';
import { prisma } from '@/lib/db';
import { createLogger, writeLog, type AutomationLogger } from '@/lib/logger';
import { ensurePrivateDir, resolveProfileDir } from '@/lib/paths';
import type { ControlJobData, ControlJobResult } from '@/lib/queue';
import { getSettings } from '@/lib/settings';
import { syncWebsiteCategories } from '@/lib/services/categories';
import { markProfileSession } from '@/lib/services/profiles';
import { resumeTasksWaitingForLogin } from '@/lib/services/tasks';
import { AUTOMATION_CHROME_PAGE } from '@/lib/chatgpt-extension';
import { env } from '@/lib/env';
import { launchAutomationChrome } from './extension-chrome';

type ProfileWithSites = BrowserProfile & { websites: Website[] };

function pickWebsite(profile: ProfileWithSites, websiteId?: string): Website | null {
  if (websiteId) return profile.websites.find((w) => w.id === websiteId) ?? null;
  return profile.websites[0] ?? null;
}

function wordpressClient(page: Page, website: Website, settings: Awaited<ReturnType<typeof getSettings>>, logger: AutomationLogger): WordPressClient {
  return new WordPressClient(
    page,
    { name: website.name, adminUrl: normalizeAdminUrl(website.url, website.adminUrl), editorType: website.editorType },
    { timeoutMs: settings.browserTimeoutSec * 1000, logger, selectorOverrides: { wordpress: settings.selectorOverrides.wordpress } },
  );
}

/** Reads Posts → Categories of each website and makes the app's category list match it. */
async function readCategories(page: Page, websites: Website[], logger: AutomationLogger): Promise<string[]> {
  const settings = await getSettings();
  const lines: string[] = [];
  for (const website of websites) {
    const remote = await wordpressClient(page, website, settings, logger).listCategories();
    const result = await syncWebsiteCategories(website.id, remote.map((c) => c.name));
    const changes = [result.added.length && `${result.added.length} new`, result.removed.length && `${result.removed.length} removed`].filter(Boolean).join(', ');
    lines.push(`${website.name}: ${result.total} categories${changes ? ` (${changes})` : ''}.`);
  }
  return lines;
}

async function syncCategories(profile: ProfileWithSites, data: ControlJobData, browser: BrowserManager): Promise<ControlJobResult> {
  const logger = createLogger({ category: 'SESSION' });
  const websites = data.websiteId ? profile.websites.filter((w) => w.id === data.websiteId) : profile.websites;
  if (!websites.length) return { ok: false, message: 'This profile is not assigned to any website yet.' };
  const lease = await browser.acquire(profile);
  try {
    const lines = await readCategories(await lease.newPage(), websites, logger);
    return { ok: true, message: lines.join(' ') };
  } catch (err) {
    if (err instanceof LoginRequiredError) {
      await markProfileSession(profile.id, 'LOGIN_REQUIRED', err.message);
      return { ok: false, message: `${err.message} Log in first (Login → Test Session); the categories are read right after.` };
    }
    throw err;
  } finally {
    await lease.release();
  }
}

async function testSession(
  profile: ProfileWithSites,
  data: ControlJobData,
  browser: BrowserManager,
): Promise<ControlJobResult> {
  const settings = await getSettings();
  const logger = createLogger({ category: 'SESSION' });
  const website = pickWebsite(profile, data.websiteId);
  if (!website) {
    return { ok: false, message: 'This profile is not assigned to any website yet, so there is nothing to test.' };
  }

  if (data.action === 'refresh-session' && !browser.isBusy(profile.id)) {
    await browser.closeProfile(profile.id).catch(() => undefined);
  }

  const lease = await browser.acquire(profile);
  try {
    const page = await lease.newPage();
    const result = await wordpressClient(page, website, settings, logger).checkSession();

    // Logged in: read the site's categories too, so they never have to be typed in.
    let categories = '';
    if (result.loggedIn) {
      categories = await readCategories(page, profile.websites, logger)
        .then((lines) => ` ${lines.join(' ')}`)
        .catch((err) => ` Categories could not be read: ${(err as Error).message}`);
    }

    await markProfileSession(profile.id, result.loggedIn ? 'ACTIVE' : 'LOGIN_REQUIRED', result.detail);
    const resumed = result.loggedIn
      ? await resumeTasksWaitingForLogin('wordpress', profile.id)
      : 0;
    await writeLog({
      category: 'SESSION',
      level: result.loggedIn ? 'INFO' : 'WARN',
      message: `Session test for "${profile.name}": ${result.detail}${resumed ? ` (${resumed} task(s) resumed)` : ''}`,
    });
    return {
      ok: result.loggedIn,
      loggedIn: result.loggedIn,
      resumedTasks: resumed,
      message: `${result.detail}${resumed ? ` ${resumed} waiting task(s) resumed.` : ''}${categories}`,
    };
  } catch (err) {
    await markProfileSession(profile.id, 'ERROR', (err as Error).message);
    throw err;
  } finally {
    await lease.release();
    // Refreshing closes the browser afterwards so the renewed cookies are flushed to disk.
    if (data.action === 'refresh-session' && !browser.isBusy(profile.id)) {
      await browser.closeProfile(profile.id).catch(() => undefined);
    }
  }
}

/** Handles session-management jobs sent from the dashboard (login windows, tests, resets). */
export async function handleControlJob(data: ControlJobData, browser: BrowserManager): Promise<ControlJobResult> {
  if (data.action === 'open-chatgpt-chrome') {
    const settings = await getSettings();
    if (!launchAutomationChrome([new URL(AUTOMATION_CHROME_PAGE, env().APP_URL).toString(), settings.chatgptUrl])) {
      return { ok: false, message: 'Google Chrome was not found on this computer.' };
    }
    await writeLog({ category: 'SESSION', message: 'Opened the automation Chrome for ChatGPT' });
    return {
      ok: true,
      message: 'The Automation Chrome opened with its setup page and ChatGPT. Follow the steps on that page once.',
    };
  }
  const profile = await prisma.browserProfile.findUnique({ where: { id: data.profileId }, include: { websites: true } });
  if (!profile) return { ok: false, message: 'Browser profile not found.' };
  if (profile.kind === 'CHATGPT') {
    return { ok: false, message: 'ChatGPT runs through the ChatGPT Chrome extension (Settings), not a browser profile.' };
  }

  switch (data.action) {
    case 'open-login':
    case 'open-browser': {
      const website = pickWebsite(profile, data.websiteId);
      const url = website ? normalizeAdminUrl(website.url, website.adminUrl) : 'about:blank';

      // WordPress: a normal browser window with no automation attached. The user signs in themselves;
      // cookies are saved to the profile when it is closed.
      await browser.openManualWindow(profile, url);
      await writeLog({ category: 'SESSION', message: `Opened a normal browser window for "${profile.name}"`, data: { url } });
      return {
        ok: true,
        message:
          data.action === 'open-login'
            ? `A normal Chrome window for "${profile.name}" opened. Log in there yourself, then CLOSE that window and click "Test Session".`
            : `A normal Chrome window for "${profile.name}" opened. Close it when you are done.`,
      };
    }

    case 'test-session':
    case 'refresh-session':
      return testSession(profile, data, browser);

    case 'sync-categories':
      return syncCategories(profile, data, browser);

    case 'close-browser':
      await browser.closeProfile(profile.id);
      return { ok: true, message: 'Browser closed.' };

    case 'reset-session':
    case 'delete-profile': {
      if (browser.isBusy(profile.id)) {
        throw new ProfileBusyError('This browser profile is being used by a running task. Try again when it finishes.');
      }
      await browser.closeProfile(profile.id, { force: true });
      const dir = resolveProfileDir(profile.directory);
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      if (data.action === 'delete-profile') {
        await prisma.browserProfile.delete({ where: { id: profile.id } });
        await writeLog({ level: 'WARN', category: 'SESSION', message: `Browser profile "${profile.name}" deleted` });
        return { ok: true, message: 'Browser profile and its session data were deleted.' };
      }
      await ensurePrivateDir(dir);
      await prisma.browserProfile.update({
        where: { id: profile.id },
        data: { sessionStatus: 'UNKNOWN', sessionDetail: 'Session data cleared', lastLoginAt: null, lastCheckedAt: new Date() },
      });
      await writeLog({ level: 'WARN', category: 'SESSION', message: `Session data for "${profile.name}" was reset` });
      return { ok: true, message: 'Browser session data deleted. Log in again to reconnect.' };
    }
  }
}
