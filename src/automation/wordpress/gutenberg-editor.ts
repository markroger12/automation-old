import type { Frame, Locator, Page, Request } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';
import { htmlToText } from '@/lib/html/convert';
import { normalizeWhitespace } from '@/lib/utils';
import {
  anyOf,
  clickFirstVisible,
  firstVisible,
  isAnyVisible,
  keepOnlyChecked,
  sleep,
  waitForVisible,
  waitUntil,
  type Scope,
} from '../browser/locators';
import { AutomationError, PublishBlockedError } from '../errors';
import { postIdFromUrl, type CategoryResult, type PostEditor, type SaveResult, type TagResult } from './editor';
import { RankMathPanel } from './rankmath';
import type { RankMathSelectors, WpSelectors } from './selectors';

const norm = (v: string) => normalizeWhitespace(v).toLowerCase();
const TERM_REQUEST = /\/wp\/v2\/(tags|categories)\b|rest_route=\/wp\/v2\/(tags|categories)\b/;

export interface EditorOptions {
  adminUrl: string;
  timeoutMs: number;
  logger: AutomationLogger;
  wp: WpSelectors;
  rankmath: RankMathSelectors;
}

/** Drives the WordPress block editor through its visible UI. */
export class GutenbergEditor implements PostEditor {
  readonly kind = 'gutenberg' as const;

  /** In-flight taxonomy lookups the editor makes when a tag/category is added (terms are resolved asynchronously). */
  private pendingTermRequests = new Set<Request>();

  constructor(
    readonly page: Page,
    private readonly opts: EditorOptions,
  ) {
    const isTermRequest = (req: Request) => TERM_REQUEST.test(decodeURIComponent(req.url()));
    page.on('request', (req) => {
      if (isTermRequest(req)) this.pendingTermRequests.add(req);
    });
    const done = (req: Request) => this.pendingTermRequests.delete(req);
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  }

  /** Waits until the editor has finished resolving/creating terms, so a save includes them. */
  private async waitForTermRequests(): Promise<void> {
    const idle = () => Promise.resolve(this.pendingTermRequests.size === 0);
    await waitUntil(idle, { timeout: this.opts.timeoutMs, interval: 200 });
    await sleep(500);
    await waitUntil(idle, { timeout: this.opts.timeoutMs, interval: 200 });
  }

  private get sel(): WpSelectors {
    return this.opts.wp;
  }

  /** The editor canvas lives in an iframe on modern WordPress; older versions render inline. */
  private async canvas(): Promise<Frame> {
    const iframe = await firstVisible(this.page, this.sel.canvasIframe);
    if (iframe) {
      const handle = await iframe.elementHandle();
      const frame = await handle?.contentFrame();
      if (frame) return frame;
    }
    return this.page.mainFrame();
  }

  async prepare(): Promise<void> {
    const root = await waitForVisible(this.page, this.sel.gutenbergRoot, this.opts.timeoutMs * 2);
    if (!root) throw new AutomationError('WordPress block editor did not load');
    const titleReady = await waitUntil(async () => (await firstVisible(await this.canvas(), this.sel.titleInput)) !== null, {
      timeout: this.opts.timeoutMs,
      interval: 500,
    });
    if (!titleReady) throw new AutomationError('Block editor title field did not appear');
    await this.dismissOverlays();
    if (await this.isCodeEditorActive()) {
      this.opts.logger.info('Editor was left in code editor mode; switching to the visual editor');
      await this.setCodeEditor(false);
    }
    this.opts.logger.info('WordPress block editor loaded');
  }

  private async isCodeEditorActive(): Promise<boolean> {
    return isAnyVisible(this.page, [...this.sel.codeEditorTextarea, ...this.sel.exitCodeEditor]);
  }

  /** Switches between the visual and code editor through the Options menu (keyboard shortcut as fallback). */
  private async setCodeEditor(active: boolean): Promise<void> {
    if ((await this.isCodeEditorActive()) === active) return;
    let switched = false;
    if (!active) switched = await clickFirstVisible(this.page, this.sel.exitCodeEditor);
    if (!switched && (await clickFirstVisible(this.page, this.sel.optionsMenu))) {
      const item = this.page.getByRole('menuitemradio', { name: active ? /code editor|code-editor/i : /visual editor|visueller editor/i }).first();
      if (await item.isVisible().catch(() => false)) {
        switched = await item
          .click({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);
      }
      if (!switched) await this.page.keyboard.press('Escape');
    }
    if (!switched) await this.page.keyboard.press('ControlOrMeta+Shift+Alt+M');
    const ok = await waitUntil(async () => (await this.isCodeEditorActive()) === active, { timeout: 10_000, interval: 250 });
    if (!ok) throw new AutomationError(`Could not ${active ? 'open' : 'close'} the code editor`);
    if (!active) {
      await waitUntil(async () => (await firstVisible(await this.canvas(), this.sel.titleInput)) !== null, { timeout: this.opts.timeoutMs });
    }
  }

  private async dismissOverlays(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      const closed = await clickFirstVisible(this.page, [...this.sel.welcomeGuideClose, ...this.sel.patternModalClose], 3000);
      if (!closed) break;
    }
  }

  async assertDraft(): Promise<void> {
    if (await isAnyVisible(this.page, this.sel.postStatusPublished)) {
      throw new PublishBlockedError('This post is already published or scheduled. The automation only edits drafts, so it stopped.');
    }
  }

  /** Featured image = the media item chosen in "Set featured image"; saved with the next "Save draft". */
  async setFeaturedImage(mediaId: number): Promise<boolean> {
    const done = await this.page
      .evaluate((id) => {
        const wp = (window as unknown as { wp?: { data?: { dispatch: (s: string) => { editPost: (e: object) => void }; select: (s: string) => { getEditedPostAttribute: (a: string) => unknown } } } }).wp;
        if (!wp?.data) return false;
        wp.data.dispatch('core/editor').editPost({ featured_media: id });
        return wp.data.select('core/editor').getEditedPostAttribute('featured_media') === id;
      }, mediaId)
      .catch(() => false);
    if (done) this.opts.logger.info('Featured image set', { mediaId });
    return done;
  }

  async setTitle(title: string): Promise<void> {
    const canvas = await this.canvas();
    const field = await waitForVisible(canvas, this.sel.titleInput, this.opts.timeoutMs);
    if (!field) throw new AutomationError('Post title field not found');
    await field.click();
    await field.fill(title);
    const read = async () =>
      norm(await field.evaluate((el) => (el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? ''))));
    if ((await read()) !== norm(title)) {
      await this.page.keyboard.press('ControlOrMeta+A');
      await this.page.keyboard.insertText(title);
    }
    if ((await read()) !== norm(title)) throw new AutomationError('Could not enter the post title');
    this.opts.logger.info('Post title entered', { title });
  }

  private async headingBlockCount(canvas: Frame): Promise<number> {
    return canvas.locator('[data-type="core/heading"]').count();
  }

  private async hasContent(canvas: Frame): Promise<boolean> {
    // Real blocks carry data-type; the "Type / to choose a block" appender does not.
    const blocks = canvas.locator('.block-editor-block-list__layout [data-block][data-type]');
    const count = await blocks.count();
    if (count === 0) return false;
    if (count === 1) {
      const first = blocks.first();
      if ((await first.getAttribute('data-empty')) === 'true') return false;
      const text = normalizeWhitespace((await first.innerText().catch(() => '')) ?? '');
      return text.length > 0;
    }
    return true;
  }

  private async withCodeEditor<T>(fn: (textarea: Locator) => Promise<T>): Promise<T> {
    await this.setCodeEditor(true);
    const textarea = await waitForVisible(this.page, this.sel.codeEditorTextarea, 10_000);
    if (!textarea) throw new AutomationError('Could not open the block editor code editor');
    try {
      return await fn(textarea);
    } finally {
      // The code editor commits its value on blur.
      await textarea.evaluate((el) => (el as HTMLElement).blur()).catch(() => undefined);
      await this.setCodeEditor(false);
    }
  }

  private async focusEmptyParagraph(): Promise<void> {
    const canvas = await this.canvas();
    const appender = await waitForVisible(canvas, this.sel.defaultAppender, 5000);
    if (appender) {
      await appender.click();
    } else {
      const title = await waitForVisible(canvas, this.sel.titleInput, 5000);
      if (!title) throw new AutomationError('Could not focus the editor content area');
      await title.click();
      await this.page.keyboard.press('End');
      await this.page.keyboard.press('Enter');
    }
    const focused = await waitUntil(
      () =>
        canvas.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return Boolean(el && el.isContentEditable && !el.closest('.editor-post-title, .wp-block-post-title, h1'));
        }),
      { timeout: 5000, interval: 200 },
    );
    if (!focused) throw new AutomationError('The empty paragraph block did not receive focus');
  }

  private async contentLooksInserted(expectedHeadings: number, plainText: string, requireHeadingBlocks = true): Promise<boolean> {
    const canvas = await this.canvas();
    const needed = Math.max(1, Math.floor(expectedHeadings * 0.8));
    if (requireHeadingBlocks && expectedHeadings > 0 && (await this.headingBlockCount(canvas)) < needed) return false;
    const snippet = norm(plainText).slice(0, 60);
    const text = norm(
      await canvas
        .locator('.block-editor-block-list__layout')
        .first()
        .innerText()
        .catch(() => ''),
    );
    return snippet.length === 0 || text.includes(snippet.slice(0, 40));
  }

  /**
   * Inserts the article like a user pasting HTML into an empty paragraph, so WordPress converts it
   * into native Heading/Paragraph/Table blocks. Falls back to the real clipboard, then the code editor.
   */
  async setContent(html: string, expectedHeadings: number): Promise<void> {
    const plain = htmlToText(html);
    const inserted = () =>
      waitUntil(() => this.contentLooksInserted(expectedHeadings, plain), { timeout: 15_000, interval: 500 });

    if (await this.hasContent(await this.canvas())) {
      this.opts.logger.info('Clearing existing post content before inserting the article');
      await this.withCodeEditor(async (textarea) => {
        await textarea.fill('');
      });
    }

    // Strategy 1: paste event.
    await this.focusEmptyParagraph();
    await (await this.canvas()).evaluate(
      ({ htmlValue, textValue }) => {
        const target = document.activeElement as HTMLElement | null;
        if (!target) return;
        const data = new DataTransfer();
        data.setData('text/html', htmlValue);
        data.setData('text/plain', textValue);
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      },
      { htmlValue: html, textValue: plain },
    );
    if (await inserted()) {
      this.opts.logger.info('Article content pasted into the block editor');
      return;
    }

    // Strategy 2: real clipboard + Ctrl/Cmd+V.
    try {
      this.opts.logger.warn('Paste event did not insert content; trying the system clipboard');
      const origin = new URL(this.page.url()).origin;
      await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await this.page.evaluate(
        async ({ htmlValue, textValue }) => {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([htmlValue], { type: 'text/html' }),
              'text/plain': new Blob([textValue], { type: 'text/plain' }),
            }),
          ]);
        },
        { htmlValue: html, textValue: plain },
      );
      await this.focusEmptyParagraph();
      await this.page.keyboard.press('ControlOrMeta+V');
      if (await inserted()) {
        this.opts.logger.info('Article content pasted from the clipboard');
        return;
      }
    } catch (err) {
      this.opts.logger.warn('Clipboard paste failed', { error: (err as Error).message });
    }

    // Strategy 3: code editor.
    this.opts.logger.warn('Falling back to the code editor to insert content');
    await this.withCodeEditor(async (textarea) => {
      await textarea.fill(html);
    });
    // Raw HTML from the code editor becomes a Classic block, so only the text is verified here.
    const insertedAsHtml = await waitUntil(() => this.contentLooksInserted(expectedHeadings, plain, false), { timeout: 15_000, interval: 500 });
    if (!insertedAsHtml) throw new AutomationError('Article content could not be inserted into the block editor');
    this.opts.logger.info('Article content inserted through the code editor');
  }

  private async openSettingsPostTab(): Promise<void> {
    if (!(await isAnyVisible(this.page, this.sel.postTab))) {
      await clickFirstVisible(this.page, this.sel.settingsToggle);
      await waitForVisible(this.page, this.sel.postTab, 8000);
    }
    const tab = await firstVisible(this.page, this.sel.postTab);
    if (tab && (await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  }

  private async openPanel(title: RegExp): Promise<Locator | null> {
    const bodies = anyOf(this.page, this.sel.panelBody);
    const count = await bodies.count();
    for (let i = 0; i < count; i++) {
      const body = bodies.nth(i);
      const toggle = body.locator('.components-panel__body-toggle').first();
      if (!(await toggle.isVisible().catch(() => false))) continue;
      const label = normalizeWhitespace(await toggle.innerText().catch(() => ''));
      if (!title.test(label)) continue;
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      return body;
    }
    return null;
  }

  private async findCheckbox(scope: Scope, name: string): Promise<Locator | null> {
    const exact = scope.getByRole('checkbox', { name, exact: true }).first();
    if (await exact.isVisible().catch(() => false)) return exact;
    const labels = scope.locator('label');
    const n = await labels.count();
    for (let i = 0; i < n; i++) {
      const label = labels.nth(i);
      if (norm(await label.innerText().catch(() => '')) !== norm(name)) continue;
      const forId = await label.getAttribute('for');
      if (forId) {
        const box = scope.locator(`[id="${forId.replace(/"/g, '')}"]`).first();
        if (await box.count()) return box;
      }
      const inner = label.locator('input[type="checkbox"]').first();
      if (await inner.count()) return inner;
    }
    return null;
  }

  async selectCategory(name: string, options: { createIfMissing: boolean }): Promise<CategoryResult> {
    await this.openSettingsPostTab();
    const panel = await this.openPanel(/^(categories|kategorien)$/i);
    if (!panel) return { selected: false, created: false, message: 'Categories panel not found in the editor sidebar' };
    // Terms are fetched after the panel opens.
    await panel.locator('input[type="checkbox"]').first().waitFor({ state: 'visible', timeout: this.opts.timeoutMs }).catch(() => undefined);

    const search = await firstVisible(panel, this.sel.categorySearch);
    if (search) await search.fill(name).catch(() => undefined);

    let checkbox = await this.findCheckbox(panel, name);
    let created = false;
    if (!checkbox && options.createIfMissing) {
      if (search) await search.fill('').catch(() => undefined);
      if (await clickFirstVisible(panel, this.sel.addNewCategoryToggle)) {
        const input = await waitForVisible(panel, this.sel.addNewCategoryInput, 5000);
        if (input) {
          await input.fill(name);
          await clickFirstVisible(panel, this.sel.addNewCategorySubmit);
          created = true;
          await waitUntil(async () => (await this.findCheckbox(panel, name)) !== null, { timeout: 10_000 });
          checkbox = await this.findCheckbox(panel, name);
        }
      }
    }
    if (!checkbox) {
      if (search) await search.fill('').catch(() => undefined);
      return { selected: false, created: false, message: `Category "${name}" was not found in WordPress` };
    }
    if (!(await checkbox.isChecked())) await checkbox.check();
    // Clear the search so every category is listed again (a filtered list hides the ones to remove).
    if (search) await search.fill('').catch(() => undefined);
    await this.waitForTermRequests();

    const removed = await keepOnlyChecked(panel.locator('input[type="checkbox"]'), (await this.findCheckbox(panel, name)) ?? checkbox);
    await this.waitForTermRequests();
    this.opts.logger.info('Category selected', { name, created, removedOtherCategories: removed });
    return { selected: true, created, message: created ? `Created and selected "${name}"` : `Selected "${name}"` };
  }

  private async tokenTexts(scope: Locator): Promise<string[]> {
    const texts = await scope.locator(this.sel.tokenText.join(', ')).allInnerTexts().catch(() => [] as string[]);
    // Each token contains a screen-reader label such as "Sydney Sweeney (1 of 1)" plus the visible name.
    return texts.flatMap((t) => t.split('\n')).map((line) => norm(line.replace(/\s*\(\d+ of \d+\)\s*$/, '')));
  }

  async addTag(tag: string): Promise<TagResult> {
    await this.openSettingsPostTab();
    const panel = await this.openPanel(/^(tags|schlagwörter|schlagworte)$/i);
    if (!panel) return { added: false, existingTerm: false, message: 'Tags panel not found in the editor sidebar' };

    if ((await this.tokenTexts(panel)).includes(norm(tag))) {
      return { added: false, existingTerm: true, message: 'Tag already assigned to the post' };
    }
    const input = await waitForVisible(panel, this.sel.tokenInput, 5000);
    if (!input) return { added: false, existingTerm: false, message: 'Tag input not found' };
    // Something covering the field (a floating help widget) must not stop typing the tag.
    await input.click({ timeout: 8000 }).catch(() => input.focus());
    await input.pressSequentially(tag, { delay: 30 });

    let existingTerm = false;
    const suggestions = anyOf(this.page, this.sel.tokenSuggestion);
    await suggestions.first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined);
    const count = await suggestions.count();
    for (let i = 0; i < count; i++) {
      const s = suggestions.nth(i);
      if (norm(await s.innerText().catch(() => '')) === norm(tag)) {
        await s.click();
        existingTerm = true;
        break;
      }
    }
    // Pressing Enter reuses a term with the same name if WordPress already has one.
    if (!existingTerm) await input.press('Enter');
    await this.waitForTermRequests();

    const ok = await waitUntil(async () => (await this.tokenTexts(panel)).includes(norm(tag)), { timeout: 8000 });
    this.opts.logger.info(ok ? 'Tag added' : 'Tag could not be confirmed', { tag, existingTerm });
    return { added: ok, existingTerm, message: ok ? (existingTerm ? 'Selected existing tag' : 'Added tag') : 'Tag was not confirmed' };
  }

  async setSlug(slug: string): Promise<boolean> {
    await this.openSettingsPostTab();
    const fillSlug = async (input: Locator) => {
      await input.fill(slug);
      await input.press('Tab');
      return true;
    };

    // WordPress 6.6+: "Link"/"URL" row in the Summary panel opens a popover.
    const toggle = await firstVisible(this.page, this.sel.urlPanelToggle);
    if (toggle) {
      await toggle.click();
      const input =
        (await waitForVisible(this.page, this.sel.slugInput, 5000)) ??
        (await this.page.getByLabel(/^(slug|url slug|permalink|titelform|url-titelform)$/i).first().isVisible().catch(() => false)
          ? this.page.getByLabel(/^(slug|url slug|permalink|titelform|url-titelform)$/i).first()
          : null);
      if (input) {
        await fillSlug(input);
        await this.page.keyboard.press('Escape');
        this.opts.logger.info('Slug set in the block editor URL panel', { slug });
        return true;
      }
      await this.page.keyboard.press('Escape');
    }

    // Older WordPress: "Permalink" panel.
    const panel = await this.openPanel(/^(permalink|url|link)$/i);
    if (panel) {
      const input = await waitForVisible(panel, this.sel.slugInput, 5000);
      if (input) {
        await fillSlug(input);
        this.opts.logger.info('Slug set in the Permalink panel', { slug });
        return true;
      }
    }
    return false;
  }

  /** The block editor's own save state (independent of the admin language), or null when it cannot be read. */
  private async editorSaveState(): Promise<{
    saving: boolean;
    failed: boolean;
    postId: number | null;
    status: string | null;
    notices: string[];
  } | null> {
    return this.page
      .evaluate(() => {
        type Store = Record<string, ((...args: unknown[]) => unknown) | undefined>;
        const data = (window as unknown as { wp?: { data?: { select: (name: string) => Store | undefined } } }).wp?.data;
        const editor = data?.select('core/editor');
        if (!editor?.isSavingPost) return null;
        const notices = ((data?.select('core/notices')?.getNotices?.() as { status?: string; content?: string }[] | undefined) ?? [])
          .filter((n) => n.status === 'error')
          .map((n) => String(n.content ?? '').slice(0, 200));
        return {
          saving: Boolean(editor.isSavingPost()),
          failed: Boolean(editor.didPostSaveRequestFail?.()),
          postId: (editor.getCurrentPostId?.() as number | undefined) ?? null,
          status: (editor.getEditedPostAttribute?.('status') as string | undefined) ?? null,
          notices,
        };
      })
      .catch(() => null);
  }

  async saveDraft(): Promise<SaveResult> {
    let savedPostId: number | null = null;
    await this.assertDraft();
    await this.waitForTermRequests();
    const button = await waitForVisible(this.page, this.sel.saveDraft, 10_000);
    if (!button) throw new AutomationError('"Save draft" button not found');
    const label = normalizeWhitespace(await button.innerText().catch(() => ''));
    if (/publish|schedule|update|submit|veröffentlichen|planen|aktualisieren|einreichen|zur überprüfung/i.test(label)) {
      throw new PublishBlockedError(`Refusing to click "${label}" — only "Save draft" is allowed`);
    }

    if (await button.isEnabled()) {
      const response = this.page
        .waitForResponse(
          (r) => /wp\/v2\/posts|rest_route=%2Fwp%2Fv2%2Fposts/.test(r.url()) && ['POST', 'PUT'].includes(r.request().method()) && !/autosaves/.test(r.url()),
          { timeout: this.opts.timeoutMs * 2 },
        )
        .catch(() => null);
      await button.click();
      const res = await response;
      if (res && !res.ok()) throw new AutomationError(`WordPress returned HTTP ${res.status()} while saving the draft`);
      // WordPress answers the save with the stored post. That is the confirmation — whatever language the admin uses
      // and even when plugins (Elementor, Hostinger, …) keep the editor's "Save draft" button active afterwards.
      const stored = res ? ((await res.json().catch(() => null)) as { id?: number; status?: string } | null) : null;
      savedPostId = stored?.id && stored.status && stored.status !== 'publish' ? stored.id : null;
      if (!savedPostId) {
        const saved = await waitUntil(
          async () => {
            const state = await this.editorSaveState();
            if (state && !state.saving && state.failed) return true;
            return (await isAnyVisible(this.page, this.sel.savedIndicator)) || !(await button.isEnabled().catch(() => true));
          },
          { timeout: this.opts.timeoutMs, interval: 400 },
        );
        const state = await this.editorSaveState();
        if (!saved || state?.failed) {
          this.opts.logger.warn('Draft save not confirmed', { button: label, editor: state });
          const notices = state?.notices.length ? `: ${state.notices.join(' | ')}` : '';
          throw new AutomationError(`WordPress did not confirm that the draft was saved${notices}`);
        }
        savedPostId = state?.postId ?? null;
      }
    }

    await this.page.waitForURL(/post\.php\?post=\d+/, { timeout: 15_000 }).catch(() => undefined);
    const postId = postIdFromUrl(this.page.url()) ?? (savedPostId ? String(savedPostId) : null);
    const base = this.opts.adminUrl.endsWith('/') ? this.opts.adminUrl : `${this.opts.adminUrl}/`;
    const editUrl = postId ? new URL(`post.php?post=${postId}&action=edit`, base).toString() : this.page.url();
    this.opts.logger.info('Draft saved', { postId, editUrl });
    return { editUrl, postId };
  }

  async rankMath(): Promise<RankMathPanel | null> {
    const panel = new RankMathPanel(this.page, 'gutenberg', {
      timeoutMs: this.opts.timeoutMs,
      logger: this.opts.logger,
      sel: this.opts.rankmath,
    });
    const available = await waitUntil(() => panel.isAvailable(), { timeout: 8000 });
    return available ? panel : null;
  }
}
