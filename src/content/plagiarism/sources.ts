// The web side of the plagiarism check: reading a public page, and Wikipedia through its official API (search, and the
// plain text of an article). Nothing here logs in, gets past a paywall or a bot check: a page that refuses is reported
// as not read.
import type { FetchedPage, WebHit } from './check';
import { pageText } from './text';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36';
/** Wikimedia asks API clients to name themselves. */
const API_UA = 'BlogAutomationStudio/1.0 (local plagiarism test tool)';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;

async function get(url: string, headers: Record<string, string>, retries = 2): Promise<Response> {
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Wikipedia answers "too many requests" when several searches arrive at once (seen live): wait and ask again.
  if (response.status === 429 && retries > 0) {
    const wait = Math.min(5, Number(response.headers.get('retry-after')) || 0) * 1000 || 1500 * (3 - retries);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return get(url, headers, retries - 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const response = await get(url, { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9,de;q=0.8' });
  const type = response.headers.get('content-type') ?? '';
  if (!/html|text\/plain/i.test(type)) throw new Error(`not a web page (${type.split(';')[0] || 'unknown type'})`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('the page is too large');
  const body = await response.text();
  if (body.length > MAX_BYTES * 2) throw new Error('the page is too large');
  if (/text\/plain/i.test(type)) return { title: url, text: body, url: response.url || url };
  const { title, text } = pageText(body);
  if (/just a moment|attention required|verify you are human|captcha/i.test(title)) throw new Error('the site showed a bot check');
  return { title, text, url: response.url || url };
}

/** The serper.dev key from .env (SERPER_API_KEY); read on every call, so a new key needs no restart. */
export function serperKey(): string | null {
  return process.env.SERPER_API_KEY?.trim() || null;
}

/**
 * Google results for one phrase, searched word for word ("…"), through serper.dev — Google's own Custom Search API
 * takes no new customers and closes on 1 January 2027. One call is one credit.
 */
export async function searchGoogle(phrase: string, language: 'en' | 'de'): Promise<WebHit[]> {
  const key = serperKey();
  if (!key) throw new Error('no SERPER_API_KEY in .env');
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `"${phrase.replace(/"/g, '')}"`, gl: language === 'de' ? 'de' : 'us', hl: language, num: 10 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) throw new Error('serper.dev refused the key (check SERPER_API_KEY)');
  if (response.status === 402 || response.status === 429) throw new Error(`serper.dev: no credits left or too many searches (HTTP ${response.status})`);
  if (!response.ok) throw new Error(`serper.dev: HTTP ${response.status}`);
  const data = (await response.json()) as { organic?: Array<{ link?: string; title?: string; snippet?: string }> };
  return (data.organic ?? []).filter((r) => r.link).map((r) => ({ url: r.link!, title: r.title ?? '', snippet: r.snippet ?? '' }));
}

const api = (language: 'en' | 'de') => `https://${language}.wikipedia.org/w/api.php`;

export async function searchWikipedia(query: string, language: 'en' | 'de', exact: boolean): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: exact ? `"${query.replace(/"/g, '')}"` : query,
    srlimit: '3',
    srprop: '',
    format: 'json',
    formatversion: '2',
  });
  const data = (await (await get(`${api(language)}?${params}`, { 'user-agent': API_UA })).json()) as { query?: { search?: Array<{ title: string }> } };
  return (data.query?.search ?? []).map((hit) => hit.title);
}

export async function wikipediaPage(title: string, language: 'en' | 'de'): Promise<FetchedPage> {
  const params = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', redirects: '1', titles: title, format: 'json', formatversion: '2' });
  const data = (await (await get(`${api(language)}?${params}`, { 'user-agent': API_UA })).json()) as {
    query?: { pages?: Array<{ title: string; extract?: string; missing?: boolean }> };
  };
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.extract) throw new Error('Wikipedia has no such article');
  return { title: `Wikipedia: ${page.title}`, text: page.extract, url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` };
}
