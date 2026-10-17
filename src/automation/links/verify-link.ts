// Checks external link suggestions before they go into an article: only well-known sites, the page must really
// exist and must be about the linked words. ChatGPT sometimes invents URLs, so nothing is trusted unchecked.
import type { LinkSuggestion } from '@/content/external-links';

export interface LinkCheck extends LinkSuggestion {
  ok: boolean;
  /** Why a link was accepted or rejected (shown in the task log). */
  reason: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36',
  'accept-language': 'en,de;q=0.8',
};

/** Large, trusted sites whose pages are checked by opening them. Wikipedia and IMDb have their own checks. */
const AUTHORITY_DOMAINS = [
  'britannica.com',
  'rottentomatoes.com',
  'metacritic.com',
  'allmusic.com',
  'discogs.com',
  'bbc.co.uk',
  'bbc.com',
  'theguardian.com',
  'nytimes.com',
  'variety.com',
  'hollywoodreporter.com',
  'rollingstone.com',
  'billboard.com',
  'grammy.com',
  'rockhall.com',
  'oscars.org',
  'emmys.com',
  'goldenglobes.com',
  'olympics.com',
  'fifa.com',
  'uefa.com',
  'nba.com',
  'nfl.com',
  'espn.com',
  'filmportal.de',
  'deutsche-biographie.de',
  'spiegel.de',
  'zeit.de',
  'faz.net',
  'sueddeutsche.de',
  'tagesschau.de',
  'zdf.de',
  'ard.de',
  'br.de',
  'ndr.de',
  'wdr.de',
  'swr.de',
  'mdr.de',
  'orf.at',
  'srf.ch',
  'bundestag.de',
];

/** Universities and public bodies (e.g. harvard.edu, ox.ac.uk, uni-muenchen.de, stadt-koeln.de). */
const INSTITUTION_HOST = /(\.edu|\.gov|\.ac\.[a-z]{2}|\.gv\.at|\.admin\.ch|\.bund\.de)$|(^|\.)(uni|tu|fh|hs)-[a-z0-9-]+\.(de|at|ch)$|(^|\.)(stadt|landkreis)-[a-z0-9-]+\.de$/i;

/** Sites never linked: social media, shops, and celebrity gossip / net-worth sites competing for the same readers. */
const BLOCKED_HOST =
  /(^|\.)(facebook|instagram|x|twitter|tiktok|youtube|pinterest|reddit|amazon|ebay|celebritynetworth|networthspot|famousbirthdays|wikifeet|whosdatedwho|bild|promiflash|gala|bunte|intouch|closermag|tmz|dailymail)\.[a-z.]+$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function words(value: string): string[] {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[_–—\-:()"'’,.]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** The page title is about the phrase: most of the phrase's words appear in it. */
export function titleMatches(title: string, phrase: string): boolean {
  const cleaned = title.replace(/\s*[-–|]\s*(wikipedia|imdb|britannica)\b.*$/i, '');
  const titleWords = new Set(words(cleaned));
  const phraseWords = words(phrase);
  if (!phraseWords.length || !titleWords.size) return false;
  const hits = phraseWords.filter((w) => titleWords.has(w)).length;
  return hits / phraseWords.length >= 0.6;
}

async function getPage(fetchImpl: FetchLike, url: string): Promise<{ status: number; url: string; html: string } | null> {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    const html = res.status === 200 ? await res.text() : '';
    return { status: res.status, url: res.url || url, html };
  } catch {
    return null;
  }
}

const pageTitle = (html: string) =>
  (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ??
    '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, { value?: string }[]>;
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
}

async function wikidataEntity(fetchImpl: FetchLike, item: string): Promise<WikidataEntity | null> {
  try {
    const res = await fetchImpl(`https://www.wikidata.org/wiki/Special:EntityData/${item}.json`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
    const data = (await res.json()) as { entities?: Record<string, WikidataEntity> };
    return data.entities?.[item] ?? null;
  } catch {
    return null;
  }
}

const wikidataItemOf = (html: string) => /"wgWikibaseItemId":"(Q\d+)"/.exec(html)?.[1] ?? null;

function claimValues(entity: WikidataEntity, property: string): string[] {
  return (entity.claims?.[property] ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v): v is string => typeof v === 'string');
}

/** All names of an entity in every language (e.g. "Annie Hall" for the German article "Der Stadtneurotiker"). */
function entityNames(entity: WikidataEntity): string[] {
  const labels = Object.values(entity.labels ?? {}).map((l) => l.value ?? '');
  const aliases = Object.values(entity.aliases ?? {}).flatMap((list) => list.map((a) => a.value ?? ''));
  return [...labels, ...aliases].filter(Boolean);
}

/** The Wikidata entity of the Wikipedia article a phrase leads to (English first, then the article language). */
async function entityForPhrase(fetchImpl: FetchLike, phrase: string, languages: string[]): Promise<WikidataEntity | null> {
  for (const lang of languages) {
    const search = await getPage(fetchImpl, `https://${lang}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(phrase)}&go=Go`);
    if (!search || search.status !== 200 || !/\/wiki\/(?!Special:)/.test(search.url)) continue;
    const item = wikidataItemOf(search.html);
    if (!item) continue;
    const entity = await wikidataEntity(fetchImpl, item);
    if (entity && (titleMatches(pageTitle(search.html), phrase) || entityNames(entity).some((name) => titleMatches(name, phrase)))) return entity;
  }
  return null;
}

async function checkWikipedia(fetchImpl: FetchLike, link: LinkSuggestion): Promise<LinkCheck> {
  const page = await getPage(fetchImpl, link.url);
  if (!page) return { ...link, ok: false, reason: 'Wikipedia page could not be opened' };
  if (page.status !== 200) return { ...link, ok: false, reason: `Wikipedia page does not exist (HTTP ${page.status})` };
  // Real disambiguation pages (normal articles also carry "mw-disambig" hatnote links, so that class is not used).
  const disambiguation =
    /id=["']disambigbox["']|id=["']Vorlage_Begriffsklärung["']/i.test(page.html) ||
    /"wgCategories":\[[^\]]*"(Disambiguation pages|Begriffsklärung)"/i.test(page.html) ||
    /\((disambiguation|begriffsklärung)\)/i.test(pageTitle(page.html));
  if (disambiguation) {
    return { ...link, ok: false, reason: 'Wikipedia disambiguation page' };
  }
  const title = pageTitle(page.html);
  if (titleMatches(title, link.phrase)) return { ...link, url: page.url, ok: true, reason: `Wikipedia: ${title}` };
  // Same thing under another name, e.g. German Wikipedia "Der Stadtneurotiker" for the film "Annie Hall".
  const item = wikidataItemOf(page.html);
  const entity = item ? await wikidataEntity(fetchImpl, item) : null;
  const alias = entity ? entityNames(entity).find((name) => titleMatches(name, link.phrase)) : undefined;
  if (alias) return { ...link, url: page.url, ok: true, reason: `Wikipedia: ${title} (also known as "${alias}")` };
  return { ...link, ok: false, reason: `Wikipedia page "${title}" is about something else` };
}

/** IMDb blocks automated checks, so the IMDb id is compared with the one Wikidata lists for the phrase's Wikipedia article. */
async function checkImdb(fetchImpl: FetchLike, link: LinkSuggestion, languages: string[]): Promise<LinkCheck> {
  const id = /imdb\.com\/(?:[a-z]{2}\/)?(?:name|title)\/((?:nm|tt)\d{6,9})/i.exec(link.url)?.[1];
  if (!id) return { ...link, ok: false, reason: 'Not an IMDb person or title page' };
  const entity = await entityForPhrase(fetchImpl, link.phrase, languages);
  if (!entity) return { ...link, ok: false, reason: 'IMDb link could not be confirmed' };
  const ids = claimValues(entity, 'P345');
  if (ids.includes(id)) return { ...link, url: `https://www.imdb.com/${id.startsWith('nm') ? 'name' : 'title'}/${id}/`, ok: true, reason: `IMDb id ${id} confirmed by Wikidata` };
  return { ...link, ok: false, reason: `IMDb id ${id} belongs to something else (Wikidata lists ${ids.join(', ') || 'none'})` };
}

/** Wikidata records the official website of people, universities, awards and organisations. */
async function isOfficialWebsite(fetchImpl: FetchLike, link: LinkSuggestion, host: string, languages: string[]): Promise<boolean> {
  const entity = await entityForPhrase(fetchImpl, link.phrase, languages);
  return Boolean(entity && claimValues(entity, 'P856').some((site) => hostOf(site) === host));
}

const NAME_FILLERS = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'at', 'in', 'de', 'der', 'die', 'das', 'und', 'fur', 'von']);

/**
 * The site carries the phrase's own name: globaldownsyndrome.org for "Global Down Syndrome Foundation", chla.org for
 * "Children’s Hospital Los Angeles", lmu.edu for "Loyola Marymount University". An organisation too small for
 * Wikipedia is still found this way; the page title must name it too (checked by the caller).
 */
export function siteNamedAfter(host: string, phrase: string): boolean {
  const labels = host.replace(/^www\./, '').split('.');
  // The name before the ending (.org, .com, .co.uk, .com.au …).
  const secondLevel = labels.length >= 3 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3;
  const name = labels[labels.length - (secondLevel ? 3 : 2)] ?? '';
  const parts = phrase
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((part) => part && !NAME_FILLERS.has(part));
  if (!name || !parts.length) return false;
  const joined = parts.join('');
  const initials = parts.map((part) => part[0]).join('');
  return name.replace(/-/g, '') === joined || (name.length >= 6 && joined.startsWith(name.replace(/-/g, ''))) || (name.length >= 3 && name === initials);
}

async function checkOther(fetchImpl: FetchLike, link: LinkSuggestion, host: string, languages: string[]): Promise<LinkCheck> {
  if (await isOfficialWebsite(fetchImpl, link, host, languages)) {
    return { ...link, ok: true, reason: `Official website of ${link.phrase} (confirmed by Wikidata)` };
  }
  const named = siteNamedAfter(host, link.phrase);
  const trusted = named || AUTHORITY_DOMAINS.some((d) => onDomain(host, d)) || INSTITUTION_HOST.test(host);
  if (!trusted) return { ...link, ok: false, reason: `${host} is not on the list of trusted sites (and is not named after "${link.phrase}")` };
  const page = await getPage(fetchImpl, link.url);
  if (!page || page.status !== 200) return { ...link, ok: false, reason: `Page could not be opened${page ? ` (HTTP ${page.status})` : ''}` };
  const title = pageTitle(page.html);
  if (/^just a moment|attention required|access denied/i.test(title)) return { ...link, ok: false, reason: `${host} blocks the check` };
  if (!titleMatches(title, link.phrase)) return { ...link, ok: false, reason: `Page "${title.slice(0, 80)}" is about something else` };
  return { ...link, url: page.url, ok: true, reason: named ? `Official website of ${link.phrase} (the site is named after it): ${title.slice(0, 80)}` : `${host}: ${title.slice(0, 80)}` };
}

/** Checks one suggestion. `language` is the article language (German articles prefer German Wikipedia). */
export async function verifyLink(link: LinkSuggestion, options: { language?: string | null; fetch?: FetchLike } = {}): Promise<LinkCheck> {
  const fetchImpl = options.fetch ?? fetch;
  const host = hostOf(link.url);
  if (!host) return { ...link, ok: false, reason: 'Invalid URL' };
  if (BLOCKED_HOST.test(host)) return { ...link, ok: false, reason: `${host} is not linked (social media, shop or competing gossip site)` };
  if (/(^|\.)wikipedia\.org$/.test(host)) return checkWikipedia(fetchImpl, link);
  const languages = /^(german|deutsch)/i.test(options.language ?? '') ? ['en', 'de'] : ['en'];
  if (onDomain(host, 'imdb.com')) return checkImdb(fetchImpl, link, languages);
  return checkOther(fetchImpl, link, host, languages);
}
