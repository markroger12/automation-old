// Article language handling shared by the dashboard, the task service and the content pipeline.

/** Languages whose article labels, slugs and SEO fallbacks are localized. Everything else uses English. */
export type ContentLocale = 'en' | 'de';

export function contentLocale(language?: string | null): ContentLocale {
  return /^(german|deutsch|de)(\b|[-_]|$)/i.test((language ?? '').trim()) ? 'de' : 'en';
}

const GERMAN_TLDS: Record<string, string> = { de: 'Germany', at: 'Austria', ch: 'Switzerland' };

/**
 * Article language for a website when a task does not set one: German for .de / .at / .ch domains
 * (e.g. promizeiten.de), otherwise null (Settings → Default Language applies).
 */
export function websiteLanguage(url?: string | null): { language: string; country: string } | null {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const tld = host.split('.').pop() ?? '';
  return GERMAN_TLDS[tld] ? { language: 'German', country: GERMAN_TLDS[tld] } : null;
}

/**
 * Appended to every ChatGPT prompt (English too), so that edited prompt templates without a
 * {{language}} placeholder still produce the right language (headings, table labels and FAQs included).
 */
export function languageInstruction(language?: string | null, country?: string | null): string | null {
  const lang = (language ?? '').trim();
  if (!lang) return null;
  // English is spelled out too: without it ChatGPT sometimes answers in the language of the user's earlier chats
  // (Tigram articles for infofolks.com came out in German on 2026-09-24).
  const native = contentLocale(lang) === 'de' ? ' (Deutsch)' : '';
  const readers = country?.trim() ? ` for readers in ${country.trim()}` : '';
  return `Language: write your entire answer in ${lang}${native}${readers} — every heading, paragraph, table label, question and answer. Keep any exact line format requested above (such as "Recommended Title:" or "LINK:") unchanged.`;
}
