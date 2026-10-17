import type { Locator, Page } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';
import { escapeRegExp, normalizeWhitespace } from '@/lib/utils';
import { anyOf, clickFirstVisible, firstVisible, isAnyVisible, sleep, waitForVisible, waitUntil, type Scope } from '../browser/locators';
import type { RankMathSelectors } from './selectors';

const norm = (v: string) => normalizeWhitespace(v).toLowerCase();

export interface SnippetValues {
  title?: string | null;
  description?: string | null;
  permalink?: string | null;
}

/** Interacts with the Rank Math sidebar (block editor) or meta box (classic editor) like a user. */
export class RankMathPanel {
  constructor(
    private readonly page: Page,
    private readonly kind: 'gutenberg' | 'classic',
    private readonly opts: { timeoutMs: number; logger: AutomationLogger; sel: RankMathSelectors },
  ) {}

  private get sel(): RankMathSelectors {
    return this.opts.sel;
  }

  async open(): Promise<boolean> {
    if (this.kind === 'classic') {
      const box = await waitForVisible(this.page, ['#rank_math_metabox'], 10_000);
      if (!box) return false;
      await box.scrollIntoViewIfNeeded().catch(() => undefined);
      await clickFirstVisible(this.page, this.sel.generalTab);
      return true;
    }
    if (!(await isAnyVisible(this.page, ['.rank-math-sidebar-panel']))) {
      const button = await waitForVisible(this.page, this.sel.toolbarButton, 10_000);
      if (!button) return false;
      await button.click();
      if (!(await waitForVisible(this.page, this.sel.panel, 10_000))) return false;
    }
    await clickFirstVisible(this.page, this.sel.generalTab);
    return true;
  }

  /** What each focus keyword tag says: its title, its text and everything it shows. */
  private async focusKeywords(): Promise<string[]> {
    const texts = await anyOf(this.page, this.sel.focusKeywordTag)
      .evaluateAll((tags) =>
        tags.map((tag) =>
          [tag.getAttribute('title') ?? '', tag.querySelector('.tagify__tag-text')?.textContent ?? '', (tag as HTMLElement).innerText ?? ''].join('\n'),
        ),
      )
      .catch(() => [] as string[]);
    return texts.flatMap((text) => text.split('\n')).map(norm).filter(Boolean);
  }

  /**
   * The keyword is one of the tags. Rank Math also shows the keyword's score in its tag ("andre rock 79"), sometimes only
   * a moment after the keyword was added — a score is fine, any other word is not (e.g. one of its keyword suggestions).
   */
  private hasFocusKeyword(tags: string[], keyword: string): boolean {
    const pattern = new RegExp(`^${escapeRegExp(norm(keyword))}(\\s*\\d{1,3}(\\s*/\\s*100)?)?$`);
    return tags.some((tag) => pattern.test(tag));
  }

  async setFocusKeyword(keyword: string): Promise<boolean> {
    if (this.hasFocusKeyword(await this.focusKeywords(), keyword)) return true;
    const input = await waitForVisible(this.page, this.sel.focusKeywordInput, 10_000);
    if (!input) {
      this.opts.logger.warn('Rank Math focus keyword field not found');
      return false;
    }
    await input.click();
    await input.pressSequentially(keyword, { delay: 25 });
    await this.page.keyboard.press('Enter');
    const ok = await waitUntil(async () => this.hasFocusKeyword(await this.focusKeywords(), keyword), { timeout: 6000, interval: 300 });
    if (ok) this.opts.logger.info('Rank Math focus keyword set', { keyword });
    // What the tags said instead, so a change in Rank Math can be seen in the task log.
    else this.opts.logger.warn('Rank Math focus keyword not confirmed', { keyword, tags: (await this.focusKeywords()).slice(0, 10) });
    return ok;
  }

  private async readValue(field: Locator): Promise<string> {
    return field.evaluate((el) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? ''),
    );
  }

  private async fillField(scope: Scope, selectors: string[], value: string): Promise<boolean> {
    const field = await waitForVisible(scope, selectors, 5000);
    if (!field) return false;
    await field.click();
    await field.fill(value);
    if (norm(await this.readValue(field)) !== norm(value)) {
      await field.fill('');
      await field.pressSequentially(value, { delay: 5 });
    }
    // Blur so React commits the value.
    await this.page.keyboard.press('Tab');
    return norm(await this.readValue(field)) === norm(value);
  }

  /** Opens "Edit Snippet" and sets SEO title, meta description and permalink. */
  async setSnippet(values: SnippetValues): Promise<{ title: boolean; description: boolean; permalink: boolean }> {
    const result = { title: false, description: false, permalink: false };
    const button = await waitForVisible(this.page, this.sel.editSnippetButton, 10_000);
    if (!button) {
      this.opts.logger.warn('Rank Math "Edit Snippet" button not found');
      return result;
    }
    await button.click();
    const modal = await waitForVisible(this.page, this.sel.snippetModal, 10_000);
    const scope: Scope = modal ?? this.page;
    if (values.title) result.title = await this.fillField(scope, this.sel.snippetTitle, values.title);
    if (values.description) result.description = await this.fillField(scope, this.sel.snippetDescription, values.description);
    if (values.permalink) result.permalink = await this.fillField(scope, this.sel.snippetPermalink, values.permalink);

    if (!(await clickFirstVisible(modal ?? this.page, this.sel.modalClose))) await this.page.keyboard.press('Escape');
    if (modal) await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    this.opts.logger.info('Rank Math snippet updated', result);
    return result;
  }

  private async readScoreOnce(): Promise<number | null> {
    for (const selector of this.sel.score) {
      const loc = this.page.locator(selector).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      const text = await loc.innerText().catch(() => '');
      const m = /(\d{1,3})\s*(?:\/\s*100)?/.exec(text);
      if (m && Number(m[1]) <= 100) return Number(m[1]);
    }
    return null;
  }

  /** Reads the score shown by Rank Math once it has stopped changing (analysis is debounced). */
  async readScore(maxWaitMs = 20_000): Promise<number | null> {
    const deadline = Date.now() + maxWaitMs;
    let last: number | null = null;
    let stable = 0;
    while (Date.now() < deadline) {
      const score = await this.readScoreOnce();
      if (score !== null && score === last) {
        if (++stable >= 3) return score;
      } else {
        stable = 0;
      }
      last = score;
      await sleep(1000);
    }
    return last;
  }

  /** Visible failing/warning recommendations from the Rank Math checklist. */
  async readFailedChecks(): Promise<string[]> {
    const bodies = anyOf(this.page, this.sel.panelBodies);
    const count = await bodies.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const toggle = bodies.nth(i).locator('.components-panel__body-toggle').first();
      if ((await toggle.getAttribute('aria-expanded').catch(() => null)) === 'false') {
        await toggle.click().catch(() => undefined);
      }
    }
    const items = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('li'))
        .filter(
          (li) =>
            /\btest-(fail|warning)\b/.test(li.className) &&
            li.closest('.rank-math-sidebar-panel, #rank_math_metabox, .rank-math-checklist'),
        )
        .map((li) => (li.innerText || li.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    return Array.from(new Set(items));
  }

  async isAvailable(): Promise<boolean> {
    return (await firstVisible(this.page, [...this.sel.toolbarButton, ...this.sel.panel])) !== null;
  }
}
