// The plagiarism check (test version, 28 September 2026, from the user's research doc): the article is compared with
// the user's own articles, the pages it links to, Wikipedia, any pages the user adds and — with a serper.dev key — the
// pages Google shows for its most distinctive phrases. Fetching and searching are passed in, so tests need no internet.
import { commonPhrases, compareTexts, prepare, type MatchSpan, type PreparedText } from './compare';
import { articleText, quotedRanges } from './text';

export type SourceKind = 'own' | 'link' | 'wikipedia' | 'url' | 'google';

/** One Google result for a searched phrase. */
export interface WebHit {
  url: string;
  title: string;
  snippet: string;
}

export interface OwnArticle {
  id: string;
  title: string;
  html: string;
  url?: string | null;
}

export interface FetchedPage {
  title: string;
  text: string;
  url: string;
}

export interface Passage {
  kind: MatchSpan['kind'];
  similarity: number;
  quoted: boolean;
  boilerplate: boolean;
  words: number;
  /** Character range in the article text. */
  start: number;
  end: number;
  articleText: string;
  sourceText: string;
}

export interface SourceResult {
  id: string;
  kind: SourceKind;
  title: string;
  url: string | null;
  status: 'checked' | 'failed';
  error?: string;
  words: number;
  /** Share of the article's words this source accounts for (counted matches only). */
  share: number;
  containment: number;
  exactPassages: number;
  nearPassages: number;
  passages: Passage[];
  /** How many of the phrases searched on Google showed this page. */
  googleHits?: number;
  /** Google's snippet for the page (evidence even when the page itself could not be read). */
  snippet?: string | null;
}

export interface PlagiarismReport {
  text: string;
  words: number;
  /** Article words matched by any source (counted matches only). */
  matchedWords: number;
  matchedShare: number;
  quotedWords: number;
  boilerplateWords: number;
  /** Character ranges of counted matches in the article text, for highlighting. */
  highlights: Array<{ start: number; end: number; kind: MatchSpan['kind'] }>;
  /** Sources that shared a passage, and every web page tried (also those that could not be read). */
  sources: SourceResult[];
  /** How many of the user's own articles were compared (those without a shared passage are not listed). */
  ownCompared: number;
  /** The Google part: phrases searched (one Serper credit each) and pages Google showed for them. */
  google: { searches: number; pagesFound: number; phrases: string[] } | null;
  language: 'en' | 'de';
  durationMs: number;
  notes: string[];
}

export interface CheckOptions {
  /** The article as HTML or plain text. */
  input: string;
  keyword?: string;
  language?: 'en' | 'de';
  ownArticles: OwnArticle[];
  /** Pages the user wants compared as well (competitors…). */
  urls?: string[];
  /** Links to these hosts are the user's own site: not fetched (their articles are compared from the database). */
  ownHosts?: string[];
  fetchPage: (url: string) => Promise<FetchedPage>;
  /** Wikipedia titles for a search; `exact` searches the words as one phrase. */
  searchWikipedia?: (query: string, language: 'en' | 'de', exact: boolean) => Promise<string[]>;
  wikipediaPage?: (title: string, language: 'en' | 'de') => Promise<FetchedPage>;
  /** Google results for one exact phrase (serper.dev); without it Google is not searched. */
  searchWeb?: (phrase: string, language: 'en' | 'de') => Promise<WebHit[]>;
  /** Phrases searched on Google, one credit each. */
  maxWebSearches?: number;
  now?: () => number;
}

const MAX_LINKS = 10;
const MAX_URLS = 10;
const MAX_PHRASE_SEARCHES = 5;
const MAX_WIKI_PAGES = 6;
export const MAX_WEB_SEARCHES = 10;
/** Pages found on Google that are opened and compared in full (the ones most phrases led to first). */
const MAX_WEB_PAGES = 12;
/** Video and social pages: Google shows them, but they hold no article text worth opening. */
const NO_TEXT_HOSTS = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|pinterest\.[a-z.]+|x\.com|twitter\.com|threads\.net)$/;

export function guessLanguage(text: string): 'en' | 'de' {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let de = 0;
  let en = 0;
  for (const word of words) {
    if (/^(der|die|das|und|ist|nicht|mit|von|sich|auch|wurde|sein|eine|einem|einer)$/.test(word)) de++;
    else if (/^(the|and|is|of|with|was|his|her|this|that|from|has|were)$/.test(word)) en++;
  }
  return de > en ? 'de' : 'en';
}

export function linksIn(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<a\s[^>]*href=["'](https?:\/\/[^"'#\s]+)["']/gi)) {
    const url = match[1].replace(/&amp;/g, '&');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Sentences with many rare words: the best phrases to look for elsewhere, spread over the whole article. With
 * `noFacts`, sentences holding numbers are left out: "Jan Josef Liefers wurde am 8. August 1964 in Dresden geboren"
 * stands word for word on ten sites (seen on Google, 28 September 2026) — a fact written the usual way, not a copy.
 */
export function distinctivePhrases(article: PreparedText, limit: number, options: { words?: number; noFacts?: boolean } = {}): string[] {
  const size = options.words ?? 8;
  const scored = article.sentences
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.to - s.from >= 12)
    .filter(({ s }) => !options.noFacts || !article.tokens.slice(s.from, s.to).some((t) => /\d/.test(t.word)))
    .map(({ s, index }) => {
      const words = article.tokens.slice(s.from, s.to).map((t) => t.word);
      return { s, index, rare: words.filter((w) => w.length >= 6).length / words.length };
    })
    .sort((a, b) => b.rare - a.rare);
  // The best sentence of each part of the article, so one section cannot take every search.
  const picked: typeof scored = [];
  const parts = Math.max(1, limit);
  const perPart = Math.ceil(article.sentences.length / parts);
  for (let part = 0; part < parts && picked.length < limit; part++) {
    const best = scored.find((x) => Math.floor(x.index / perPart) === part && !picked.includes(x));
    if (best) picked.push(best);
  }
  for (const x of scored) if (picked.length < limit && !picked.includes(x)) picked.push(x);
  picked.sort((a, b) => a.index - b.index);
  // The middle words of each: long enough to be specific, short enough to survive small edits.
  // Cut from the article itself, so "Cuba Jr.'s" stays as written instead of becoming "Cuba Jr s".
  return picked.map(({ s }) => {
    const mid = Math.max(s.from, Math.floor((s.from + s.to) / 2) - Math.floor(size / 2));
    const end = Math.min(s.to, mid + size);
    return article.text.slice(article.tokens[mid].start, article.tokens[end - 1].end).replace(/\s+/g, ' ');
  });
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

function passageOf(article: PreparedText, source: PreparedText, span: MatchSpan): Passage {
  const start = article.tokens[span.from].start;
  const end = article.tokens[span.to - 1].end;
  return {
    kind: span.kind,
    similarity: span.similarity,
    quoted: span.quoted,
    boilerplate: span.boilerplate,
    words: span.to - span.from,
    start,
    end,
    articleText: article.text.slice(start, end),
    sourceText: source.text.slice(source.tokens[span.sourceFrom].start, source.tokens[span.sourceTo - 1].end),
  };
}

export async function checkPlagiarism(options: CheckOptions): Promise<PlagiarismReport> {
  const now = options.now ?? Date.now;
  const started = now();
  const notes: string[] = [];
  const text = articleText(options.input);
  const article = prepare(text);
  const language = options.language ?? guessLanguage(text);
  const quoted = quotedRanges(article.text, article.tokens);

  // The user's own articles, and the phrases their template repeats (never counted as copying).
  const own = options.ownArticles.map((a) => ({ ...a, prepared: prepare(articleText(a.html)) })).filter((a) => a.prepared.tokens.length >= 50);
  const common = commonPhrases(own.map((a) => a.prepared));

  // Web sources: the article's links, the user's pages and Wikipedia.
  const ownHosts = new Set((options.ownHosts ?? []).map((h) => h.replace(/^www\./, '').toLowerCase()));
  const wanted: Array<{ kind: SourceKind; url: string }> = [];
  const add = (kind: SourceKind, url: string) => {
    if (!wanted.some((w) => w.url === url)) wanted.push({ kind, url });
  };
  for (const url of (options.urls ?? []).slice(0, MAX_URLS)) add('url', url);
  const links = linksIn(options.input).filter((url) => !ownHosts.has(hostOf(url)));
  if (links.length > MAX_LINKS) notes.push(`Only the first ${MAX_LINKS} of the article's ${links.length} links were compared.`);
  for (const url of links.slice(0, MAX_LINKS)) add('link', url);

  const wikiTitles: string[] = [];
  if (options.searchWikipedia && options.wikipediaPage) {
    const search = options.searchWikipedia;
    const linkedTitles = new Set(
      links.filter((u) => /wikipedia\.org\/wiki\//.test(u)).map((u) => decodeURIComponent(u.split('/wiki/')[1] ?? '').replace(/_/g, ' ').toLowerCase()),
    );
    // With Google searched, Wikipedia's own phrase search adds nothing (Google shows Wikipedia pages too).
    const phrases = options.searchWeb ? [] : distinctivePhrases(article, MAX_PHRASE_SEARCHES);
    const found = await Promise.all([
      options.keyword ? search(options.keyword, language, false).then((t) => t.slice(0, 1)).catch(() => []) : Promise.resolve([] as string[]),
      ...phrases.map((phrase) => search(phrase, language, true).then((t) => t.slice(0, 2)).catch(() => [] as string[])),
    ]);
    for (const title of found.flat()) {
      if (!wikiTitles.includes(title) && !linkedTitles.has(title.toLowerCase())) wikiTitles.push(title);
    }
  }

  // Google: the most distinctive phrases, each searched word for word; a page that several phrases lead to is where
  // copying is most likely.
  let google: PlagiarismReport['google'] = null;
  const googlePages = new Map<string, { title: string; snippet: string; hits: number; best: number }>();
  if (options.searchWeb) {
    const searchWeb = options.searchWeb;
    const webPhrases = distinctivePhrases(article, options.maxWebSearches ?? MAX_WEB_SEARCHES, { words: 10, noFacts: true });
    const answers = await Promise.all(webPhrases.map((phrase) => searchWeb(phrase, language).catch((err: Error) => err)));
    const failures = answers.filter((a): a is Error => a instanceof Error);
    if (failures.length) notes.push(`${failures.length} of ${webPhrases.length} Google searches failed: ${failures[0].message}`);
    answers.forEach((hits) => {
      if (hits instanceof Error) return;
      hits.forEach((hit, position) => {
        if (ownHosts.has(hostOf(hit.url))) return;
        const page = googlePages.get(hit.url);
        if (page) {
          page.hits++;
          page.best = Math.min(page.best, position);
        } else {
          googlePages.set(hit.url, { title: hit.title, snippet: hit.snippet, hits: 1, best: position });
        }
      });
    });
    google = { searches: webPhrases.length - failures.length, pagesFound: googlePages.size, phrases: webPhrases };
    const ranked = [...googlePages.entries()].sort((a, b) => b[1].hits - a[1].hits || a[1].best - b[1].best);
    const openable = ranked.filter(([url]) => !NO_TEXT_HOSTS.test(hostOf(url)) && !wanted.some((w) => w.url === url));
    for (const [url] of openable.slice(0, MAX_WEB_PAGES)) add('google', url);
    const left = openable.length - Math.min(openable.length, MAX_WEB_PAGES);
    if (left > 0) notes.push(`Google showed ${left} more page(s) for the searched phrases; the ${MAX_WEB_PAGES} that most phrases led to were opened.`);
  }

  const fetched = await inBatches(
    [
      ...wanted.map((w) => ({ ...w, title: null as string | null })),
      ...wikiTitles.slice(0, MAX_WIKI_PAGES).map((title) => ({ kind: 'wikipedia' as SourceKind, url: '', title })),
    ],
    4,
    async (item) => {
      try {
        const page = item.title ? await options.wikipediaPage!(item.title, language) : await options.fetchPage(item.url);
        return { ...item, page, error: null as string | null };
      } catch (err) {
        return { ...item, page: null, error: (err as Error).message };
      }
    },
  );

  const results: SourceResult[] = [];
  const counted = new Uint8Array(article.tokens.length);
  const quotedAt = new Uint8Array(article.tokens.length);
  const boilerplateAt = new Uint8Array(article.tokens.length);
  const kindAt = new Map<number, MatchSpan['kind']>();

  let ownCompared = 0;
  const record = (base: Omit<SourceResult, 'share' | 'containment' | 'exactPassages' | 'nearPassages' | 'passages' | 'words' | 'status'>, source: PreparedText) => {
    const comparison = compareTexts(article, source, { common, quoted });
    // An own article that shares no passage is only counted, not listed.
    if (base.kind === 'own' && !comparison.spans.length) return;
    for (const span of comparison.spans) {
      if (span.quoted) quotedAt.fill(1, span.from, span.to);
      else if (span.boilerplate) boilerplateAt.fill(1, span.from, span.to);
      else
        for (let i = span.from; i < span.to; i++) {
          counted[i] = 1;
          if (kindAt.get(i) !== 'exact') kindAt.set(i, span.kind);
        }
    }
    results.push({
      ...base,
      status: 'checked',
      words: source.tokens.length,
      share: comparison.share,
      containment: comparison.containment,
      exactPassages: comparison.spans.filter((s) => s.kind === 'exact' && !s.quoted && !s.boilerplate).length,
      nearPassages: comparison.spans.filter((s) => s.kind === 'near' && !s.quoted).length,
      passages: comparison.spans.map((span) => passageOf(article, source, span)),
    });
  };

  for (const item of own) {
    // Cheap first: only an article sharing an uncommon 5-word phrase is compared in full.
    let shares = false;
    for (const key of article.grams.keys()) {
      if (item.prepared.grams.has(key) && !common.has(key)) {
        shares = true;
        break;
      }
    }
    ownCompared++;
    if (shares) record({ id: `own:${item.id}`, kind: 'own', title: item.title, url: item.url ?? null }, item.prepared);
  }
  for (const item of fetched) {
    const id = `${item.kind}:${item.title ?? item.url}`;
    const onGoogle = item.url ? googlePages.get(item.url) : undefined;
    const fromGoogle = onGoogle ? { googleHits: onGoogle.hits, snippet: onGoogle.snippet } : {};
    const fallbackTitle = item.title ?? (onGoogle?.title || hostOf(item.url));
    if (!item.page) {
      results.push({ id, kind: item.kind, title: fallbackTitle, url: item.url || null, status: 'failed', error: item.error ?? 'no text', words: 0, share: 0, containment: 0, exactPassages: 0, nearPassages: 0, passages: [], ...fromGoogle });
      continue;
    }
    const prepared = prepare(item.page.text);
    if (prepared.tokens.length < 30) {
      results.push({ id, kind: item.kind, title: item.page.title || fallbackTitle, url: item.page.url || item.url || null, status: 'failed', error: 'the page had almost no readable text', words: prepared.tokens.length, share: 0, containment: 0, exactPassages: 0, nearPassages: 0, passages: [], ...fromGoogle });
      continue;
    }
    record({ id, kind: item.kind, title: item.page.title || fallbackTitle, url: item.page.url || item.url || null, ...fromGoogle }, prepared);
  }

  results.sort((a, b) => (a.status === b.status ? b.share - a.share : a.status === 'checked' ? -1 : 1));
  const same = results.find((r) => r.kind === 'own' && r.share >= 0.9);
  if (same) notes.push(`"${same.title}" matches ${Math.round(same.share * 100)}% — it may be this same article or a copy of it.`);
  if (language === 'de') notes.push(`German text: ${google ? 'Google and ' : ''}Wikipedia were searched in German.`);
  if (google && results.some((r) => r.kind === 'google' && r.share > 0)) {
    notes.push('A page found on Google can also be one that copied your article after it was published — check its date before blaming the article.');
  }

  const highlights: PlagiarismReport['highlights'] = [];
  for (let i = 0; i < article.tokens.length; ) {
    if (!counted[i]) {
      i++;
      continue;
    }
    const kind = kindAt.get(i) ?? 'exact';
    let j = i;
    while (j < article.tokens.length && counted[j] && (kindAt.get(j) ?? 'exact') === kind) j++;
    highlights.push({ start: article.tokens[i].start, end: article.tokens[j - 1].end, kind });
    i = j;
  }
  const matchedWords = counted.reduce((sum, v) => sum + v, 0);
  return {
    text,
    words: article.tokens.length,
    matchedWords,
    matchedShare: article.tokens.length ? matchedWords / article.tokens.length : 0,
    quotedWords: quotedAt.reduce((sum, v) => sum + v, 0),
    boilerplateWords: boilerplateAt.reduce((sum, v) => sum + v, 0),
    highlights,
    sources: results,
    ownCompared,
    google,
    language,
    durationMs: now() - started,
    notes,
  };
}
