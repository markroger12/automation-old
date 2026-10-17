// Hands a finished draft to WordPress with a time: WordPress itself publishes it at that moment, so this computer
// does not have to be running then.
//
// The post is set through WordPress's own REST interface from inside the logged-in admin page — the same thing the
// editor does when you press Schedule, but without clicking through the date picker. The automation never does this
// on its own: a website must be allowed to publish (Workflow → "This website may publish by itself").
import type { Page } from 'playwright';
import { AutomationError } from '../errors';
import type { AutomationLogger } from '@/lib/logger';

export interface ScheduleResult {
  /** "future" while it waits, "publish" when the moment had already passed. */
  status: string;
  /** The address the article will have. */
  link: string;
  /** The time WordPress kept, in the website's own clock. */
  date: string;
}

interface RestAnswer {
  ok: boolean;
  status?: number;
  body?: { id?: number; status?: string; link?: string; date?: string; message?: string; code?: string };
  error?: string;
}

/**
 * Sets one post to "scheduled".
 * `localDate` is the moment in the website's own time zone, written as "2026-09-24T01:30:00" — WordPress reads a date
 * without a zone as its own local time, which is exactly what the date field in the editor holds.
 */
export async function schedulePost(page: Page, options: { adminUrl: string; postId: string; localDate: string; logger: AutomationLogger }): Promise<ScheduleResult> {
  const { adminUrl, postId, localDate, logger } = options;
  const editUrl = new URL(`post.php?post=${encodeURIComponent(postId)}&action=edit`, adminUrl).toString();
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

  const answer = (await page.evaluate(
    async ([id, date]) => {
      const site = window as unknown as { wpApiSettings?: { nonce?: string; root?: string } };
      let nonce = site.wpApiSettings?.nonce;
      if (!nonce) {
        // Every modern WordPress can hand out a fresh one.
        const response = await fetch('/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin' });
        if (response.ok) nonce = (await response.text()).trim();
      }
      if (!nonce) return { ok: false, error: 'This WordPress did not hand out a security key for its own interface.' };
      const root = site.wpApiSettings?.root ?? '/wp-json/';
      const url = `${root}${root.endsWith('/') ? '' : '/'}wp/v2/posts/${id}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'X-WP-Nonce': nonce },
          body: JSON.stringify({ status: 'future', date }),
        });
        const body = (await response.json()) as Record<string, unknown>;
        return { ok: response.ok, status: response.status, body };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    [postId, localDate] as const,
  )) as RestAnswer;

  if (!answer.ok) {
    const message = answer.body?.message ?? answer.error ?? `WordPress answered with ${answer.status ?? 'an error'}`;
    throw new AutomationError(`The article could not be scheduled: ${message}`);
  }
  const status = answer.body?.status ?? '';
  if (status !== 'future' && status !== 'publish') {
    throw new AutomationError(`WordPress kept the post as "${status || 'unknown'}" instead of scheduling it.`);
  }
  logger.info(`Post ${postId} is ${status === 'future' ? 'scheduled' : 'published'} for ${answer.body?.date ?? localDate}`, { link: answer.body?.link });
  return { status, link: answer.body?.link ?? '', date: answer.body?.date ?? localDate };
}

/** Reads the time zone WordPress itself runs in, so a scheduled post is entered at the right local time. */
export async function readSiteTimezone(page: Page, adminUrl: string): Promise<string | null> {
  const url = new URL('options-general.php', adminUrl).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const value = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('#timezone_string');
    return select?.value ?? null;
  });
  // WordPress also allows a plain offset like "UTC+5", which is not a time zone name.
  return value && value.includes('/') ? value : null;
}
