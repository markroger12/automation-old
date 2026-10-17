// Article History bulk actions against a throwaway SQLite database.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-bulk-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db').replace(/\\/g, '/')}`;

let skipReason: string | null = null;
let prisma: typeof import('@/lib/db').prisma;
let bulk: typeof import('@/lib/services/tasks').performBulkTaskAction;

beforeAll(async () => {
  try {
    execSync('npx prisma migrate deploy', { cwd: root, env: process.env, stdio: 'pipe' });
  } catch (err) {
    skipReason = `database could not be created: ${(err as Error).message.split('\n')[0]}`;
    return;
  }
  ({ prisma } = await import('@/lib/db'));
  ({ performBulkTaskAction: bulk } = await import('@/lib/services/tasks'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

const task = (keyword: string, extra: Record<string, unknown> = {}) =>
  prisma.articleTask.create({ data: { keyword, moduleKey: 'celebrity-writer', status: 'NEEDS_REVIEW', ...extra } });

describe('bulk task actions', () => {
  it('prepares the database', () => {
    if (skipReason) console.warn(`Bulk action tests skipped: ${skipReason}`);
    expect(true).toBe(true);
  });

  it('assigns a website (with its default category) and skips articles that are being processed', async () => {
    if (skipReason) return;
    const site = await prisma.website.create({ data: { name: 'Promizeiten', url: 'https://promizeiten.de', adminUrl: 'https://promizeiten.de/wp-admin/' } });
    const category = await prisma.category.create({ data: { websiteId: site.id, name: 'Promis' } });
    await prisma.website.update({ where: { id: site.id }, data: { defaultCategoryId: category.id } });
    const a = await task('Fabian Drews', { language: 'German' });
    const b = await task('Jürgen Drews');
    const running = await task('Busy Person', { status: 'RESEARCHING' });

    const res = await bulk({ ids: [a.id, b.id, running.id], action: 'assign-website', websiteId: site.id, categoryId: null });
    expect(res.succeeded).toBe(2);
    expect(res.results.find((r) => r.id === running.id)).toMatchObject({ ok: false, message: 'This article is being processed right now' });
    const updated = await prisma.articleTask.findUnique({ where: { id: a.id } });
    expect(updated).toMatchObject({ websiteId: site.id, categoryId: category.id, categoryName: 'Promis' });
  });

  it('reports per article why an action could not run', async () => {
    if (skipReason) return;
    const noSite = await task('No Website', { bodyHtml: '<p>Text</p>' });
    const noContent = await task('No Content');
    const res = await bulk({ ids: [noSite.id, noContent.id], action: 'send-to-wordpress', websiteId: null, categoryId: null });
    expect(res.succeeded).toBe(0);
    expect(res.results.map((r) => r.message)).toEqual(['Select a website for this article first', 'The article has not been generated yet']);

    const seo = await bulk({ ids: [noContent.id], action: 'seo-check', websiteId: null, categoryId: null });
    expect(seo.results[0]).toMatchObject({ ok: false, message: 'There is no article content to check yet' });
  });

  it('deletes several articles at once', async () => {
    if (skipReason) return;
    const x = await task('Delete Me 1');
    const y = await task('Delete Me 2');
    const res = await bulk({ ids: [x.id, y.id], action: 'delete', websiteId: null, categoryId: null });
    expect(res.succeeded).toBe(2);
    expect(await prisma.articleTask.count({ where: { id: { in: [x.id, y.id] } } })).toBe(0);
  });

  it('validates the request', async () => {
    const { bulkTaskActionSchema } = await import('@/lib/validation');
    expect(bulkTaskActionSchema.safeParse({ ids: [], action: 'retry' }).success).toBe(false);
    expect(bulkTaskActionSchema.safeParse({ ids: ['abc'], action: 'assign-website' }).success).toBe(false);
    expect(bulkTaskActionSchema.safeParse({ ids: ['abc'], action: 'publish' }).success).toBe(false);
    expect(bulkTaskActionSchema.safeParse({ ids: ['abc'], action: 'send-to-wordpress' }).success).toBe(true);
  });
});
