// Categories are read from WordPress (Posts → Categories) instead of being typed in.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { WordPressClient } from '@/automation/wordpress/wordpress-client';
import type { AutomationLogger } from '@/lib/logger';

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-categories-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db').replace(/\\/g, '/')}`;

const silent: AutomationLogger = { debug() {}, info() {}, warn() {}, error() {} };

// A German wp-admin category list split over two pages, like WordPress shows it.
const listPage = (rows: [id: number, name: string, slug: string, parent: number, posts: number][], page: number, pages: number) => `<!doctype html><html lang="de"><body>
  <div id="wpadminbar" style="height:32px">Dashboard</div>
  <div class="tablenav top"><span class="displaying-num">10 Einträge</span><span class="total-pages">${pages}</span></div>
  <table class="wp-list-table"><tbody id="the-list">
  ${rows
    .map(
      ([id, name, slug, parent, posts]) => `<tr id="tag-${id}">
        <td class="name column-name"><strong><a class="row-title">${parent ? '— ' : ''}${name}</a></strong>
          <div class="hidden" id="inline_${id}"><div class="name">${name}</div><div class="slug">${slug}</div><div class="parent">${parent}</div></div></td>
        <td class="posts column-posts"><a>${posts}</a></td></tr>`,
    )
    .join('')}
  </tbody></table><p>page ${page}</p></body></html>`;

describe('reading categories from wp-admin (browser)', () => {
  let browser: Browser | null = null;
  beforeAll(async () => {
    browser = await chromium
      .launch({ headless: true, channel: process.env.BROWSER_CHANNEL === 'chromium' ? undefined : (process.env.BROWSER_CHANNEL ?? 'chrome') })
      .catch(() => null);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('reads every page of Posts → Categories with exact names, including child categories', async () => {
    if (!browser) return;
    const context = await browser.newContext();
    await context.route('https://wp.test/**', (route) => {
      const paged = Number(new URL(route.request().url()).searchParams.get('paged') ?? '1');
      const rows: Parameters<typeof listPage>[0] =
        paged === 1
          ? [
              [1, 'Blog', 'blog', 0, 4],
              [27, 'Gesundheit', 'gesundheit', 0, 2],
              [31, 'Ernährung & Fitness', 'ernaehrung-fitness', 27, 1],
            ]
          : [[24, 'Prominente', 'prominente', 0, 365]];
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: listPage(rows, paged, 2) });
    });
    const page = await context.newPage();
    const client = new WordPressClient(page, { name: 'Test', adminUrl: 'https://wp.test/wp-admin/', editorType: 'AUTO' }, { timeoutMs: 5000, logger: silent });
    const categories = await client.listCategories();
    expect(categories.map((c) => c.name)).toEqual(['Blog', 'Gesundheit', 'Ernährung & Fitness', 'Prominente']);
    expect(categories[2]).toEqual({ name: 'Ernährung & Fitness', slug: 'ernaehrung-fitness', parentId: '27', posts: 1 });
    expect(categories[3].posts).toBe(365);
    await context.close();
  });
});

describe('syncing the app’s category list', () => {
  let skipReason: string | null = null;
  let prisma: typeof import('@/lib/db').prisma;
  let sync: typeof import('@/lib/services/categories').syncWebsiteCategories;

  beforeAll(async () => {
    try {
      execSync('npx prisma migrate deploy', { cwd: root, env: process.env, stdio: 'pipe' });
    } catch (err) {
      skipReason = `database could not be created: ${(err as Error).message.split('\n')[0]}`;
      return;
    }
    ({ prisma } = await import('@/lib/db'));
    ({ syncWebsiteCategories: sync } = await import('@/lib/services/categories'));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  });

  it('adds new categories, removes ones the site no longer has and keeps the site’s spelling', async () => {
    if (skipReason) return console.warn(`Category sync tests skipped: ${skipReason}`);
    const site = await prisma.website.create({ data: { name: 'Peak Buzz', url: 'https://peakbuzz.co.uk', adminUrl: 'https://peakbuzz.co.uk/wp-admin/' } });
    const old = await prisma.category.create({ data: { websiteId: site.id, name: 'Old Category' } });
    await prisma.category.create({ data: { websiteId: site.id, name: 'celebrity' } });
    await prisma.website.update({ where: { id: site.id }, data: { defaultCategoryId: old.id } });

    const result = await sync(site.id, ['Blog', 'Celebrity', 'Tech', 'tech']);
    expect(result).toEqual({ total: 3, added: ['Blog', 'Tech'], removed: ['Old Category'] });
    const names = (await prisma.category.findMany({ where: { websiteId: site.id }, orderBy: { name: 'asc' } })).map((c) => c.name);
    expect(names).toEqual(['Blog', 'Celebrity', 'Tech']);
    // The removed category was the default one.
    expect((await prisma.website.findUniqueOrThrow({ where: { id: site.id } })).defaultCategoryId).toBeNull();

    // A page that could not be read never wipes the list.
    expect(await sync(site.id, [])).toEqual({ total: 3, added: [], removed: [] });
    expect(await prisma.category.count({ where: { websiteId: site.id } })).toBe(3);
  });
});
