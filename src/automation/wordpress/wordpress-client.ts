import type { Page } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';
import { isAnyVisible, mergeSelectors, sleep, waitForVisible, waitUntil } from '../browser/locators';
import { AutomationError, AutomationTimeoutError, LoginRequiredError } from '../errors';
import { ClassicEditor } from './classic-editor';
import type { PostEditor } from './editor';
import { GutenbergEditor, type EditorOptions } from './gutenberg-editor';
import { RANKMATH_SELECTORS, WP_SELECTORS } from './selectors';

export { normalizeAdminUrl } from '@/lib/wp-url';

export interface WordPressSite {
  name: string;
  adminUrl: string;
  editorType: 'AUTO' | 'GUTENBERG' | 'CLASSIC';
}

export interface WordPressClientOptions {
  timeoutMs: number;
  /** How long a wp-admin page may take to finish loading before the automation goes on anyway (default 30 s). */
  loadWaitMs?: number;
  logger: AutomationLogger;
  selectorOverrides?: { wordpress?: Record<string, string[]>; rankmath?: Record<string, string[]> };
}

/** Opens a WordPress site's admin through a logged-in browser profile (no REST API, no passwords). */
export interface UploadedMedia {
  id: number;
  url: string;
}

export interface WordPressCategory {
  name: string;
  slug: string;
  parentId: string | null;
  posts: number;
}

export class WordPressClient {
  private readonly editorOptions: EditorOptions;

  constructor(
    private readonly page: Page,
    private readonly site: WordPressSite,
    private readonly opts: WordPressClientOptions,
  ) {
    this.editorOptions = {
      adminUrl: site.adminUrl,
      timeoutMs: opts.timeoutMs,
      logger: opts.logger,
      wp: mergeSelectors(WP_SELECTORS, opts.selectorOverrides?.wordpress),
      rankmath: mergeSelectors(RANKMATH_SELECTORS, opts.selectorOverrides?.rankmath),
    };
    // Accept "leave page?" prompts (we always save before navigating); dismiss anything else.
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'beforeunload') void dialog.accept().catch(() => undefined);
      else {
        opts.logger.warn('WordPress showed a dialog; dismissed it', { type: dialog.type(), message: dialog.message() });
        void dialog.dismiss().catch(() => undefined);
      }
    });
  }

  private adminPath(path = ''): string {
    const base = this.site.adminUrl.endsWith('/') ? this.site.adminUrl : `${this.site.adminUrl}/`;
    return new URL(path, base).toString();
  }

  private async waitForAdminState(): Promise<'admin' | 'login'> {
    const sel = this.editorOptions.wp;
    const deadline = Date.now() + this.opts.timeoutMs * 2;
    while (Date.now() < deadline) {
      if (/wp-login\.php|\/login\/?(\?|$)/i.test(this.page.url())) return 'login';
      if (await isAnyVisible(this.page, sel.loginForm)) return 'login';
      if (await isAnyVisible(this.page, [...sel.adminChrome, ...sel.gutenbergRoot, ...sel.classicRoot])) return 'admin';
      await sleep(400);
    }
    throw new AutomationTimeoutError(`WordPress admin for ${this.site.name} did not load`);
  }

  async assertLoggedIn(): Promise<void> {
    if ((await this.waitForAdminState()) === 'login') {
      throw new LoginRequiredError(
        'wordpress',
        `WordPress login required for ${this.site.name} — the saved browser session is not logged in or has expired.`,
      );
    }
  }

  /**
   * Opens a wp-admin page. Only the page itself has to arrive: on peakbuzz.co.uk (26 September 2026) the page was
   * already drawn while some of its scripts never finished, so "DOMContentLoaded" did not come for minutes and every
   * try failed. After up to 30 seconds the automation goes on; each caller waits for the element it needs anyway.
   */
  private async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'commit' });
    const wait = this.opts.loadWaitMs ?? 30_000;
    const loaded = await this.page.waitForLoadState('domcontentloaded', { timeout: wait }).then(() => true, () => false);
    if (!loaded) this.opts.logger.warn(`WordPress page still loading after ${Math.round(wait / 1000)} s — going on with what is there (${new URL(url).pathname})`);
  }

  async openDashboard(): Promise<void> {
    await this.open(this.adminPath());
    await this.assertLoggedIn();
    this.opts.logger.info(`WordPress dashboard opened (${this.site.name})`);
  }

  /**
   * Media → Add New: uploads one file like a user dropping it on the page and returns its media id and address.
   */
  async uploadMedia(file: string): Promise<UploadedMedia> {
    await this.open(this.adminPath('media-new.php'));
    await this.assertLoggedIn();
    const before = new Set(await this.page.locator('#media-items .media-item').evaluateAll((items) => items.map((i) => i.id)));
    const input = this.page.locator('#plupload-upload-ui input[type="file"], input[type="file"][id^="html5_"]').first();
    if (await input.count()) {
      await input.setInputFiles(file);
    } else {
      // WordPress's plain "browser uploader" form.
      await this.page.locator('#async-upload').setInputFiles(file);
      await Promise.all([this.page.waitForURL(/upload\.php/, { timeout: this.opts.timeoutMs * 2 }), this.page.locator('#html-upload').click()]);
      return this.newestMedia();
    }

    // The new row shows an error, or an "Edit" link to post.php?post=<id> once WordPress has stored the file.
    const deadline = Date.now() + this.opts.timeoutMs * 3;
    while (Date.now() < deadline) {
      const state = await this.page.locator('#media-items .media-item').evaluateAll(
        (items, known) =>
          items
            .filter((item) => !known.includes(item.id))
            .map((item) => ({
              error: (item.querySelector('.error-div, .error')?.textContent ?? '').trim(),
              edit: item.querySelector<HTMLAnchorElement>('a[href*="post.php?post="]')?.href ?? '',
              url: item.querySelector<HTMLElement>('.copy-attachment-url')?.dataset.clipboardText ?? '',
            })),
        [...before],
      );
      const item = state[0];
      if (item?.error) throw new AutomationError(`WordPress refused the image: ${item.error.slice(0, 200)}`);
      const id = Number(/[?&]post=(\d+)/.exec(item?.edit ?? '')?.[1] ?? 0);
      if (id) {
        const url = item.url || (await this.mediaUrl(id));
        this.opts.logger.info('Image uploaded to the media library', { id, url });
        return { id, url };
      }
      await sleep(1000);
    }
    throw new AutomationTimeoutError('The image upload to the WordPress media library did not finish');
  }

  private async mediaUrl(id: number): Promise<string> {
    await this.open(this.adminPath(`post.php?post=${id}&action=edit`));
    await this.assertLoggedIn();
    return (await this.page.locator('#attachment_url').inputValue().catch(() => '')) || '';
  }

  private async newestMedia(): Promise<UploadedMedia> {
    await this.open(this.adminPath('upload.php?mode=list&orderby=date&order=desc'));
    const row = this.page.locator('#the-list tr[id^="post-"]').first();
    const id = Number(((await row.getAttribute('id')) ?? '').replace(/\D/g, ''));
    const url = (await row.locator('.copy-attachment-url').getAttribute('data-clipboard-text').catch(() => null)) ?? (await this.mediaUrl(id));
    if (!id) throw new AutomationError('The uploaded image was not found in the media library');
    return { id, url };
  }

  /** Media → Edit: sets the alternative text of an image (used for the featured image and the media library). */
  async setMediaAlt(id: number, alt: string): Promise<boolean> {
    await this.open(this.adminPath(`post.php?post=${id}&action=edit`));
    await this.assertLoggedIn();
    const field = this.page.locator('#attachment_alt').first();
    if (!(await field.isVisible().catch(() => false))) return false;
    if ((await field.inputValue()) === alt) return true;
    await field.fill(alt);
    // Attachments have no draft/publish state — this button only stores the image details.
    const save = this.page.locator('#publish[name="save"], #save-post').first();
    if (!(await save.isVisible().catch(() => false))) return false;
    await Promise.all([this.page.waitForLoadState('domcontentloaded').catch(() => undefined), save.click()]);
    await this.page.locator('#message, .notice-success').first().waitFor({ state: 'visible', timeout: this.opts.timeoutMs }).catch(() => undefined);
    return (await this.page.locator('#attachment_alt').inputValue().catch(() => '')) === alt;
  }

  /**
   * All post categories of the site, read from Posts → Categories in wp-admin (every page of the list).
   * Uses the quick-edit data WordPress puts in each row, so names are exact in any admin language.
   */
  async listCategories(): Promise<WordPressCategory[]> {
    const found = new Map<string, WordPressCategory>();
    for (let paged = 1; paged <= 50; paged++) {
      await this.open(this.adminPath(`edit-tags.php?taxonomy=category&orderby=name&order=asc&paged=${paged}`));
      await this.assertLoggedIn();
      await this.page.locator('#the-list').first().waitFor({ state: 'attached', timeout: this.opts.timeoutMs }).catch(() => undefined);
      const rows = await this.page.evaluate(() =>
        [...document.querySelectorAll('#the-list tr[id^="tag-"]')].map((tr) => ({
          id: tr.id.replace(/^tag-/, ''),
          name: (tr.querySelector('.hidden .name')?.textContent ?? tr.querySelector('.row-title')?.textContent ?? '').trim(),
          slug: (tr.querySelector('.hidden .slug')?.textContent ?? '').trim(),
          parentId: (tr.querySelector('.hidden .parent')?.textContent ?? '0').trim(),
          count: Number((tr.querySelector('.column-posts')?.textContent ?? '0').replace(/\D/g, '')) || 0,
        })),
      );
      let added = 0;
      for (const row of rows) {
        if (!row.name || found.has(row.id)) continue;
        found.set(row.id, { name: row.name.replace(/^(?:—\s*)+/, ''), slug: row.slug, parentId: row.parentId === '0' ? null : row.parentId, posts: row.count });
        added++;
      }
      const pages = Number((await this.page.locator('.tablenav.top .total-pages').first().textContent().catch(() => '1'))?.replace(/\D/g, '') || '1');
      if (added === 0 || paged >= pages) break;
    }
    this.opts.logger.info(`Read ${found.size} categories from WordPress (${this.site.name})`);
    return [...found.values()];
  }

  async checkSession(): Promise<{ loggedIn: boolean; detail: string }> {
    await this.open(this.adminPath());
    try {
      const state = await this.waitForAdminState();
      return state === 'admin'
        ? { loggedIn: true, detail: `Logged in to ${this.site.name}.` }
        : { loggedIn: false, detail: `Not logged in to ${this.site.name}. Use "Login" to open the browser and sign in.` };
    } catch (err) {
      return { loggedIn: false, detail: (err as Error).message };
    }
  }

  /** Posts → Add New Post, exactly like a user. */
  async createNewPost(): Promise<PostEditor> {
    await this.open(this.adminPath('edit.php'));
    await this.assertLoggedIn();
    const addNew = await waitForVisible(this.page, this.editorOptions.wp.addNewPost, 10_000);
    if (addNew) {
      this.opts.logger.info('Clicking "Add New Post"');
      await Promise.all([this.page.waitForURL(/post-new\.php/, { timeout: this.opts.timeoutMs * 2 }), addNew.click()]);
    } else {
      this.opts.logger.warn('"Add New Post" link not found on the Posts screen; opening post-new.php directly');
      await this.open(this.adminPath('post-new.php'));
    }
    await this.assertLoggedIn();
    return this.detectEditor();
  }

  /** Re-opens an existing draft (used for retries and "Send to WordPress" so no duplicate posts are created). */
  /**
   * One call to WordPress's own REST interface from inside the logged-in admin (the key comes from the admin page).
   * Nothing here ever sends a status or a date, so the publish guard lets it through and a schedule stays as it is.
   */
  private async rest(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null; error?: string }> {
    if (!this.page.url().startsWith(this.adminPath())) {
      await this.open(this.adminPath());
      await this.assertLoggedIn();
    }
    return this.page.evaluate(
      async ({ adminUrl, method, path, body }) => {
        const site = window as unknown as { wpApiSettings?: { nonce?: string; root?: string } };
        let nonce = site.wpApiSettings?.nonce;
        if (!nonce) {
          const response = await fetch(new URL('admin-ajax.php?action=rest-nonce', adminUrl).toString(), { credentials: 'same-origin' });
          if (response.ok) nonce = (await response.text()).trim();
        }
        if (!nonce || nonce === '0') return { ok: false, status: 0, body: null, error: 'This WordPress did not hand out a security key for its own interface.' };
        const root = site.wpApiSettings?.root ?? new URL('../wp-json/', adminUrl).toString();
        try {
          const response = await fetch(`${root}${root.endsWith('/') ? '' : '/'}${path}`, {
            method,
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'X-WP-Nonce': nonce },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          return { ok: response.ok, status: response.status, body: ((await response.json().catch(() => null)) as Record<string, unknown> | null) };
        } catch (err) {
          return { ok: false, status: 0, body: null, error: (err as Error).message };
        }
      },
      { adminUrl: this.adminPath(), method, path, body },
    );
  }

  /**
   * A surgical edit of a post's saved text (block markup as WordPress keeps it): `change` gets it and returns the new
   * text; only `content` is sent back, never a status or date. Edits made in WordPress by hand stay as they are.
   */
  async editPostContent(postId: string, change: (raw: string) => string): Promise<{ changed: boolean; status: string }> {
    const current = await this.rest('GET', `wp/v2/posts/${encodeURIComponent(postId)}?context=edit`);
    const raw = (current.body?.content as { raw?: unknown } | undefined)?.raw;
    if (!current.ok || typeof raw !== 'string') {
      throw new AutomationError(`WordPress did not give the post's text: ${(current.body?.message as string | undefined) ?? current.error ?? `HTTP ${current.status}`}`);
    }
    const status = typeof current.body?.status === 'string' ? current.body.status : '';
    const next = change(raw);
    if (next === raw) return { changed: false, status };
    const saved = await this.rest('POST', `wp/v2/posts/${encodeURIComponent(postId)}`, { content: next });
    if (!saved.ok) throw new AutomationError(`WordPress did not save the post: ${(saved.body?.message as string | undefined) ?? saved.error ?? `HTTP ${saved.status}`}`);
    return { changed: true, status };
  }

  /** "draft", "future" (scheduled), "publish"… of a post, or null when it cannot be read. */
  async postStatus(postId: string): Promise<string | null> {
    const answer = await this.rest('GET', `wp/v2/posts/${encodeURIComponent(postId)}`);
    return answer.ok && typeof answer.body?.status === 'string' ? answer.body.status : null;
  }

  /**
   * Replaces the title and text of a post that is already scheduled or live — the editor offers only Schedule / Update
   * there, which the automation never presses. The article is turned into blocks the way pasting it into the editor
   * would (WordPress's own converter on the edit page, without touching the editor), then saved without a status or a
   * date, so the post keeps its schedule.
   */
  async updateLivePost(postId: string, values: { title: string; html: string; featuredMedia?: number | null }): Promise<{ status: string; link: string }> {
    await this.open(this.adminPath(`post.php?post=${encodeURIComponent(postId)}&action=edit`));
    await this.assertLoggedIn();
    const hasConverter = () =>
      this.page
        .evaluate(() => {
          const wp = (window as unknown as { wp?: { blocks?: { rawHandler?: unknown; getBlockTypes?: () => unknown[] } } }).wp;
          return Boolean(wp?.blocks?.rawHandler && (wp.blocks.getBlockTypes?.() ?? []).length > 5);
        })
        .catch(() => false);
    const content = (await waitUntil(hasConverter, { timeout: this.opts.timeoutMs, interval: 500 }))
      ? await this.page.evaluate((html) => {
          const wp = (window as unknown as { wp: { blocks: { rawHandler: (o: { HTML: string }) => unknown[]; serialize: (b: unknown[]) => string } } }).wp;
          return wp.blocks.serialize(wp.blocks.rawHandler({ HTML: html }));
        }, values.html)
      : values.html; // classic editor: the text is kept as HTML anyway
    const answer = await this.rest('POST', `wp/v2/posts/${encodeURIComponent(postId)}`, {
      title: values.title,
      content,
      ...(values.featuredMedia ? { featured_media: values.featuredMedia } : {}),
    });
    if (!answer.ok) {
      const reason = (answer.body?.message as string | undefined) ?? answer.error ?? `HTTP ${answer.status}`;
      throw new AutomationError(`WordPress did not save the post: ${reason}`);
    }
    this.opts.logger.info('Scheduled/live post updated through WordPress’s own interface — its publish time stays', { postId, status: answer.body?.status });
    return { status: String(answer.body?.status ?? ''), link: String(answer.body?.link ?? '') };
  }

  async openPost(editUrl: string): Promise<PostEditor> {
    const target = new URL(editUrl);
    const admin = new URL(this.site.adminUrl);
    if (target.origin !== admin.origin) throw new AutomationError('Stored draft URL does not belong to this website');
    await this.open(target.toString());
    await this.assertLoggedIn();
    return this.detectEditor();
  }

  private async detectEditor(): Promise<PostEditor> {
    const sel = this.editorOptions.wp;
    let kind: 'gutenberg' | 'classic';
    if (this.site.editorType === 'GUTENBERG') kind = 'gutenberg';
    else if (this.site.editorType === 'CLASSIC') kind = 'classic';
    else {
      const found = await waitForVisible(this.page, [...sel.gutenbergRoot, ...sel.classicRoot], this.opts.timeoutMs * 2);
      if (!found) throw new AutomationError('Could not detect the WordPress editor (block or classic)');
      kind = (await isAnyVisible(this.page, sel.gutenbergRoot)) ? 'gutenberg' : 'classic';
    }
    const editor = kind === 'gutenberg' ? new GutenbergEditor(this.page, this.editorOptions) : new ClassicEditor(this.page, this.editorOptions);
    await editor.prepare();
    return editor;
  }
}
