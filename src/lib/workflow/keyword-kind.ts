// Which writer a keyword belongs to: the Celebrity Article Writer (a person) or the Tigram Article Writer
// (everything else — software, products, places, how-to searches).
//
// Two steps, both free:
//   1. Wording rules — "… wife", "… net worth" is about a person; "best …", "… near me", "download …" is not.
//   2. Wikidata — asks whether the keyword is a known human. A film, a town or a piece of software is not.
// What neither can decide stays UNKNOWN and is shown in the list, where it can be set by hand.

export type KeywordKindValue = 'UNKNOWN' | 'CELEBRITY' | 'TIGRAM';

export interface KindGuess {
  kind: KeywordKindValue;
  /** "rules", "wikidata" or "manual". */
  source: string;
  /** What decided it, in plain words. */
  note: string;
}

/** Words that follow a person's name in a search. */
const PERSON_WORDS = [
  'wife',
  'husband',
  'girlfriend',
  'boyfriend',
  'partner',
  'spouse',
  'married',
  'wedding',
  'divorce',
  'children',
  'kids',
  'son',
  'daughter',
  'parents',
  'mother',
  'father',
  'family',
  'siblings',
  'sister',
  'brother',
  'age',
  'birthday',
  'date of birth',
  'height',
  'weight',
  'biography',
  'bio',
  'net worth',
  'salary',
  'career',
  'movies',
  'tv shows',
  'boyfriend list',
  'dating',
  'nationality',
  'ethnicity',
  'religion',
  'education',
  'obituary',
  'death',
  'died',
  'instagram',
  'ehefrau',
  'ehemann',
  'freundin',
  'alter',
  'vermögen',
  'größe',
  'kinder',
  'eltern',
  'biografie',
];

/** Words that belong to a search about a thing, a place or a task. */
const THING_WORDS = [
  'best',
  'top',
  'cheap',
  'cheapest',
  'near me',
  'how to',
  'how do',
  'what is',
  'why is',
  'guide',
  'tutorial',
  'review',
  'reviews',
  'vs',
  'versus',
  'alternative',
  'alternatives',
  'download',
  'free download',
  'crack',
  'software',
  'app',
  'apps',
  'tool',
  'tools',
  'plugin',
  'antivirus',
  'vpn',
  'hosting',
  'price',
  'pricing',
  'cost',
  'buy',
  'coupon',
  'discount',
  'deal',
  'deals',
  'recipe',
  'restaurant',
  'hotel',
  'insurance',
  'login',
  'error',
  'fix',
  'update',
  'version',
  'for sale',
  'for pc',
  'for windows',
  'for android',
  'for iphone',
  'kaufen',
  'kosten',
  'test',
  'vergleich',
  'anleitung',
];

const has = (haystack: string, needle: string) => new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(haystack);

/** A first look that needs no network: the wording of the keyword itself. */
export function kindFromWording(keyword: string): KindGuess | null {
  const text = ` ${keyword.toLowerCase().trim()} `;
  // A thing wins over a person word: "best celebrity net worth tool" is not a biography.
  const thing = THING_WORDS.find((word) => has(text, word));
  if (thing) return { kind: 'TIGRAM', source: 'rules', note: `The keyword contains "${thing}".` };
  const person = PERSON_WORDS.find((word) => has(text, word));
  if (person) return { kind: 'CELEBRITY', source: 'rules', note: `The keyword contains "${person}", which follows a person's name.` };
  // Numbers and version numbers are never a person: "Antivirus FreeDoor 2.4.6.8".
  if (/\d[\d.]*\d|\d{4}/.test(keyword)) return { kind: 'TIGRAM', source: 'rules', note: 'The keyword contains numbers, so it is not a person.' };
  return null;
}

interface WikidataSearch {
  search?: { id?: string; label?: string; description?: string }[];
}

interface WikidataEntities {
  entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> }>;
}

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
/** Wikidata's own id for "human". */
const HUMAN = 'Q5';

async function wikidata<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T | null> {
  const url = `${WIKIDATA}?${new URLSearchParams({ ...params, format: 'json', origin: '*' }).toString()}`;
  try {
    const response = await fetch(url, { signal, headers: { 'User-Agent': 'BlogAutomationStudio/1.0 (keyword kind check)' } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Asks Wikidata whether the keyword is a known person. Returns null when it knows nothing about it. */
export async function kindFromWikidata(keyword: string, signal?: AbortSignal): Promise<KindGuess | null> {
  const found = await wikidata<WikidataSearch>({ action: 'wbsearchentities', search: keyword, language: 'en', limit: '3' }, signal);
  const entry = found?.search?.find((item) => item.id);
  if (!entry?.id) return null;
  // Only an entry that really carries the keyword counts, so "Dillon Brooks wife" does not become "Dillon Brooks".
  if (entry.label && entry.label.toLowerCase() !== keyword.toLowerCase().trim()) return null;
  const entity = await wikidata<WikidataEntities>({ action: 'wbgetentities', ids: entry.id, props: 'claims', languages: 'en' }, signal);
  const claims = entity?.entities?.[entry.id]?.claims?.P31 ?? [];
  const isHuman = claims.some((claim) => claim.mainsnak?.datavalue?.value?.id === HUMAN);
  const description = entry.description ? ` (${entry.description})` : '';
  if (isHuman) return { kind: 'CELEBRITY', source: 'wikidata', note: `Wikidata knows "${entry.label}" as a person${description}.` };
  if (claims.length) return { kind: 'TIGRAM', source: 'wikidata', note: `Wikidata knows "${entry.label}" as something other than a person${description}.` };
  return null;
}

/** The kind of one keyword: the wording first, then Wikidata. UNKNOWN when neither is sure. */
export async function detectKeywordKind(keyword: string, signal?: AbortSignal): Promise<KindGuess> {
  const wording = kindFromWording(keyword);
  if (wording) return wording;
  const wiki = await kindFromWikidata(keyword, signal);
  if (wiki) return wiki;
  return { kind: 'UNKNOWN', source: 'rules', note: 'Neither the wording nor Wikidata could tell — choose the writer yourself.' };
}

/** The module a kind belongs to. */
export const moduleForKind = (kind: KeywordKindValue): string => (kind === 'CELEBRITY' ? 'celebrity-writer' : 'tigram-writer');

/** Category names a celebrity article belongs in: "Celebrity", "Celebrities", "Prominente", "Promis", "Stars". */
const CELEBRITY_CATEGORY = /celeb|promi|^stars?$/i;

/** The category of a website that celebrity articles go in, when it has one. */
export function celebrityCategory<T extends { name: string }>(categories: T[]): T | null {
  return categories.find((category) => CELEBRITY_CATEGORY.test(category.name.trim())) ?? null;
}
