// A post that WordPress already has scheduled (or live) is updated through WordPress's own interface: the editor
// offers no "Save draft" there, and the update must never change its status or date.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { installPublishGuard } from '@/automation/wordpress/publish-guard';
import { WordPressClient } from '@/automation/wordpress/wordpress-client';
import { stripChatGPTDirectivesHtml } from '@/content/cleanup';
import type { AutomationLogger } from '@/lib/logger';

const blocked: string[] = [];
/** The post's text as WordPress keeps it, with ChatGPT's writing-document marks (as on justin biel's draft). */
const SAVED_TEXT =
  '<!-- wp:paragraph -->\n<p>:::writing{variant="document" id="68431" title="Who Is Justin Biel? All About <a href="https://en.wikipedia.org/wiki/Jessica_Biel">Jessica Biel</a>’s Brother"}\nJustin Biel is best known as the brother.</p>\n<!-- /wp:paragraph -->\n\n' +
  '<!-- wp:paragraph -->\n<p>A sentence edited by hand in WordPress. :::</p>\n<!-- /wp:paragraph -->';
const logger: AutomationLogger = { debug() {}, info() {}, warn() {}, error: (message) => blocked.push(message) };
let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium
    .launch({ headless: true, channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : (process.env.BROWSER_CHANNEL ?? 'chrome') })
    .catch(() => null);
});

afterAll(async () => {
  await browser?.close();
});

/** wp-admin with a scheduled post 7; the edit page carries WordPress's block converter (reduced to paragraphs). */
async function fakeWordPress(answerStatus = 200) {
  const context = await browser!.newContext();
  const saved: Record<string, unknown>[] = [];
  await context.route('https://wp.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/wp-admin/admin-ajax.php') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'nonce-123' });
    if (url.pathname === '/wp-json/wp/v2/posts/7') {
      if (req.headers()['x-wp-nonce'] !== 'nonce-123') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"rest_forbidden"}' });
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 7, status: 'future', content: { raw: SAVED_TEXT } }) });
      saved.push(JSON.parse(req.postData() ?? '{}'));
      return route.fulfill({
        status: answerStatus,
        contentType: 'application/json',
        body: JSON.stringify(answerStatus === 200 ? { id: 7, status: 'future', link: 'https://wp.test/?p=7' } : { message: 'Sorry, you are not allowed to edit this post.' }),
      });
    }
    const editor =
      url.pathname === '/wp-admin/post.php'
        ? `<script>window.wp = { blocks: {
            getBlockTypes: () => new Array(20),
            rawHandler: ({ HTML }) => [...HTML.matchAll(/<p>.*?<\\/p>/g)].map((m) => m[0]),
            serialize: (blocks) => blocks.map((b) => '<!-- wp:paragraph -->' + b + '<!-- /wp:paragraph -->').join('\\n'),
          } };</script>`
        : '';
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><div id="wpadminbar" style="height:32px">Dashboard</div>${editor}</body></html>` });
  });
  const page = await context.newPage();
  await installPublishGuard(page, logger);
  const client = new WordPressClient(page, { name: 'Test', adminUrl: 'https://wp.test/wp-admin/', editorType: 'AUTO' }, { timeoutMs: 5000, logger });
  return { context, client, saved };
}

describe('a scheduled post (browser)', () => {
  it('is recognised as scheduled', async () => {
    if (!browser) return;
    const { context, client } = await fakeWordPress();
    expect(await client.postStatus('7')).toBe('future');
    await context.close();
  });

  it('gets its new text as blocks, and keeps its status and publish time', async () => {
    if (!browser) return;
    blocked.length = 0;
    const { context, client, saved } = await fakeWordPress();
    const result = await client.updateLivePost('7', { title: 'Who Is Isabella Brewster?', html: '<p>First.</p><p>Second.</p>', featuredMedia: 55 });
    expect(result).toEqual({ status: 'future', link: 'https://wp.test/?p=7' });
    expect(saved).toEqual([
      {
        title: 'Who Is Isabella Brewster?',
        content: '<!-- wp:paragraph --><p>First.</p><!-- /wp:paragraph -->\n<!-- wp:paragraph --><p>Second.</p><!-- /wp:paragraph -->',
        featured_media: 55,
      },
    ]);
    // Nothing that could publish or reschedule it went out, so the publish guard had nothing to stop.
    expect(saved[0]).not.toHaveProperty('status');
    expect(saved[0]).not.toHaveProperty('date');
    expect(blocked).toEqual([]);
    await context.close();
  });

  it('removes ChatGPT marks from the saved text and keeps edits made in WordPress, without a status or date', async () => {
    if (!browser) return;
    blocked.length = 0;
    const { context, client, saved } = await fakeWordPress();
    expect(await client.editPostContent('7', stripChatGPTDirectivesHtml)).toEqual({ changed: true, status: 'future' });
    expect(saved).toEqual([
      {
        content:
          '<!-- wp:paragraph -->\n<p>Justin Biel is best known as the brother.</p>\n<!-- /wp:paragraph -->\n\n' +
          '<!-- wp:paragraph -->\n<p>A sentence edited by hand in WordPress.</p>\n<!-- /wp:paragraph -->',
      },
    ]);
    expect(blocked).toEqual([]);
    // Nothing to change: nothing is saved.
    expect(await client.editPostContent('7', (raw) => raw)).toEqual({ changed: false, status: 'future' });
    expect(saved).toHaveLength(1);
    await context.close();
  });

  it('says why when WordPress refuses the update', async () => {
    if (!browser) return;
    const { context, client } = await fakeWordPress(403);
    await expect(client.updateLivePost('7', { title: 'T', html: '<p>x</p>' })).rejects.toThrow(/not allowed to edit this post/);
    await context.close();
  });
});

describe('a wp-admin page whose scripts never finish (browser)', () => {
  it('is used as soon as it is there, instead of waiting minutes for it to finish loading', async () => {
    if (!browser) return;
    // Seen on peakbuzz.co.uk: the dashboard was drawn, but some of its files never arrived.
    const context = await browser.newContext();
    await context.route('https://wp.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/wp-admin/load-scripts.php') return; // never answered
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="wpadminbar" style="height:32px">Dashboard</div><script src="/wp-admin/load-scripts.php?load=jquery"></script><p>Rest of the page</p></body></html>',
      });
    });
    const page = await context.newPage();
    const warnings: string[] = [];
    const client = new WordPressClient(page, { name: 'Test', adminUrl: 'https://wp.test/wp-admin/', editorType: 'AUTO' }, {
      timeoutMs: 5000,
      loadWaitMs: 1500,
      logger: { ...logger, warn: (message: string) => { warnings.push(message); } },
    });
    const started = Date.now();
    await client.openDashboard();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(warnings).toEqual(['WordPress page still loading after 2 s — going on with what is there (/wp-admin/)']);
    await context.close();
  }, 30_000);
});
