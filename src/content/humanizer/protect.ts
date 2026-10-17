// "Lock the facts" (Pass A of the research doc): a rewritten paragraph is only used when every link, number, quotation,
// multi-word name and keyword mention of the original is still there, and its length stayed close. Otherwise the
// original paragraph is kept — a smoother sentence must never become a less accurate one.
import { MARKDOWN_LINK, plainText } from './blocks';
import { STOP_WORDS } from './lexicon';
import { words } from './analyse';

export interface ProtectedItems {
  links: string[];
  numbers: string[];
  quotes: string[];
  names: string[];
  keywordCount: number;
}

export interface RewriteCheck {
  ok: boolean;
  /** Why the rewrite cannot be used. */
  problems: string[];
  /** Worth a look, but not a reason to throw the rewrite away. */
  warnings: string[];
}

const NAME_PARTICLES = new Set(['of', 'de', 'van', 'von', 'da', 'del', 'der', 'la', 'le', 'bin', 'al', 'y']);
/**
 * Capitalised only because they open a sentence: never the start of a name. Seen live on Tommy Gooding (27 September
 * 2026): "Unlike Cuba Jr." and "Because Cuba Sr." were taken for names, so two good rewrites were thrown away.
 */
const SENTENCE_OPENERS = new Set(
  (
    'unlike because although though despite however meanwhile today later like during following according besides unless until ' +
    'whereas whether both neither either each every many most some several another only even still yet now once soon since ' +
    'instead perhaps while where why how what which who whose here there born raised known ' +
    'nach seit als bei vor durch trotz während wie dann heute später bereits obwohl weil doch zudem außerdem'
  ).split(' '),
);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** German prose (by its commonest words), where every noun is capitalised. */
export function isGerman(text: string): boolean {
  let de = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (/^(der|die|das|und|ist|nicht|mit|von|sich|auch|wurde|eine|einer|dem|den)$/.test(word)) de++;
    else if (/^(the|and|is|of|with|was|his|her|this|that|from|has|were)$/.test(word)) en++;
  }
  return de > en;
}

export function countKeyword(text: string, keyword?: string): number {
  const key = keyword?.trim();
  if (!key) return 0;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')) ?? []).length;
}

/** Multi-word capitalised names ("Gary Phillip Spector", "Los Angeles"), without a sentence's opening word. */
export function namesIn(text: string): string[] {
  const names: string[] = [];
  // A part is a capitalised word or an initial ("J."); a full stop anywhere else ends the name.
  const pattern = /\p{Lu}(?:\.|[\p{L}'’-]*)(?:\s+(?:(?:of|de|van|von|da|del|der|la|le|bin|al|y)\s+)?\p{Lu}(?:\.|[\p{L}'’-]*))+/gu;
  for (const match of text.matchAll(pattern)) {
    const parts = match[0].split(/\s+/);
    while (parts.length && (STOP_WORDS.has(parts[0].toLowerCase()) || SENTENCE_OPENERS.has(parts[0].toLowerCase()))) parts.shift();
    while (parts.length && NAME_PARTICLES.has(parts[parts.length - 1])) parts.pop();
    if (parts.length >= 2) names.push(parts.join(' ').replace(/[.'’]+$/, ''));
  }
  return unique(names);
}

export function protectedItems(markdown: string, keyword?: string): ProtectedItems {
  const text = plainText(markdown);
  return {
    links: unique([...markdown.matchAll(MARKDOWN_LINK)].map((m) => m[0])),
    numbers: unique((text.match(/\d+(?:[.,:/]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, ''))),
    quotes: unique(
      [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1].trim()).filter((quote) => words(quote).length >= 3),
    ),
    names: namesIn(text),
    keywordCount: countKeyword(text, keyword),
  };
}

const normaliseQuotes = (text: string) => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

export function checkRewrite(original: string, rewritten: string, keyword?: string): RewriteCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const text = plainText(rewritten);
  if (!text.trim()) return { ok: false, problems: ['came back empty'], warnings };
  if (/\[P\d+\]/.test(rewritten)) problems.push('still has a paragraph label in it');

  const before = protectedItems(original, keyword);
  const after = protectedItems(rewritten, keyword);

  const lostLinks = before.links.filter((link) => !rewritten.includes(link));
  if (lostLinks.length) problems.push(`changed or dropped ${lostLinks.length === 1 ? 'a link' : `${lostLinks.length} links`}: ${lostLinks.slice(0, 2).join(', ')}`);
  const originalUrls = new Set([...original.matchAll(MARKDOWN_LINK)].map((m) => m[2]));
  const addedLinks = [...rewritten.matchAll(MARKDOWN_LINK)].filter((m) => !originalUrls.has(m[2]));
  if (addedLinks.length) problems.push(`added a link that was not there: ${addedLinks[0][2]}`);

  const lostNumbers = before.numbers.filter((n) => !after.numbers.includes(n));
  if (lostNumbers.length) problems.push(`lost or changed numbers: ${lostNumbers.slice(0, 5).join(', ')}`);
  const addedNumbers = after.numbers.filter((n) => !before.numbers.includes(n));
  if (addedNumbers.length) problems.push(`added numbers that were not there: ${addedNumbers.slice(0, 5).join(', ')}`);

  const flatText = normaliseQuotes(text);
  const lostQuotes = before.quotes.filter((quote) => !flatText.includes(normaliseQuotes(quote)));
  if (lostQuotes.length) problems.push(`changed a quotation: "${lostQuotes[0].slice(0, 60)}"`);

  // A name may move around ("die Schauspielerin Anna Loos" → "Anna Loos, die Schauspielerin": German capitalises every
  // noun), but each of its words must still be there — "Gary Phillip Spector" → "Spector" is a dropped name.
  const revisedWords = new Set(words(text).map((w) => w.toLowerCase()));
  const lostNames = before.names.filter(
    (name) => !text.includes(name) && !name.split(/\s+/).filter((w) => w.length > 2).every((w) => revisedWords.has(w.toLowerCase())),
  );
  // German capitalises every noun, so "Seriöse Quellen" or "Dennis’ Mutter" look like names (30 September 2026:
  // 2–5 good rewrites per German article were thrown away). In German only a lost name holding a word of the keyword
  // ("Fatou Schröder" for "dennis schröder vater") stops the rewrite; any other is a warning.
  const norm = (w: string) => w.toLowerCase().replace(/['’]+$/, '');
  const keywordWords = new Set(words(keyword ?? '').map(norm).filter((w) => w.length > 2));
  const strictNames = isGerman(`${plainText(original)} ${text}`)
    ? lostNames.filter((name) => {
        const inKeyword = words(name).map(norm).filter((w) => keywordWords.has(w));
        return inKeyword.length > 0 && inKeyword.every((w) => !revisedWords.has(w));
      })
    : lostNames;
  if (strictNames.length) problems.push(`dropped names: ${strictNames.slice(0, 4).join(', ')}`);
  const looseNames = lostNames.filter((name) => !strictNames.includes(name));
  if (looseNames.length) warnings.push(`reworded: ${looseNames.slice(0, 3).join(', ')}`);

  if (after.keywordCount < before.keywordCount) {
    problems.push(`uses the keyword ${after.keywordCount} time(s) instead of ${before.keywordCount}`);
  } else if (after.keywordCount > before.keywordCount) {
    warnings.push(`uses the keyword ${after.keywordCount - before.keywordCount} more time(s)`);
  }

  const originalWords = words(plainText(original)).length;
  const newWords = words(text).length;
  const ratio = originalWords ? newWords / originalWords : 1;
  const longest = originalWords < 25 ? 1.6 : 1.3;
  if (ratio < 0.6) problems.push(`cut the paragraph from ${originalWords} to ${newWords} words`);
  else if (ratio > longest) problems.push(`stretched the paragraph from ${originalWords} to ${newWords} words`);
  else if (ratio < 0.8 || ratio > 1.2) warnings.push(`${originalWords} → ${newWords} words`);

  const newNames = after.names.filter((name) => !before.names.includes(name) && !plainText(original).includes(name));
  if (newNames.length) warnings.push(`new names: ${newNames.slice(0, 3).join(', ')}`);

  return { ok: problems.length === 0, problems, warnings };
}
