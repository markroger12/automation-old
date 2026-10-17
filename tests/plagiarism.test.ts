// The plagiarism check (test version, 28 September 2026): exact runs, close copies, quotes and template text, and a
// whole check with fake web pages and Wikipedia.
import { describe, expect, it } from 'vitest';
import { checkPlagiarism, guessLanguage, linksIn, type FetchedPage } from '@/content/plagiarism/check';
import { commonPhrases, compareTexts, editSimilarity, prepare } from '@/content/plagiarism/compare';
import { articleText, pageText } from '@/content/plagiarism/text';

const SOURCE =
  'Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley. She raised six children with her husband Edward. The family later moved to Los Angeles so that Jenna could attend auditions more easily.';

describe('comparing an article with a source', () => {
  it('finds a verbatim run of eight or more words and where it is in both texts', () => {
    const article = prepare('Her mother is a nurse. Natalie Ortega worked for many years as an emergency room nurse in the valley. Nothing else.');
    const result = compareTexts(article, prepare(SOURCE));
    const exact = result.spans.filter((s) => s.kind === 'exact');
    expect(exact).toHaveLength(1);
    expect(article.text.slice(article.tokens[exact[0].from].start, article.tokens[exact[0].to - 1].end)).toBe(
      'Natalie Ortega worked for many years as an emergency room nurse in the',
    );
    expect(result.copiedWords).toBe(13);
    expect(result.share).toBeGreaterThan(0.5);
  });

  it('does not count eight everyday words in a row (seen live on Tommy Gooding)', () => {
    const phrase = 'Although it does not have the same level of fame as his brother, he works.';
    const other = 'The new album does well, but it does not have the same level of success as the first.';
    expect(compareTexts(prepare(phrase), prepare(other)).spans).toEqual([]);
  });

  it('does not count a shared phrase shorter than eight words', () => {
    const result = compareTexts(prepare('She moved to Los Angeles so that she could study.'), prepare(SOURCE));
    expect(result.spans.filter((s) => s.kind === 'exact')).toEqual([]);
  });

  it('finds a lightly edited sentence as a close copy', () => {
    const article = prepare('She raised six children together with her husband Edward Ortega.');
    const result = compareTexts(article, prepare(SOURCE));
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ kind: 'near', quoted: false });
    expect(result.spans[0].similarity).toBeGreaterThanOrEqual(0.8);
    expect(editSimilarity(['a', 'b', 'c'], ['a', 'x', 'c'])).toBeCloseTo(0.667, 2);
  });

  it('shows but does not count a quotation or the user’s own template text', () => {
    const quoted = compareTexts(prepare('As one report put it, "Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley."'), prepare(SOURCE));
    expect(quoted.spans[0].quoted).toBe(true);
    expect(quoted.copiedWords).toBe(0);

    const template = 'Stay tuned for more updates on the life and career of this star.';
    const own = [1, 2, 3, 4, 5].map((n) => prepare(`Article ${n} is about someone else entirely. ${template}`));
    const common = commonPhrases(own, 0.1, 4);
    const result = compareTexts(prepare(`A new article. ${template}`), own[0], { common });
    expect(result.spans[0].boilerplate).toBe(true);
    expect(result.copiedWords).toBe(0);
  });
});

describe('reading texts', () => {
  it('takes an article’s prose without headings, tables or the internal link line', () => {
    const html = '<h2>Early Life</h2><p>First paragraph.</p><table><tr><td>Born</td></tr></table><ul><li>A list item.</li></ul><p><strong>Also read: <a href="https://site.test/x/">Other</a></strong></p>';
    expect(articleText(html)).toBe('First paragraph.\nA list item.');
  });

  it('takes a page’s main text without its menu and footer', () => {
    const body = 'This is the story of a nurse from California who raised six children. '.repeat(20);
    const page = pageText(`<html><head><title>Bio</title></head><body><nav><a>Home</a> Menu words here</nav><article><p>${body}</p></article><footer>Copyright footer text here</footer></body></html>`);
    expect(page.title).toBe('Bio');
    expect(page.text).toContain('raised six children');
    expect(page.text).not.toContain('Menu words');
    expect(page.text).not.toContain('footer');
  });

  it('lists the article’s links and guesses its language', () => {
    expect(linksIn('<p><a href="https://a.test/x">A</a> <a href="https://a.test/x">again</a> <a href="/local">no</a> <a href="https://b.test/y?a=1&amp;b=2">B</a></p>')).toEqual([
      'https://a.test/x',
      'https://b.test/y?a=1&b=2',
    ]);
    expect(guessLanguage('Die Schauspielerin ist mit dem Sänger verheiratet und lebt in Berlin.')).toBe('de');
    expect(guessLanguage('The actress is married to the singer and lives in Berlin.')).toBe('en');
  });
});

describe('a whole check', () => {
  const article = [
    '<p>Jenna Ortega’s mother is Natalie Ortega. Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley, according to <a href="https://news.test/story">one report</a>.</p>',
    '<p>She raised six children together with her husband Edward Ortega. The family stayed close.</p>',
    '<p>Jenna has spoken warmly about her mother in many interviews over the years, praising her patience and humour.</p>',
    '<p><strong>Also read: <a href="https://mysite.test/previous/">The Previous Article</a></strong></p>',
  ].join('');

  it('compares the own articles, the linked page and Wikipedia, and reports what matched where', async () => {
    const fetched: string[] = [];
    const searched: Array<[string, boolean]> = [];
    const report = await checkPlagiarism({
      input: article,
      keyword: 'Jenna Ortega mother',
      ownArticles: [
        { id: 't1', title: 'Old copy on another site', html: `<p>${'Filler sentence about a different person entirely. '.repeat(8)}Jenna has spoken warmly about her mother in many interviews over the years, praising her patience and humour.</p>` },
        { id: 't2', title: 'Unrelated', html: `<p>${'A completely different article about software and computers. '.repeat(10)}</p>` },
      ],
      ownHosts: ['mysite.test'],
      fetchPage: async (url): Promise<FetchedPage> => {
        fetched.push(url);
        return { title: 'News story', text: SOURCE, url };
      },
      searchWikipedia: async (query, _language, exact) => {
        searched.push([query, exact]);
        return exact ? [] : ['Jenna Ortega'];
      },
      wikipediaPage: async (title) => ({ title: `Wikipedia: ${title}`, text: 'Jenna Marie Ortega is an American actress. She began her career as a child actress. '.repeat(5), url: 'https://en.wikipedia.org/wiki/Jenna_Ortega' }),
    });

    // The user's own site is compared from the database, never fetched.
    expect(fetched).toEqual(['https://news.test/story']);
    expect(searched[0]).toEqual(['Jenna Ortega mother', false]);
    expect(searched.slice(1).every(([, exact]) => exact)).toBe(true);

    const bySource = Object.fromEntries(report.sources.map((s) => [s.id, s]));
    expect(bySource['link:https://news.test/story']).toMatchObject({ status: 'checked', exactPassages: 1, nearPassages: 1 });
    expect(bySource['own:t1']).toMatchObject({ kind: 'own', exactPassages: 1 });
    expect(bySource['own:t2']).toBeUndefined();
    expect(bySource['wikipedia:Jenna Ortega']).toMatchObject({ status: 'checked', share: 0 });
    expect(report.sources[0].share).toBeGreaterThanOrEqual(report.sources[1].share);
    expect(report.matchedShare).toBeGreaterThan(0.4);
    expect(report.highlights.some((h) => h.kind === 'near')).toBe(true);
    expect(report.text).not.toContain('Also read');
  });

  it('searches distinctive phrases on Google, opens the pages most phrases led to and skips the own site and videos', async () => {
    const copied = 'Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley';
    const input = [
      `<p>${copied}, according to people who knew the family well and remember those difficult early years together.</p>`,
      '<p>Jenna Ortega was born on September 27, 2002, in the city of Coachella, California, to her parents Natalie and Edward.</p>',
      '<p>Their household remained remarkably grounded despite growing attention, emphasising education, discipline and humility.</p>',
    ].join('');
    const searched: string[] = [];
    const opened: string[] = [];
    const report = await checkPlagiarism({
      input,
      ownArticles: [],
      ownHosts: ['mysite.test'],
      maxWebSearches: 3,
      searchWeb: async (phrase) => {
        searched.push(phrase);
        return [
          { url: 'https://mysite.test/jenna-ortega-mother/', title: 'Our own post', snippet: '' },
          { url: 'https://copier.test/bio', title: 'Copier', snippet: `… ${copied} …` },
          { url: 'https://www.youtube.com/watch?v=1', title: 'Video', snippet: '' },
          ...(searched.length === 1 ? [{ url: 'https://other.test/page', title: 'Other', snippet: '' }] : []),
        ];
      },
      fetchPage: async (url) => {
        opened.push(url);
        if (url.includes('other.test')) throw new Error('HTTP 403');
        return { title: 'Copier bio', text: `${SOURCE} ${'Unrelated filler words about something else entirely. '.repeat(5)}`, url };
      },
    });

    // Sentences with dates are facts written the usual way: they are not searched.
    expect(searched).toHaveLength(2);
    expect(searched.join(' ')).not.toMatch(/2002|September/);
    expect(report.google).toMatchObject({ searches: 2, pagesFound: 3 });
    expect(opened).toEqual(['https://copier.test/bio', 'https://other.test/page']);
    const copier = report.sources.find((s) => s.url === 'https://copier.test/bio')!;
    expect(copier).toMatchObject({ kind: 'google', status: 'checked', googleHits: 2, exactPassages: 1 });
    expect(report.sources.find((s) => s.url === 'https://other.test/page')).toMatchObject({ status: 'failed', googleHits: 1, error: 'HTTP 403' });
    expect(report.notes.join(' ')).toMatch(/copied your article after it was published/);
  });

  it('reports a page that could not be read instead of failing the check', async () => {
    const report = await checkPlagiarism({
      input: article,
      ownArticles: [],
      urls: ['https://blocked.test/page'],
      ownHosts: ['mysite.test'],
      fetchPage: async (url) => {
        if (url.includes('blocked')) throw new Error('HTTP 403');
        return { title: 'News story', text: SOURCE, url };
      },
    });
    expect(report.sources.find((s) => s.url === 'https://blocked.test/page')).toMatchObject({ status: 'failed', error: 'HTTP 403' });
    expect(report.sources[report.sources.length - 1].status).toBe('failed');
  });
});
