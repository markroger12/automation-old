// Verifies the network-level publish guard inside a real browser page.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { installPublishGuard } from '@/automation/wordpress/publish-guard';
import type { AutomationLogger } from '@/lib/logger';

let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium
    .launch({ headless: true, channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : (process.env.BROWSER_CHANNEL ?? 'chrome') })
    .catch(() => null);
});

afterAll(async () => {
  await browser?.close();
});

describe('installPublishGuard (browser)', () => {
  it('aborts publish requests and lets draft saves through', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    await context.route('https://wp.test/**', (route) =>
      route.fulfill({ status: 200, contentType: route.request().resourceType() === 'document' ? 'text/html' : 'application/json', body: route.request().resourceType() === 'document' ? '<html><body>editor</body></html>' : '{"ok":true}' }),
    );
    const page = await context.newPage();
    const blocked: string[] = [];
    const logger: AutomationLogger = { debug() {}, info() {}, warn() {}, error: (m) => blocked.push(m) };
    await installPublishGuard(page, logger);
    await page.goto('https://wp.test/wp-admin/post.php?post=1&action=edit');

    const send = (status: string) =>
      page.evaluate(async (s) => {
        try {
          const res = await fetch('/wp-json/wp/v2/posts/1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: s, title: 'x' }) });
          return res.ok ? 'ok' : 'http-error';
        } catch {
          return 'blocked';
        }
      }, status);

    expect(await send('draft')).toBe('ok');
    expect(await send('publish')).toBe('blocked');
    expect(await send('future')).toBe('blocked');
    expect(blocked.length).toBe(2);
    await context.close();
  }, 60_000);
});
