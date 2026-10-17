import type { Locator, Page } from 'playwright';
import { normalizeWhitespace } from '@/lib/utils';
import { clickFirstVisible, firstVisible, isAnyVisible, keepOnlyChecked, waitForVisible, waitUntil } from '../browser/locators';
import { AutomationError, PublishBlockedError } from '../errors';
import { postIdFromUrl, type CategoryResult, type PostEditor, type SaveResult, type TagResult } from './editor';
import type { EditorOptions } from './gutenberg-editor';
import { RankMathPanel } from './rankmath';
import type { WpSelectors } from './selectors';

const norm = (v: string) => normalizeWhitespace(v).toLowerCase();

/** Drives the Classic Editor (post.php with TinyMCE / Text tab). */
export class ClassicEditor implements PostEditor {
  readonly kind = 'classic' as const;

  constructor(
    readonly page: Page,
    private readonly opts: EditorOptions,
  ) {}

  private get sel(): WpSelectors {
    return this.opts.wp;
  }

  async prepare(): Promise<void> {
    const title = await waitForVisible(this.page, this.sel.classicTitle, this.opts.timeoutMs * 2);
    if (!title) throw new AutomationError('Classic editor did not load');
    this.opts.logger.info('WordPress classic editor loaded');
  }

  async assertDraft(): Promise<void> {
    const status = await firstVisible(this.page, this.sel.classicPostStatus);
    const text = status ? norm(await status.innerText().catch(() => '')) : '';
    if (/published|scheduled|pending|private/.test(text)) {
      throw new PublishBlockedError(`This post status is "${text}". The automation only edits drafts, so it stopped.`);
    }
  }

  async setTitle(title: string): Promise<void> {
    const field = await waitForVisible(this.page, this.sel.classicTitle, this.opts.timeoutMs);
    if (!field) throw new AutomationError('Post title field not found');
    await field.fill(title);
    if (norm(await field.inputValue()) !== norm(title)) throw new AutomationError('Could not enter the post title');
    this.opts.logger.info('Post title entered', { title });
  }

  async setContent(html: string): Promise<void> {
    await clickFirstVisible(this.page, this.sel.classicTextTab);
    const textarea = await waitForVisible(this.page, this.sel.classicContent, this.opts.timeoutMs);
    if (!textarea) throw new AutomationError('Classic editor content area not found');
    await textarea.fill(html);
    const ok = await waitUntil(async () => (await textarea.inputValue()).length >= html.length * 0.95, { timeout: 5000 });
    if (!ok) throw new AutomationError('Article content could not be inserted into the classic editor');
    this.opts.logger.info('Article content inserted into the classic editor (Text tab)');
  }

  private async categoryCheckbox(name: string): Promise<Locator | null> {
    const list = await firstVisible(this.page, this.sel.classicCategoryChecklist);
    if (!list) return null;
    const labels = list.locator('label');
    const count = await labels.count();
    for (let i = 0; i < count; i++) {
      const label = labels.nth(i);
      if (norm(await label.innerText().catch(() => '')) === norm(name)) return label.locator('input[type="checkbox"]').first();
    }
    return null;
  }

  async selectCategory(name: string, options: { createIfMissing: boolean }): Promise<CategoryResult> {
    let checkbox = await this.categoryCheckbox(name);
    let created = false;
    if (!checkbox && options.createIfMissing && (await clickFirstVisible(this.page, this.sel.classicCategoryAddToggle))) {
      const input = await waitForVisible(this.page, this.sel.classicCategoryNewInput, 5000);
      if (input) {
        await input.fill(name);
        await clickFirstVisible(this.page, this.sel.classicCategoryAddSubmit);
        created = true;
        await waitUntil(async () => (await this.categoryCheckbox(name)) !== null, { timeout: 10_000 });
        checkbox = await this.categoryCheckbox(name);
      }
    }
    if (!checkbox) return { selected: false, created: false, message: `Category "${name}" was not found in WordPress` };
    if (!(await checkbox.isChecked())) await checkbox.check();
    const list = await firstVisible(this.page, this.sel.classicCategoryChecklist);
    const removed = list ? await keepOnlyChecked(list.locator('input[type="checkbox"]'), checkbox) : 0;
    this.opts.logger.info('Category selected', { name, created, removedOtherCategories: removed });
    return { selected: true, created, message: created ? `Created and selected "${name}"` : `Selected "${name}"` };
  }

  private async currentTags(): Promise<string[]> {
    const items = await this.page.locator(this.sel.classicTagList.join(', ')).allInnerTexts().catch(() => [] as string[]);
    return items.map((t) => norm(t.replace(/remove term:?/i, '').replace(/^[x✕×]\s*/i, '')));
  }

  async addTag(tag: string): Promise<TagResult> {
    if ((await this.currentTags()).some((t) => t.endsWith(norm(tag)))) {
      return { added: false, existingTerm: true, message: 'Tag already assigned to the post' };
    }
    const input = await waitForVisible(this.page, this.sel.classicTagInput, 5000);
    if (!input) return { added: false, existingTerm: false, message: 'Tag input not found (Tags meta box hidden?)' };
    await input.click();
    await input.pressSequentially(tag, { delay: 30 });
    let existingTerm = false;
    const suggestion = this.page.locator('.ui-autocomplete li, .wp-tags-autocomplete li');
    await suggestion.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
    const count = await suggestion.count();
    for (let i = 0; i < count; i++) {
      if (norm(await suggestion.nth(i).innerText().catch(() => '')) === norm(tag)) {
        await suggestion.nth(i).click();
        existingTerm = true;
        break;
      }
    }
    if (!(await clickFirstVisible(this.page, this.sel.classicTagAdd))) await input.press('Enter');
    const ok = await waitUntil(async () => (await this.currentTags()).some((t) => t.endsWith(norm(tag))), { timeout: 6000 });
    return { added: ok, existingTerm, message: ok ? 'Tag added' : 'Tag was not confirmed' };
  }

  async setSlug(slug: string): Promise<boolean> {
    const metabox = await firstVisible(this.page, this.sel.classicSlugMetabox);
    if (metabox) {
      await metabox.fill(slug);
      return true;
    }
    if (await clickFirstVisible(this.page, this.sel.classicSlugEdit)) {
      const input = await waitForVisible(this.page, this.sel.classicSlugInput, 5000);
      if (input) {
        await input.fill(slug);
        await clickFirstVisible(this.page, this.sel.classicSlugSave);
        this.opts.logger.info('Slug set in the classic editor permalink editor', { slug });
        return true;
      }
    }
    return false;
  }

  async saveDraft(): Promise<SaveResult> {
    await this.assertDraft();
    const button = await waitForVisible(this.page, this.sel.classicSaveDraft, 10_000);
    if (!button) throw new AutomationError('"Save Draft" button not found');
    const label = norm((await button.getAttribute('value')) ?? (await button.innerText().catch(() => '')));
    if (/publish|schedule|update|submit|veröffentlichen|planen|aktualisieren|einreichen/.test(label)) throw new PublishBlockedError(`Refusing to click "${label}"`);

    await Promise.all([this.page.waitForLoadState('domcontentloaded'), button.click()]);
    await this.page.waitForURL(/post\.php\?post=\d+/, { timeout: this.opts.timeoutMs * 2 });
    const confirmed = await waitUntil(() => isAnyVisible(this.page, this.sel.classicNotice), { timeout: this.opts.timeoutMs });
    if (!confirmed) throw new AutomationError('WordPress did not confirm that the draft was saved');

    const postId = postIdFromUrl(this.page.url()) ?? (await this.page.locator('#post_ID').inputValue().catch(() => null));
    const base = this.opts.adminUrl.endsWith('/') ? this.opts.adminUrl : `${this.opts.adminUrl}/`;
    const editUrl = postId ? new URL(`post.php?post=${postId}&action=edit`, base).toString() : this.page.url();
    this.opts.logger.info('Draft saved', { postId, editUrl });
    return { editUrl, postId };
  }

  async rankMath(): Promise<RankMathPanel | null> {
    const box = await waitForVisible(this.page, ['#rank_math_metabox'], 8000);
    if (!box) return null;
    return new RankMathPanel(this.page, 'classic', { timeoutMs: this.opts.timeoutMs, logger: this.opts.logger, sel: this.opts.rankmath });
  }
}
