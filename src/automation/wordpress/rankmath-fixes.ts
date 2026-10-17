import type { ContentLocale } from '@/lib/content-locale';
import { buildMetaDescription, buildSeoTitle, containsKeyword } from '@/content/seo-meta';
import { slugify } from '@/lib/utils';

export interface RankMathFixInput {
  keyword: string;
  articleTitle: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  introText: string;
  subjectName: string;
  locale?: ContentLocale;
}

export interface RankMathFixPlan {
  seoTitle?: string;
  metaDescription?: string;
  slug?: string;
  /** Issues that need the article content revised (sent to ChatGPT with the SEO Correction Prompt). */
  contentIssues: string[];
  /** Issues deliberately not automated (images, links, power words…) — surfaced for manual review. */
  manualIssues: string[];
}

const CONTENT_ISSUE =
  /beginning of (your )?content|focus keyword in (the )?content|not found in (your )?content|subheading|keyword density|short and concise paragraphs|anfang (deines|des) inhalts|im inhalt|unterüberschrift|keyword-dichte|schlüsselwort-dichte|kurze.*absätze/i;
const MANUAL_ISSUE =
  /image|alt text|rich media|video|link|dofollow|table of contents|power word|sentiment|number|content is \d|words long|content ai|unique focus keyword|cornerstone|bild|alt-text|medien|verlink|inhaltsverzeichnis|power-wort|zahl|wörter lang/i;
// Rank Math's German translation says "Fokus-Schlüsselwort".
const FOCUS_KEYWORD = /focus keyword|fokus-keyword|fokus keyword|fokus-schlüsselwort|schlüsselwort/;

/**
 * Maps Rank Math recommendations to safe, bounded corrections. Deliberately conservative:
 * nothing here adds keyword repetitions beyond natural placement or rewrites facts.
 */
export function planRankMathFixes(issues: string[], input: RankMathFixInput): RankMathFixPlan {
  const plan: RankMathFixPlan = { contentIssues: [], manualIssues: [] };
  const kw = input.keyword.trim();

  for (const issue of issues) {
    const text = issue.toLowerCase();

    if (/seo title|in the title|beginning of seo title|near the beginning|seo-titel|im titel/.test(text) && FOCUS_KEYWORD.test(text)) {
      let title = buildSeoTitle(input.articleTitle, kw, 60, input.locale);
      if (!title.toLowerCase().startsWith(kw.toLowerCase())) {
        const remainder = title.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, '');
        const candidate = remainder ? `${kw}: ${remainder}` : kw;
        if (candidate.length <= 60) title = candidate;
      }
      if (title !== input.seoTitle && containsKeyword(title, kw)) plan.seoTitle = title;
      continue;
    }

    if (/meta description|meta-beschreibung|metabeschreibung/.test(text) && FOCUS_KEYWORD.test(text)) {
      const meta = buildMetaDescription({ introText: input.introText, keyword: kw, subjectName: input.subjectName, locale: input.locale });
      if (meta !== input.metaDescription && containsKeyword(meta, kw)) plan.metaDescription = meta;
      continue;
    }

    if ((/url/.test(text) && FOCUS_KEYWORD.test(text)) || /url is \d+ characters long\.? consider|shorten|url ist \d+ zeichen lang|kürzen/.test(text)) {
      const slug = slugify(kw, 75, input.locale);
      if (slug && slug !== input.slug) plan.slug = slug;
      continue;
    }

    if (CONTENT_ISSUE.test(issue)) {
      plan.contentIssues.push(issue);
      continue;
    }
    if (MANUAL_ISSUE.test(issue)) {
      plan.manualIssues.push(issue);
      continue;
    }
    plan.manualIssues.push(issue);
  }
  return plan;
}

export function planHasAutomaticFixes(plan: RankMathFixPlan): boolean {
  return Boolean(plan.seoTitle || plan.metaDescription || plan.slug || plan.contentIssues.length);
}
