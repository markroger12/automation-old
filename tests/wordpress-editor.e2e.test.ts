// Opt-in end-to-end test of the WordPress block-editor automation.
// Run it only against a disposable local WordPress that is already logged in, e.g. WordPress Playground:
//   npx @wp-playground/cli server --port=9400 --login
//   WP_E2E_ADMIN_URL=http://127.0.0.1:9400/wp-admin/ npx vitest run tests/wordpress-editor.e2e.test.ts
// Skipped automatically when WP_E2E_ADMIN_URL is not set. It creates draft posts on the target site.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';
import { installPublishGuard } from '@/automation/wordpress/publish-guard';
import { WordPressClient } from '@/automation/wordpress/wordpress-client';

const ADMIN_URL = process.env.WP_E2E_ADMIN_URL;
const logs: string[] = [];
const logger: AutomationLogger = {
  debug: () => undefined,
  info: (m) => logs.push(`INFO ${m}`),
  warn: (m) => logs.push(`WARN ${m}`),
  error: (m) => logs.push(`ERROR ${m}`),
};

const ARTICLE = `<p>Sydney Sweeney is an American actress who became widely known through <strong>Euphoria</strong>.</p>
<h2>Sydney Sweeney Quick Bio</h2>
<table class="quick-bio-table"><thead><tr><th>Attribute</th><th>Details</th></tr></thead><tbody><tr><td><strong>Full Name</strong></td><td>Sydney Bernice Sweeney</td></tr><tr><td><strong>Profession</strong></td><td>Actress</td></tr></tbody></table>
<h2>Early Life of Sydney Sweeney</h2>
<p>She grew up in Spokane, Washington, where she developed an early interest in acting.</p>
<h3>Education</h3>
<p>Details about her schooling are limited in public sources.</p>
<h2>Frequently Asked Questions About Sydney Sweeney</h2>
<h3>How old is Sydney Sweeney?</h3>
<p>She was born in 1997.</p>
<h2>Conclusion</h2>
<p>Sydney Sweeney continues to take on new projects.</p>`;

let browser: Browser;
let context: BrowserContext;
let page: Page;
let client: WordPressClient;
let editUrl = '';

describe.skipIf(!ADMIN_URL)('WordPress block editor automation (e2e)', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : 'chrome' });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    await installPublishGuard(page, logger);
    client = new WordPressClient(page, { name: 'E2E site', adminUrl: ADMIN_URL!, editorType: 'AUTO' }, { timeoutMs: 45_000, logger });
  }, 180_000);

  afterAll(async () => {
    if (logs.length) console.log(logs.join('\n'));
    await browser?.close();
  });

  it('creates a draft with title, block content, category, tag and slug', async () => {
    await client.openDashboard();
    const editor = await client.createNewPost();
    expect(editor.kind).toBe('gutenberg');

    await editor.setTitle('Sydney Sweeney: Age, Career and Net Worth');
    await editor.setContent(ARTICLE, 8);
    const first = await editor.saveDraft();
    expect(first.postId).toMatch(/^\d+$/);

    const category = await editor.selectCategory('Actresses', { createIfMissing: false });
    expect(category.selected, category.message).toBe(true);
    const tag = await editor.addTag('Sydney Sweeney');
    expect(tag.added, tag.message).toBe(true);
    const slugSet = await editor.setSlug('sydney-sweeney');
    const saved = await editor.saveDraft();
    editUrl = saved.editUrl;
    expect(saved.postId).toBe(first.postId);
    console.log(`slug set via editor UI: ${slugSet}`);

    // Verify what WordPress actually stored by previewing the draft.
    const preview = await context.newPage();
    await preview.goto(new URL(`/?p=${saved.postId}&preview=true`, ADMIN_URL).toString());
    const html = await preview.content();
    expect(html).toContain('Early Life of Sydney Sweeney');
    expect(html).toContain('Sydney Bernice Sweeney');
    expect(await preview.locator('h2').filter({ hasText: 'Frequently Asked Questions About Sydney Sweeney' }).count()).toBe(1);
    expect(await preview.locator('table').count()).toBeGreaterThanOrEqual(1);
    await preview.close();

    // Status must still be Draft, with the category, tag and slug stored by WordPress.
    const list = await context.newPage();
    await list.goto(new URL('edit.php?post_status=draft&post_type=post', ADMIN_URL).toString());
    const row = list.locator(`#post-${saved.postId}`);
    expect(await row.count()).toBe(1);
    expect(await row.locator('.column-categories').innerText()).toContain('Actresses');
    expect(await row.locator('.column-tags').innerText()).toContain('Sydney Sweeney');
    // WordPress appends -2, -3… when another post already uses the slug.
    if (slugSet) expect((await row.locator('.post_name').textContent())?.trim()).toMatch(/^sydney-sweeney(-\d+)?$/);
    await list.close();
  }, 300_000);

  it('re-opens the same draft and replaces its content without creating a duplicate', async () => {
    expect(editUrl).not.toBe('');
    const editor = await client.openPost(editUrl);
    await editor.assertDraft();
    const updated = ARTICLE.replace('Early Life of Sydney Sweeney', 'Childhood of Sydney Sweeney');
    await editor.setContent(updated, 8);
    const saved = await editor.saveDraft();
    expect(saved.editUrl).toBe(editUrl);

    const preview = await context.newPage();
    await preview.goto(new URL(`/?p=${saved.postId}&preview=true`, ADMIN_URL).toString());
    const html = await preview.content();
    expect(html).toContain('Childhood of Sydney Sweeney');
    expect(html).not.toContain('Early Life of Sydney Sweeney');
    await preview.close();
  }, 300_000);
});
