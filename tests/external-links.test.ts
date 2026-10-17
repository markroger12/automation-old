import { describe, expect, it } from 'vitest';
import { siteNamedAfter, verifyLink } from '@/automation/links/verify-link';
import { cleanLinkUrl, insertExternalLinks, parseLinkSuggestions } from '@/content/external-links';

describe('parseLinkSuggestions', () => {
  it('reads the LINK lines in the formats ChatGPT uses', () => {
    const text = [
      'Here are the links:',
      'LINK: Diane Keaton | https://en.wikipedia.org/wiki/Diane_Keaton',
      '- **LINK:** Annie Hall | [imdb.com](https://www.imdb.com/title/tt0075686/?utm_source=chatgpt.com)',
      '2. LINK: [University of California](https://en.wikipedia.org/wiki/University_of_California).',
      'LINK: „Jürgen Drews“ | <https://de.wikipedia.org/wiki/J%C3%BCrgen_Drews>',
      'LINK: no url here',
      'LINK: Diane Keaton | https://en.wikipedia.org/wiki/Diane_Keaton',
    ].join('\n');
    expect(parseLinkSuggestions(text)).toEqual([
      { phrase: 'Diane Keaton', url: 'https://en.wikipedia.org/wiki/Diane_Keaton' },
      { phrase: 'Annie Hall', url: 'https://www.imdb.com/title/tt0075686/' },
      { phrase: 'University of California', url: 'https://en.wikipedia.org/wiki/University_of_California' },
      { phrase: 'Jürgen Drews', url: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Drews' },
    ]);
    expect(cleanLinkUrl('javascript:alert(1)')).toBeNull();
    // Found in the live test: a closing bracket that belongs to the URL must stay.
    expect(cleanLinkUrl("https://en.wikipedia.org/wiki/The_Handmaid%27s_Tale_(TV_series)")).toBe("https://en.wikipedia.org/wiki/The_Handmaid%27s_Tale_(TV_series)");
    expect(cleanLinkUrl('(https://en.wikipedia.org/wiki/Diane_Keaton).')).toBeNull();
    expect(cleanLinkUrl('https://en.wikipedia.org/wiki/Diane_Keaton).')).toBe('https://en.wikipedia.org/wiki/Diane_Keaton');
  });
});

describe('insertExternalLinks', () => {
  const html =
    '<h2>Diane Keaton and her family</h2><p>Her mother <strong>Diane Keaton</strong> starred in Annie Hall.</p><p>diane keaton later moved to Los Angeles. See <a href="https://example.com">Los Angeles</a>.</p><p>Die Jürgen Drewsband spielte mit Jürgen Drews.</p>';

  it('links the first occurrence in paragraphs, never headings, existing links or parts of longer words', () => {
    const { html: out, inserted } = insertExternalLinks(
      html,
      [
        { phrase: 'Diane Keaton', url: 'https://en.wikipedia.org/wiki/Diane_Keaton' },
        { phrase: 'Annie Hall', url: 'https://www.imdb.com/title/tt0075686/' },
        { phrase: 'Jürgen Drews', url: 'https://de.wikipedia.org/wiki/J%C3%BCrgen_Drews' },
        { phrase: 'Not In Text', url: 'https://en.wikipedia.org/wiki/Nothing' },
      ],
      5,
    );
    expect(inserted.map((l) => l.anchor)).toEqual(['Diane Keaton', 'Annie Hall', 'Jürgen Drews']);
    expect(out).toContain('<h2>Diane Keaton and her family</h2>');
    expect(out).toContain('<strong><a href="https://en.wikipedia.org/wiki/Diane_Keaton" target="_blank" rel="noopener noreferrer">Diane Keaton</a></strong>');
    expect(out).toContain('Jürgen Drewsband spielte mit <a href="https://de.wikipedia.org/wiki/J%C3%BCrgen_Drews"');
    expect(out.match(/<a /g)).toHaveLength(4); // 3 new + the existing one
  });

  it('respects the maximum number of links', () => {
    const { inserted } = insertExternalLinks(
      html,
      [
        { phrase: 'Diane Keaton', url: 'https://en.wikipedia.org/wiki/Diane_Keaton' },
        { phrase: 'Annie Hall', url: 'https://www.imdb.com/title/tt0075686/' },
      ],
      1,
    );
    expect(inserted).toHaveLength(1);
  });
});

describe('spreading the links (asked for on 2026-09-26)', () => {
  const article =
    '<p>Justin Biel is the brother of Jessica Biel, married to Justin Timberlake, and starred in 7th Heaven.</p>' +
    '<p>He studied at Fairfield University. Later he worked with Jessica Biel again.</p>' +
    '<p>He supports Children’s Hospital Los Angeles.</p>';

  it('puts at most two external links in one paragraph, using a later mention when the first paragraph is full', () => {
    const { html, inserted, skipped } = insertExternalLinks(article, [
      { phrase: 'Justin Timberlake', url: 'https://en.wikipedia.org/wiki/Justin_Timberlake' },
      { phrase: '7th Heaven', url: 'https://www.imdb.com/title/tt0115083/' },
      { phrase: 'Jessica Biel', url: 'https://www.imdb.com/name/nm0001949/' },
    ], 5);
    expect(inserted.map((l) => l.anchor)).toEqual(['Justin Timberlake', '7th Heaven', 'Jessica Biel']);
    const paragraphs = html.split('</p>').map((p) => (p.match(/<a /g) ?? []).length);
    expect(paragraphs.slice(0, 3)).toEqual([2, 1, 0]);
    expect(skipped).toEqual([]);
  });

  it('says so when every paragraph with the words is full', () => {
    const { inserted, skipped } = insertExternalLinks(article, [
      { phrase: 'Justin Timberlake', url: 'https://en.wikipedia.org/wiki/Justin_Timberlake' },
      { phrase: '7th Heaven', url: 'https://www.imdb.com/title/tt0115083/' },
      { phrase: 'Justin Biel', url: 'https://example.org/justin' },
    ], 5);
    expect(inserted).toHaveLength(2);
    expect(skipped).toEqual([{ link: { phrase: 'Justin Biel', url: 'https://example.org/justin' }, reason: 'every paragraph with these words already has 2 links' }]);
  });

  it('keeps Wikipedia to its share, finds the words whatever the apostrophe, and names the real reason', () => {
    const { inserted, skipped } = insertExternalLinks(article, [
      { phrase: "Children's Hospital Los Angeles", url: 'https://www.chla.org/' },
      { phrase: 'Justin Timberlake', url: 'https://en.wikipedia.org/wiki/Justin_Timberlake' },
      { phrase: 'Jessica Biel', url: 'https://en.wikipedia.org/wiki/Jessica_Biel' },
      { phrase: 'Fairfield University', url: 'https://www.fairfield.edu/' },
    ], 3, { wikipediaMax: 1 });
    expect(inserted.map((l) => l.anchor)).toEqual(['Children’s Hospital Los Angeles', 'Justin Timberlake', 'Fairfield University']);
    expect(skipped.map((s) => s.reason)).toEqual(['at most 1 Wikipedia links per article, so the links are not Wikipedia only']);
    const full = insertExternalLinks(article, [
      { phrase: 'Fairfield University', url: 'https://www.fairfield.edu/' },
      { phrase: '7th Heaven', url: 'https://www.imdb.com/title/tt0115083/' },
    ], 1);
    expect(full.skipped.map((s) => s.reason)).toEqual(['the article already has the most external links allowed (1)']);
  });
});

describe('verifyLink (no real network)', () => {
  const page = (status: number, html = '', url = '') => {
    const res = new Response(html, { status });
    if (url) Object.defineProperty(res, 'url', { value: url });
    return Promise.resolve(res);
  };
  const fakeFetch = (routes: Record<string, () => Promise<Response>>) => async (url: string) => {
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return route ? route[1]() : page(404);
  };

  it('accepts a real Wikipedia page about the words and rejects missing, unrelated and disambiguation pages', async () => {
    const fetch = fakeFetch({
      'https://en.wikipedia.org/wiki/Diane_Keaton': () => page(200, '<title>Diane Keaton - Wikipedia</title><div class="hatnote mw-disambig">x</div>'),
      'https://en.wikipedia.org/wiki/Keaton': () => page(200, '<title>Keaton - Wikipedia</title><div id="disambigbox"></div>'),
      'https://en.wikipedia.org/wiki/The_Godfather': () => page(200, '<title>The Godfather - Wikipedia</title>'),
    });
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://en.wikipedia.org/wiki/Diane_Keaton' }, { fetch })).ok).toBe(true);
    expect(await verifyLink({ phrase: 'Keaton', url: 'https://en.wikipedia.org/wiki/Keaton' }, { fetch })).toMatchObject({ ok: false, reason: 'Wikipedia disambiguation page' });
    expect((await verifyLink({ phrase: 'Annie Hall', url: 'https://en.wikipedia.org/wiki/The_Godfather' }, { fetch })).reason).toMatch(/about something else/);
    expect((await verifyLink({ phrase: 'Nobody', url: 'https://en.wikipedia.org/wiki/Nobody_Here' }, { fetch })).reason).toMatch(/does not exist/);
  });

  it('confirms IMDb ids through Wikidata', async () => {
    const fetch = fakeFetch({
      'https://en.wikipedia.org/wiki/Special:Search': () =>
        page(200, '<title>Diane Keaton - Wikipedia</title><script>"wgWikibaseItemId":"Q104027"</script>', 'https://en.wikipedia.org/wiki/Diane_Keaton'),
      'https://www.wikidata.org/wiki/Special:EntityData/Q104027.json': () =>
        page(200, JSON.stringify({ entities: { Q104027: { claims: { P345: [{ mainsnak: { datavalue: { value: 'nm0000473' } } }] } } } })),
    });
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://www.imdb.com/name/nm0000473/' }, { fetch })).ok).toBe(true);
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://www.imdb.com/name/nm0000138/' }, { fetch })).ok).toBe(false);
  });

  it('accepts a German Wikipedia article whose title is the German name of the film', async () => {
    const fetch = fakeFetch({
      'https://de.wikipedia.org/wiki/Der_Stadtneurotiker': () =>
        page(200, '<title>Der Stadtneurotiker – Wikipedia</title><script>"wgWikibaseItemId":"Q233464"</script>'),
      'https://www.wikidata.org/wiki/Special:EntityData/Q233464.json': () =>
        page(200, JSON.stringify({ entities: { Q233464: { labels: { de: { value: 'Der Stadtneurotiker' }, en: { value: 'Annie Hall' } } } } })),
    });
    const check = await verifyLink({ phrase: 'Annie Hall', url: 'https://de.wikipedia.org/wiki/Der_Stadtneurotiker' }, { fetch, language: 'German' });
    expect(check.ok).toBe(true);
    expect(check.reason).toContain('also known as "Annie Hall"');
  });

  it('accepts an official website that Wikidata lists for the phrase, even with an unrelated page title', async () => {
    const fetch = fakeFetch({
      'https://en.wikipedia.org/wiki/Special:Search': () =>
        page(200, '<title>University of East Anglia - Wikipedia</title><script>"wgWikibaseItemId":"Q1045828"</script>', 'https://en.wikipedia.org/wiki/University_of_East_Anglia'),
      'https://www.wikidata.org/wiki/Special:EntityData/Q1045828.json': () =>
        page(200, JSON.stringify({ entities: { Q1045828: { claims: { P856: [{ mainsnak: { datavalue: { value: 'https://www.uea.ac.uk/' } } }] } } } })),
      'https://www.uea.ac.uk/': () => page(200, '<title>Find your place at UEA</title>'),
    });
    expect((await verifyLink({ phrase: 'University of East Anglia', url: 'https://www.uea.ac.uk/' }, { fetch })).ok).toBe(true);
    expect((await verifyLink({ phrase: 'University of East Anglia', url: 'https://www.some-other-uni.ac.uk/' }, { fetch })).ok).toBe(false);
  });

  it('accepts the own website of an organisation too small for Wikipedia when the site and the page are named after it', async () => {
    // Seen live (justin biel): both were refused as "not on the list of trusted sites".
    expect(siteNamedAfter('www.globaldownsyndrome.org', 'Global Down Syndrome Foundation')).toBe(true);
    expect(siteNamedAfter('www.chla.org', 'Children’s Hospital Los Angeles')).toBe(true);
    expect(siteNamedAfter('www.lmu.edu', 'Loyola Marymount University')).toBe(true);
    expect(siteNamedAfter('www.bbc.co.uk', 'British Broadcasting Corporation')).toBe(true);
    expect(siteNamedAfter('celebnews.com', 'Global Down Syndrome Foundation')).toBe(false);
    expect(siteNamedAfter('www.gds.org', 'Global Down Syndrome Foundation')).toBe(false);
    const fetch = fakeFetch({
      'https://www.globaldownsyndrome.org/': () => page(200, '<title>Global Down Syndrome Foundation | Home</title>'),
      'https://www.chla.org/': () => page(200, '<title>Just a moment...</title>'),
    });
    const ok = await verifyLink({ phrase: 'Global Down Syndrome Foundation', url: 'https://www.globaldownsyndrome.org/' }, { fetch });
    expect(ok).toMatchObject({ ok: true, reason: expect.stringMatching(/^Official website of Global Down Syndrome Foundation \(the site is named after it\)/) });
    expect((await verifyLink({ phrase: 'Children’s Hospital Los Angeles', url: 'https://www.chla.org/' }, { fetch })).reason).toBe('chla.org blocks the check');
  });

  it('only opens trusted sites and never links gossip or social media', async () => {
    const fetch = fakeFetch({ 'https://www.harvard.edu/': () => page(200, '<title>Harvard University</title>') });
    expect((await verifyLink({ phrase: 'Harvard University', url: 'https://www.harvard.edu/' }, { fetch })).ok).toBe(true);
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://www.instagram.com/diane/' }, { fetch })).ok).toBe(false);
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://www.celebritynetworth.com/x' }, { fetch })).ok).toBe(false);
    expect((await verifyLink({ phrase: 'Diane Keaton', url: 'https://some-random-blog.net/diane' }, { fetch })).reason).toMatch(/not on the list/);
  });
});
