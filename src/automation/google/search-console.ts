// Asks Google Search Console to index an article, the same way a person does: open the URL inspection of the
// property and press "Request indexing".
//
// It runs in the website's own browser profile, so it uses the Google account that is already logged in there —
// nothing is shared with the app and no key is stored. Google allows this a limited number of times a day
// with a quota, which is why a workflow only sends the articles it actually publishes.
import type { Locator, Page } from 'playwright';
import { AutomationError } from '../errors';
import type { AutomationLogger } from '@/lib/logger';

export interface IndexingResult {
  ok: boolean;
  /** What Search Console said, in plain words. */
  message: string;
  /** True when Google refused because the daily quota is used up — it is worth trying again tomorrow. */
  quotaReached?: boolean;
  outcome?: 'requested' | 'already-indexed';
  screenshotPath?: string;
}

// The overview of the property. `hl=en` keeps Search Console in English whatever language the Google account uses.
const PROPERTY_HOME = (property: string) => `https://search.google.com/search-console?resource_id=${encodeURIComponent(property)}&hl=en`;

/** Text Search Console shows in the languages the dashboard is used in. */
const INSPECT_BOX = /inspect any url|url.*prüfen|inspeccionar/i;
const REQUEST_BUTTON = /request indexing|indexierung beantragen|anfrage auf indexierung|solicitar indexación/i;
const DONE_TEXT = /indexing requested|requested indexing|added to a priority crawl queue|indexierung beantragt|zur priorisierten crawling-warteschlange/i;
const QUOTA_TEXT = /quota exceeded|exceeded your quota|kontingent .*(überschritten|aufgebraucht)/i;
const INDEXED_TEXT = /^URL is on Google$|^URL ist auf Google$/i;
const SIGN_IN = /accounts\.google\.com|\/search-console\/about|sign in to continue|anmelden/i;

/** Search Console keeps hidden copies of dialogs in the DOM. Never choose only the first match. */
async function visibleText(page: Page, pattern: RegExp): Promise<boolean> {
  for (const match of await page.getByText(pattern).all()) if (await match.isVisible().catch(() => false)) return true;
  return false;
}

/**
 * Opens the URL Inspection of one address and waits until Search Console has tested it. Search Console's own
 * inspection address carries a code of its own instead of the article's address (a link built from the address is a
 * 404), so it is reached the way a person does: the address is typed into "Inspect any URL" at the top of the property.
 * Only looks — returns the "Request indexing" button, or why it is not there.
 */
export async function openInspection(
  page: Page,
  options: { property: string; url: string; timeoutMs?: number },
): Promise<{ button: Locator } | IndexingResult> {
  const { property, url } = options;
  const timeout = options.timeoutMs ?? 90_000;
  await page.goto(PROPERTY_HOME(property), { waitUntil: 'domcontentloaded', timeout });

  if (SIGN_IN.test(page.url())) {
    throw new AutomationError(
      'Search Console is not signed in for this website. Open its browser profile (Websites → Open Browser), sign in to Search Console once, and try again.',
    );
  }

  // The property picker next to it is a combobox too; this one is named after what it does.
  const box = page.getByRole('combobox', { name: INSPECT_BOX }).first();
  try {
    await box.waitFor({ state: 'visible', timeout });
  } catch {
    return { ok: false, message: `Search Console did not open the property "${property}" — check that this Google account can see it and that it is written exactly as in Search Console.` };
  }
  await box.fill(url);
  await box.press('Enter');

  // The inspection takes a moment; the button only appears when it is finished.
  const button = page.getByRole('button', { name: REQUEST_BUTTON }).first();
  try {
    await button.waitFor({ state: 'visible', timeout });
  } catch {
    const text = (await page.locator('body').innerText().catch(() => '')) || '';
    if (QUOTA_TEXT.test(text)) return { ok: false, quotaReached: true, message: 'Google says the daily indexing requests for this website are used up.' };
    if (/couldn't find|url is not on this property|not in (the )?current property|gehört nicht zu dieser property/i.test(text)) {
      return { ok: false, message: 'Search Console says this address does not belong to the property that is set.' };
    }
    return { ok: false, message: 'The "Request indexing" button did not appear — Search Console may still be testing the address.' };
  }
  if (await visibleText(page, INDEXED_TEXT)) return { ok: true, outcome: 'already-indexed', message: 'URL is on Google — already indexed.' };
  return { button };
}

/**
 * Sends one address for indexing. The page must belong to a browser profile where Search Console is logged in and the
 * property is one this account can see.
 */
export async function requestIndexing(page: Page, options: { property: string; url: string; logger: AutomationLogger; timeoutMs?: number; screenshotPath?: string }): Promise<IndexingResult> {
  const { url, logger } = options;
  const timeout = options.timeoutMs ?? 180_000;
  const finish = async (result: IndexingResult): Promise<IndexingResult> => {
    if (options.screenshotPath) {
      try {
        await page.screenshot({ path: options.screenshotPath, fullPage: false, timeout: 15_000 });
        result.screenshotPath = options.screenshotPath;
      } catch (err) { logger.warn(`Search Console screenshot could not be saved: ${(err as Error).message}`); }
    }
    return result;
  };
  const inspection = await openInspection(page, options);
  if (!('button' in inspection)) return finish(inspection);
  const button = inspection.button;

  await button.click();
  // Google first tests whether the page can be indexed ("Testing if live URL can be indexed"), then confirms.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // A visible success takes precedence over old/hidden quota dialogs. Only one outcome loop owns the timeout.
    if (await visibleText(page, DONE_TEXT)) {
      logger.info(`Indexing requested for ${url}`);
      return finish({ ok: true, outcome: 'requested', message: 'Indexing requested — Google accepted the URL into its crawl queue.' });
    }
    if (await visibleText(page, QUOTA_TEXT)) return finish({ ok: false, quotaReached: true, message: 'Google reports that the indexing request quota has been exceeded. A retry is scheduled later.' });
    await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  return finish({ ok: false, message: 'Search Console did not show a confirmation before the timeout. Check the saved screenshot before retrying.' });
}
