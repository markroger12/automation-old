// Internal link ("Das könnte Ihnen gefallen: <previous article>") — HTML handling and finding the previous article.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleArticle } from '@/content/assembly';
import { extractInternalLink, renderInternalLink, withInternalLink } from '@/content/internal-link';

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-internal-link-test-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db').replace(/\\/g, '/')}`;

const line = 'Das könnte Ihnen gefallen:';
const link = { line, url: 'https://promizeiten.de/fabian-kahl/', title: 'Wer ist Fabian Kahl? Alles über den Trödeltrupp-Star' };

describe('internal link HTML', () => {
  it('renders the line in bold with the full title as link text', () => {
    expect(renderInternalLink(link)).toBe(
      '<p><strong>Das könnte Ihnen gefallen: <a href="https://promizeiten.de/fabian-kahl/">Wer ist Fabian Kahl? Alles über den Trödeltrupp-Star</a></strong></p>',
    );
  });

  it('replaces the old link instead of adding a second one, also when ChatGPT moved it', () => {
    const body = '<p>Intro</p><h2>Fazit</h2><p>Ende.</p>';
    const once = withInternalLink(body, renderInternalLink(link));
    const twice = withInternalLink(once, renderInternalLink({ ...link, url: 'https://promizeiten.de/ramona-drews/', title: 'Ramona Drews' }));
    expect(twice.match(/Das könnte Ihnen gefallen/g)).toHaveLength(1);
    expect(twice.endsWith('<a href="https://promizeiten.de/ramona-drews/">Ramona Drews</a></strong></p>')).toBe(true);

    const moved = '<p>Intro</p><p><strong>Das könnte Ihnen gefallen:</strong> <a href="https://promizeiten.de/x/">X</a></p><h2>Fazit</h2><p>Ende.</p>';
    const fixed = withInternalLink(moved, renderInternalLink(link));
    expect(fixed.match(/Das könnte Ihnen gefallen/g)).toHaveLength(1);
    expect(fixed.startsWith('<p>Intro</p><h2>Fazit</h2>')).toBe(true);

    expect(withInternalLink(once, null)).toBe(body);
  });

  it('never touches ordinary bold paragraphs or external links in the article', () => {
    const body = '<p><strong>Bekannt aus: <a href="https://de.wikipedia.org/wiki/X" target="_blank" rel="noopener noreferrer">X</a></strong></p><h2>Fazit</h2><p>Ende.</p>';
    expect(extractInternalLink(body).paragraph).toBeNull();
    expect(withInternalLink(body, renderInternalLink(link))).toBe(`${body}\n${renderInternalLink(link)}`);
  });

  it('stays the very last line after FAQs and the conclusion', () => {
    const bodyHtml = withInternalLink('<p>Einleitung.</p><h2>Karriere</h2><p>Text.</p><h2>Fazit</h2><p>Schluss.</p>', renderInternalLink(link));
    const { html } = assembleArticle({
      locale: 'de',
      bodyHtml,
      faqs: [{ question: 'Wer ist Fabian Drews?', answer: 'Der Sohn von Jürgen Drews.' }],
      quickBio: [],
      subjectName: 'Fabian Drews',
    });
    expect(html.trim().endsWith('Trödeltrupp-Star</a></strong></p>')).toBe(true);
    expect(html.indexOf('Häufig gestellte Fragen')).toBeLessThan(html.indexOf('Fazit'));
    expect(html.indexOf('Fazit')).toBeLessThan(html.indexOf(line));

    // Without a detected conclusion it still comes after the FAQs.
    const noConclusion = assembleArticle({
      locale: 'de',
      bodyHtml: withInternalLink('<p>Einleitung.</p><h2>Karriere</h2><p>Text.</p>', renderInternalLink(link)),
      faqs: [{ question: 'Wer ist Fabian Drews?', answer: 'Der Sohn von Jürgen Drews.' }],
      quickBio: [],
      subjectName: 'Fabian Drews',
    }).html;
    expect(noConclusion.indexOf('Häufig gestellte Fragen')).toBeLessThan(noConclusion.indexOf(line));
  });
});

describe('finding the previous article', () => {
  let skipReason: string | null = null;
  let prisma: typeof import('@/lib/db').prisma;
  let svc: typeof import('@/lib/services/internal-links');

  const feedXml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>promizeiten.de</title><link>https://promizeiten.de</link>
    <item><title>Wer ist Ramona Drews? Alles über Jürgen Drews&#8217; Ehefrau</title><link>https://promizeiten.de/ramona-drews/</link><guid isPermaLink="false">https://promizeiten.de/?p=6714</guid></item>
    <item><title>Wer ist Fabian Kahl? Alles über den Trödeltrupp-Star</title><link>https://promizeiten.de/fabian-kahl/</link><guid isPermaLink="false">https://promizeiten.de/?p=6650</guid></item>
    </channel></rss>`;
  const fetchFeed = async () => new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  beforeAll(async () => {
    try {
      execSync('npx prisma migrate deploy', { cwd: root, env: process.env, stdio: 'pipe' });
    } catch (err) {
      skipReason = `database could not be created: ${(err as Error).message.split('\n')[0]}`;
      return;
    }
    ({ prisma } = await import('@/lib/db'));
    svc = await import('@/lib/services/internal-links');
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  });

  it('links each article to the one added before it for the same website', async () => {
    if (skipReason) return console.warn(`Internal link tests skipped: ${skipReason}`);
    const site = await prisma.website.create({ data: { name: 'Promizeiten.de', url: 'https://promizeiten.de', adminUrl: 'https://promizeiten.de/wp-admin/' } });
    const other = await prisma.website.create({ data: { name: 'Peak Buzz', url: 'https://peakbuzz.co.uk', adminUrl: 'https://peakbuzz.co.uk/wp-admin/' } });
    const at = (s: number) => new Date(Date.UTC(2026, 8, 17, 13, 10, s));
    const task = (keyword: string, second: number, extra: Record<string, unknown> = {}) =>
      prisma.articleTask.create({ data: { keyword, language: 'German', websiteId: site.id, status: 'NEEDS_REVIEW', createdAt: at(second), ...extra } });

    const fabian = await task('Fabian Drews', 1, { selectedTitle: 'Wer ist Fabian Drews? Alles über den Sohn von Jürgen Drews', slug: 'fabian-drews', wpPostId: '6715' });
    await task('Abgebrochen', 2, { status: 'CANCELLED', selectedTitle: 'Nicht verwenden' });
    const ramona = await task('Ramona Drews', 3, { selectedTitle: 'Wer ist Ramona Drews?', wpPostId: '6714' });
    await prisma.articleTask.create({ data: { keyword: 'english', websiteId: other.id, status: 'NEEDS_REVIEW', createdAt: at(4), selectedTitle: 'Other site' } });
    const juergen = await task('jürgen drews todesursache', 5);

    // Switched off until the website has a line.
    expect(await svc.resolveInternalLink(ramona, { fetch: fetchFeed })).toMatchObject({ link: null, disabled: true });
    await svc.setInternalLinkLine(site.id, `  ${line} `);
    expect(await svc.getInternalLinkLines()).toEqual({ [site.id]: line });

    // Previous article not published yet → the address its slug will have.
    const toFabian = await svc.resolveInternalLink(ramona, { fetch: async () => new Response('', { status: 404 }) });
    expect(toFabian.link).toEqual({ line, url: 'https://promizeiten.de/fabian-drews/', title: 'Wer ist Fabian Drews? Alles über den Sohn von Jürgen Drews' });

    // Published → the live address and title from the feed; cancelled and other-site articles are ignored.
    const toRamona = await svc.resolveInternalLink(juergen, { fetch: fetchFeed });
    expect(toRamona.link).toEqual({ line, url: 'https://promizeiten.de/ramona-drews/', title: 'Wer ist Ramona Drews? Alles über Jürgen Drews’ Ehefrau' });

    // First article in the app → newest post of the website that is not one of the app's own articles.
    const first = await svc.resolveInternalLink(fabian, { fetch: fetchFeed });
    expect(first.link).toEqual({ line, url: 'https://promizeiten.de/fabian-kahl/', title: 'Wer ist Fabian Kahl? Alles über den Trödeltrupp-Star' });
  });

  it('links an article of a workflow to the one that goes live just before it, whatever order they were added in', async () => {
    if (skipReason) return;
    const site = await prisma.website.create({ data: { name: 'Laraix', url: 'https://laraix.example', adminUrl: 'https://laraix.example/wp-admin/' } });
    await svc.setInternalLinkLine(site.id, 'More From Our Editorial Team:');
    const workflow = await prisma.workflow.create({ data: { websiteId: site.id } });
    const noFeed = async () => new Response('', { status: 404 });
    // Added in this order…
    const added = ['latest tech info', 'tech trends', 'gordon ramsay wife', 'dropped article'];
    const tasks = [];
    for (const [index, keyword] of added.entries()) {
      tasks.push(
        await prisma.articleTask.create({
          data: { keyword, websiteId: site.id, status: 'DRAFT_CREATED', selectedTitle: `Title of ${keyword}`, slug: keyword.replace(/ /g, '-'), createdAt: new Date(1000 + index) },
        }),
      );
    }
    const [latest, trends, gordon, dropped] = tasks;
    // …but they go live in this one: tech trends 24th 4 PM, gordon 24th 6 PM, latest tech info 25th 4 PM.
    const slot = (task: { id: string; keyword: string }, publishAt: string | null, state = 'SCHEDULED') =>
      prisma.workflowKeyword.create({ data: { workflowId: workflow.id, keyword: task.keyword, taskId: task.id, state: state as never, publishAt: publishAt ? new Date(publishAt) : null } });
    await slot(trends, '2026-09-24T11:00:00Z');
    await slot(gordon, '2026-09-24T13:00:00Z');
    await slot(latest, '2026-09-25T11:00:00Z');
    // A failed one in between is not linked to.
    await slot(dropped, '2026-09-24T12:00:00Z', 'FAILED');

    expect((await svc.resolveInternalLink(latest, { fetch: noFeed })).link?.url).toBe('https://laraix.example/gordon-ramsay-wife/');
    expect((await svc.resolveInternalLink(gordon, { fetch: noFeed })).link?.url).toBe('https://laraix.example/tech-trends/');
    // The first one to go live has nothing before it (and the website has no live post yet).
    expect((await svc.resolveInternalLink(trends, { fetch: noFeed })).link).toBeNull();
  });

  it('waits for the previous article to get its title while it is still being written', async () => {
    if (skipReason) return;
    const site = await prisma.website.create({ data: { name: 'Wait', url: 'https://wait.example', adminUrl: 'https://wait.example/wp-admin/' } });
    await svc.setInternalLinkLine(site.id, 'Lesen Sie auch:');
    const previous = await prisma.articleTask.create({ data: { keyword: 'Dexter Keaton', language: 'German', websiteId: site.id, status: 'GENERATING_TITLES', createdAt: new Date(1000) } });
    const current = await prisma.articleTask.create({ data: { keyword: 'Duke Keaton', language: 'German', websiteId: site.id, status: 'SEO_CHECKING', createdAt: new Date(2000) } });

    let waited = '';
    // Prisma queries only run once awaited/then-ed.
    setTimeout(() => prisma.articleTask.update({ where: { id: previous.id }, data: { selectedTitle: 'Wer ist Dexter Keaton?', status: 'RESEARCHING' } }).then(() => undefined), 150);
    const result = await svc.resolveInternalLink(current, { fetch: async () => new Response('', { status: 404 }), waitMs: 5000, pollMs: 50, onWait: (k) => (waited = k) });
    expect(waited).toBe('Dexter Keaton');
    expect(result.link).toEqual({ line: 'Lesen Sie auch:', url: 'https://wait.example/dexter-keaton/', title: 'Wer ist Dexter Keaton?' });
  });
});
