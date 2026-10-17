import type { ContentLocale } from '@/lib/content-locale';
import { normalizeWhitespace, escapeRegExp } from '@/lib/utils';
import type { BioRow } from './quick-bio';

const SUBJECT_MODIFIERS =
  /\s+(?:age|biography|bio|wiki|wikipedia|net\s+worth|height|weight|husband|wife|boyfriend|girlfriend|partner|dating|spouse|family|parents|siblings|children|kids|career|movies|films|tv\s+shows|instagram|facts|life|education|nationality|ethnicity|religion|salary|income|house|cars?|latest|news|updates?|profile|birthday|relationship|and|&|\d{4}|alter|biografie|biographie|steckbrief|vermögen|größe|gewicht|ehemann|ehefrau|mann|frau|freund|freundin|familie|eltern|geschwister|kinder|sohn|tochter|karriere|beruf|filme|serien|heute|aktuell|geboren|verheiratet|herkunft|nationalität|wohnort|krank|und)(?![\p{L}\p{N}])[\s\S]*$/iu;

/** "Sydney Sweeney Age" -> "Sydney Sweeney" (the person the article is about). */
const FULL_NAME_ROW = /^(full name|real name|name|known as|vollständiger name|voller name|name|bekannt als)$/i;
const UNKNOWN_VALUE = /not publicly|not known|unknown|n\/a|nicht öffentlich|unbekannt/i;

/** "danna lynn blocker" → "Danna Lynn Blocker" (headings should not show a typed-in keyword in lower case). */
function titleCase(value: string): string {
  if (/\p{Lu}/u.test(value)) return value;
  return value.replace(/(^|[\s(\-–—'’.])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** The person the article is about: the name from the Quick Bio table, else the keyword without "wife", "age"… */
export function deriveSubjectName(keyword: string, quickBio: BioRow[] = []): string {
  const fromBio = quickBio.find((r) => FULL_NAME_ROW.test(normalizeWhitespace(r.attribute)))?.details;
  const name = fromBio ? normalizeWhitespace(fromBio.replace(/\s*\([^)]*\)\s*$/, '')) : '';
  if (name && name.length <= 60 && !UNKNOWN_VALUE.test(name) && name.split(/\s+/).length <= 6) return titleCase(name);
  const stripped = normalizeWhitespace(keyword.replace(SUBJECT_MODIFIERS, '').replace(/['’]s$/i, ''));
  return titleCase(stripped.length >= 3 ? stripped : normalizeWhitespace(keyword));
}

export function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword.trim()) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword.trim()).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}

function smartTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[\s,;:–—-]+$/, '');
}

/**
 * SEO title ≤ maxLength that contains the keyword, ideally near the start.
 * Prefers trimming the article title at natural separators rather than rewriting it.
 */
export function buildSeoTitle(articleTitle: string, keyword: string, maxLength = 60, locale: ContentLocale = 'en'): string {
  const title = normalizeWhitespace(articleTitle || keyword);
  if (title.length <= maxLength && containsKeyword(title, keyword)) return title;

  // Try cutting at separators while keeping the keyword.
  const separators = /\s*(?:[|:–—]|\s-\s|,)\s*/g;
  const pieces = title.split(separators).filter(Boolean);
  let built = '';
  for (const piece of pieces) {
    const candidate = built ? `${built}, ${piece}` : piece;
    if (candidate.length > maxLength) break;
    built = candidate;
  }
  if (built && containsKeyword(built, keyword) && built.length >= 30) return built;

  const subject = displayKeyword(keyword);
  const fallbacks =
    locale === 'de'
      ? [`${subject}: Alter, Karriere, Familie und Vermögen`, `${subject}: Biografie, Karriere und Vermögen`, `${subject}: Biografie und Karriere`, subject]
      : [`${subject}: Age, Career, Family and Net Worth`, `${subject}: Biography, Career and Net Worth`, `${subject}: Biography and Career`, subject];
  return fallbacks.find((f) => f.length <= maxLength) ?? smartTruncate(subject, maxLength);
}

/**
 * The keyword as it stands in a title or at the start of a sentence: an all-lowercase keyword is title-cased
 * ("dennis schröder vater: Alter, …" was published on 30 September 2026; German capitalises names and nouns alike).
 * Rank Math matches the focus keyword without regard to case.
 */
export function displayKeyword(keyword: string): string {
  const value = normalizeWhitespace(keyword);
  return /\p{Lu}/u.test(value) ? value : titleCase(value);
}

function germanMetaTemplates(keyword: string, subjectName: string): string[] {
  return [
    `Alles über ${keyword}: Herkunft, Familie, Karriere, Beziehungen, geschätztes Vermögen und die neuesten Informationen über ${subjectName} im Überblick.`,
    `${keyword}: Hier erfahren Sie mehr über Herkunft, Familie, Karriere, Beziehungen, geschätztes Vermögen und aktuelle Neuigkeiten von ${subjectName}.`,
    `Wer ist ${keyword}? Herkunft, Familie, Karriere, Beziehungen, geschätztes Vermögen und aktuelle Neuigkeiten über ${subjectName}.`,
    `${keyword} im Porträt: Herkunft, Familie, Karriere, Vermögen und aktuelle Neuigkeiten über ${subjectName}.`,
  ];
}

function sentences(text: string): string[] {
  return (normalizeWhitespace(text).match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []).map((s) => s.trim());
}

/**
 * Natural meta description of ~140–160 characters that includes the keyword.
 * Built from the article introduction, falling back to a descriptive template.
 */
export function buildMetaDescription(input: { introText: string; keyword: string; subjectName: string; locale?: ContentLocale }): string {
  const { keyword, subjectName } = input;
  const target = { min: 140, max: 160 };
  const sents = sentences(input.introText);
  const candidates: string[] = [];

  for (let i = 0; i < sents.length; i++) {
    let text = sents[i];
    if (text.length >= target.min && text.length <= target.max) candidates.push(text);
    for (let j = i + 1; j < sents.length && text.length < target.max; j++) {
      text = `${text} ${sents[j]}`;
      if (text.length >= target.min && text.length <= target.max) candidates.push(text);
    }
  }

  const withKeyword = candidates.filter((c) => containsKeyword(c, keyword));
  const pick = (list: string[]) => list.sort((a, b) => Math.abs(150 - a.length) - Math.abs(150 - b.length))[0];
  if (withKeyword.length) return pick(withKeyword);

  const shown = displayKeyword(keyword);
  const templates = input.locale === 'de' ? germanMetaTemplates(shown, subjectName) : [
    `Everything to know about ${keyword}, including ${subjectName}'s early life, family, career highlights, relationships, estimated net worth and latest updates.`,
    `${shown}: learn about ${subjectName}'s background, family, career highlights, relationships, estimated net worth and the latest updates.`,
    `Explore ${keyword} details, plus ${subjectName}'s family, career highlights, relationships, estimated net worth and recent news.`,
    `A clear guide to ${keyword}, covering ${subjectName}'s background, family, career, estimated net worth and latest updates.`,
  ];
  const fitting = templates.filter((t) => t.length >= target.min && t.length <= target.max);
  if (fitting.length) return pick(fitting);

  const first = templates[0];
  if (first.length > target.max) {
    const cut = smartTruncate(first, target.max - 1);
    return /[.!?]$/.test(cut) ? cut : `${cut}.`;
  }
  return first;
}
