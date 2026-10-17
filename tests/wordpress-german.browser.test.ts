// German WordPress admin (like promizeiten.de) with plugins that keep the block editor "dirty" after saving.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { keepOnlyChecked, mergeSelectors } from '@/automation/browser/locators';
import { PublishBlockedError } from '@/automation/errors';
import { GutenbergEditor } from '@/automation/wordpress/gutenberg-editor';
import { hideAssistantOverlays } from '@/automation/wordpress/overlays';
import { planRankMathFixes } from '@/automation/wordpress/rankmath-fixes';
import { RANKMATH_SELECTORS, WP_SELECTORS } from '@/automation/wordpress/selectors';
import type { AutomationLogger } from '@/lib/logger';

const silent: AutomationLogger = { debug() {}, info() {}, warn() {}, error() {} };
let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium
    .launch({ headless: true, channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : (process.env.BROWSER_CHANNEL ?? 'chrome') })
    .catch(() => null);
});

afterAll(async () => {
  await browser?.close();
});

const editorPage = (saveLabel: string) => `<!doctype html><html lang="de"><body>
  <div class="editor-header__settings">
    <button class="editor-post-save-draft">${saveLabel}</button>
    <button class="editor-post-publish-button__button">Veröffentlichen</button>
  </div>
  <script>
    document.querySelector('.editor-post-save-draft').addEventListener('click', async () => {
      const res = await fetch('/wp-json/wp/v2/posts/321', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'draft', title: 'Fabian Drews' }) });
      await res.json();
      history.replaceState(null, '', '/wp-admin/post.php?post=321&action=edit');
      // Nothing else: the button stays active and no "Gespeichert" state appears, as on promizeiten.de.
    });
  </script>
</body></html>`;

async function openEditor(saveLabel: string): Promise<{ page: Page; editor: GutenbergEditor }> {
  const context = await browser!.newContext();
  await context.route('https://wp.test/**', (route) => {
    const req = route.request();
    if (req.url().includes('/wp-json/wp/v2/posts/321')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 321, status: 'draft' }) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: editorPage(saveLabel) });
  });
  const page = await context.newPage();
  await page.goto('https://wp.test/wp-admin/post-new.php');
  const editor = new GutenbergEditor(page, {
    adminUrl: 'https://wp.test/wp-admin/',
    timeoutMs: 3000,
    logger: silent,
    wp: mergeSelectors(WP_SELECTORS, undefined),
    rankmath: mergeSelectors(RANKMATH_SELECTORS, undefined),
  });
  return { page, editor };
}

describe('German WordPress admin (browser)', () => {
  it('confirms the draft from WordPress’s own answer when the editor keeps showing "Entwurf speichern"', async () => {
    if (!browser) return;
    const { page, editor } = await openEditor('Entwurf speichern');
    const result = await editor.saveDraft();
    expect(result).toEqual({ postId: '321', editUrl: 'https://wp.test/wp-admin/post.php?post=321&action=edit' });
    await page.context().close();
  });

  it('refuses to click a German publish button', async () => {
    if (!browser) return;
    const { page, editor } = await openEditor('Veröffentlichen');
    await expect(editor.saveDraft()).rejects.toBeInstanceOf(PublishBlockedError);
    await page.context().close();
  });
});

describe('Hosting assistant widgets (browser)', () => {
  it('hides a Kodee-style panel that covers the editor sidebar, but not the editor', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    await context.route('https://wp.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body>
          <div class="interface-interface-skeleton" style="position:fixed;inset:0">
            <div class="editor-header"><button id="sidebar-field" style="position:absolute;right:40px;top:120px;width:200px;height:30px">Schlagwörter</button></div>
          </div>
          <div id="vue-app" data-v-app="">
            <div class="assistant-panel" style="position:fixed;right:0;top:80px;width:400px;height:600px;background:#fff;z-index:99999">
              <p class="h-typography first-greeting__description">Ich bin Kodee - dein KI-WordPress-Assistent.</p>
              <ul><li class="intro-item">Seiten erstellen</li></ul>
            </div>
            <button class="float-btn" style="position:fixed;right:10px;bottom:10px;z-index:99999"><svg class="h-icon float-btn__icon"></svg>Kodee fragen</button>
          </div>
          <script>document.getElementById('sidebar-field').addEventListener('click', () => (document.title = 'clicked'))</script>
        </body></html>`,
      }),
    );
    const page = await context.newPage();
    await hideAssistantOverlays(page);
    await page.goto('https://wp.test/wp-admin/post-new.php');
    await page.click('#sidebar-field', { timeout: 5000 });
    expect(await page.title()).toBe('clicked');
    expect(await page.locator('.assistant-panel').isVisible()).toBe(false);
    expect(await page.locator('.float-btn').isVisible()).toBe(false);
    expect(await page.locator('.interface-interface-skeleton').isVisible()).toBe(true);
    await context.close();
  });

  // Found live on peakbuzz.co.uk: Hostinger puts its "kodee-…" classes on <html> and <body>, and the whole
  // wp-admin page disappeared — the block editor never loaded.
  it('keeps wp-admin visible when the hosting assistant marks <html> and <body>', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    await context.route('https://wp2.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html class="wp-toolbar kodee-sidebar-collapsed"><body class="wp-admin kodee-support-chat">
          <div id="wpwrap"><div class="editor-editor-interface">
            <iframe name="editor-canvas" style="width:800px;height:600px" srcdoc="<h1 class='wp-block-post-title'>Add title</h1>"></iframe>
          </div></div>
          <div class="kodee-fab" style="position:fixed;right:10px;bottom:10px;width:60px;height:60px"></div>
          <div class="token-loading-overlay" style="position:fixed;inset:0;background:#fff;z-index:99999"></div>
        </body></html>`,
      }),
    );
    const page = await context.newPage();
    await hideAssistantOverlays(page);
    await page.goto('https://wp2.test/wp-admin/post-new.php');
    expect(await page.locator('#wpwrap').isVisible()).toBe(true);
    expect(await page.locator('iframe[name="editor-canvas"]').isVisible()).toBe(true);
    expect(await page.frameLocator('iframe[name="editor-canvas"]').locator('h1.wp-block-post-title').isVisible()).toBe(true);
    expect(await page.locator('.kodee-fab').isVisible()).toBe(false);
    expect(await page.locator('.token-loading-overlay').isVisible()).toBe(false);
    await context.close();
  });
});

describe('One category per article', () => {
  it('unchecks every other category, whatever it is called (Uncategorized, Allgemein…)', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    await context.route('https://wp3.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><div class="editor-post-taxonomies__hierarchical-terms-list">
          <label><input type="checkbox" checked> Allgemein</label>
          <label><input type="checkbox" checked> Uncategorized</label>
          <label><input type="checkbox"> Prominente</label>
          <label><input type="checkbox" checked> News</label>
        </div></body></html>`,
      }),
    );
    const page = await context.newPage();
    await page.goto('https://wp3.test/wp-admin/post.php');
    const boxes = page.locator('input[type="checkbox"]');
    const keep = boxes.nth(2);
    await keep.check();
    expect(await keepOnlyChecked(boxes, keep)).toBe(3);
    expect(await boxes.nth(2).isChecked()).toBe(true);
    for (const i of [0, 1, 3]) expect(await boxes.nth(i).isChecked()).toBe(false);
    await context.close();
  });
});

describe('German Rank Math recommendations', () => {
  it('maps German checks to the same automatic fixes', () => {
    const plan = planRankMathFixes(
      [
        'Füge das Fokus-Keyword am Anfang des SEO-Titels hinzu.',
        'Füge das Fokus-Keyword in die SEO-Meta-Beschreibung ein.',
        'Verwende das Fokus-Keyword in der URL.',
        'Verwende das Fokus-Keyword am Anfang deines Inhalts.',
        'Füge ein Bild mit deinem Fokus-Keyword als Alt-Text hinzu.',
      ],
      {
        keyword: 'Fabian Drews',
        articleTitle: 'Wer ist Fabian Drews? Beruf, Familie und mehr',
        seoTitle: 'Beruf und Familie',
        metaDescription: '',
        slug: 'x',
        introText: '',
        subjectName: 'Fabian Drews',
        locale: 'de',
      },
    );
    expect(plan.seoTitle).toMatch(/^Fabian Drews/);
    expect(plan.metaDescription).toContain('Fabian Drews');
    expect(plan.slug).toBe('fabian-drews');
    expect(plan.contentIssues).toEqual(['Verwende das Fokus-Keyword am Anfang deines Inhalts.']);
    expect(plan.manualIssues).toEqual(['Füge ein Bild mit deinem Fokus-Keyword als Alt-Text hinzu.']);
  });

  it('understands the wording of the live German Rank Math ("Fokus-Schlüsselwort")', () => {
    const plan = planRankMathFixes(
      [
        'Füge ein Bild mit deinem Fokus-Schlüsselwort als Alt-Text hinzu.',
        'Die Schlüsselwort-Dichte beträgt 3.10, was hoch ist, das Fokus-Schlüsselwort und die Kombination kommen 44 mal vor. Mit KI beheben',
        'Verlinke auf externe Ressourcen.',
        'Füge deinem Inhalt interne Links hinzu.',
        'Verwende das Fokus-Schlüsselwort in der SEO-Meta-Beschreibung.',
      ],
      { keyword: 'Dexter Keaton', articleTitle: 'Dexter Keaton: Leben und Familie', seoTitle: 'Dexter Keaton', metaDescription: '', slug: 'dexter-keaton', introText: '', subjectName: 'Dexter Keaton', locale: 'de' },
    );
    expect(plan.contentIssues).toEqual([
      'Die Schlüsselwort-Dichte beträgt 3.10, was hoch ist, das Fokus-Schlüsselwort und die Kombination kommen 44 mal vor. Mit KI beheben',
    ]);
    expect(plan.metaDescription).toContain('Dexter Keaton');
    expect(plan.manualIssues).toHaveLength(3);
  });
});
