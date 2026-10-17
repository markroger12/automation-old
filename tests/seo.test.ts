import { describe, expect, it } from 'vitest';
import { buildMetaDescription, buildSeoTitle, deriveSubjectName } from '@/content/seo-meta';
import { findHtmlProblems, runSeoChecks } from '@/seo/checker';
import { computeMetrics, countKeyword, countWords, keywordDensity } from '@/seo/metrics';
import { slugify } from '@/lib/utils';

describe('keyword counter', () => {
  it('counts exact, case-insensitive whole-phrase matches', () => {
    const text = "Sydney Sweeney starred in Euphoria. SYDNEY SWEENEY's fans love her. sydney sweeneyfan is not a match. Sydney\nSweeney again.";
    expect(countKeyword(text, 'Sydney Sweeney')).toBe(3);
  });

  it('handles accented names and curly apostrophes', () => {
    expect(countKeyword('Timothée Chalamet’s career. Timothée Chalamet!', 'Timothée Chalamet')).toBe(2);
    expect(countKeyword('Timothee Chalamet', 'Timothée Chalamet')).toBe(0);
  });

  it('counts words and density', () => {
    expect(countWords("She's a well-known actor, born in 1997.")).toBe(7);
    expect(keywordDensity(15, 1300)).toBe(1.15);
  });

  it('computes heading and paragraph metrics from HTML', () => {
    const html = '<p>Sydney Sweeney intro.</p><h2>Sydney Sweeney Career</h2><p>Text.</p><h3>Euphoria</h3><p>More.</p><h2>Frequently Asked Questions</h2><h3>Q?</h3><p>A.</p>';
    const m = computeMetrics(html, 'Sydney Sweeney');
    expect(m.h2Count).toBe(2);
    expect(m.h3Count).toBe(2);
    expect(m.keywordCount).toBe(2);
    expect(m.bodyWordCount).toBeLessThan(m.wordCount);
  });
});

describe('SEO meta helpers', () => {
  it('slugifies keywords', () => {
    expect(slugify('Sydney Sweeney Age')).toBe('sydney-sweeney-age');
    expect(slugify('Timothée Chalamet')).toBe('timothee-chalamet');
    expect(slugify("Beyoncé's Net Worth & Husband")).toBe('beyonces-net-worth-and-husband');
  });

  it('derives the subject name from a modified keyword', () => {
    expect(deriveSubjectName('Sydney Sweeney Age')).toBe('Sydney Sweeney');
    expect(deriveSubjectName('Jenna Ortega net worth 2026')).toBe('Jenna Ortega');
    expect(deriveSubjectName('Zendaya')).toBe('Zendaya');
  });

  it('builds an SEO title of at most 60 characters containing the keyword', () => {
    const title = buildSeoTitle('Sydney Sweeney Age, Biography, Family, Career, Net Worth and Latest Updates', 'Sydney Sweeney');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain('Sydney Sweeney');
    expect(buildSeoTitle('Short Title', 'Emma Myers')).toContain('Emma Myers');
  });

  it('builds a 140–160 character meta description with the keyword', () => {
    const fromIntro = buildMetaDescription({
      introText:
        'Sydney Sweeney has quickly become one of the most recognizable young actresses in Hollywood, thanks to standout roles in Euphoria and The White Lotus. Her story began in Spokane.',
      keyword: 'Sydney Sweeney',
      subjectName: 'Sydney Sweeney',
    });
    expect(fromIntro.length).toBeGreaterThanOrEqual(140);
    expect(fromIntro.length).toBeLessThanOrEqual(160);
    expect(fromIntro).toContain('Sydney Sweeney');

    const fallback = buildMetaDescription({ introText: 'Too short.', keyword: 'Jenna Ortega', subjectName: 'Jenna Ortega' });
    expect(fallback.length).toBeGreaterThanOrEqual(140);
    expect(fallback.length).toBeLessThanOrEqual(160);
    expect(fallback).toContain('Jenna Ortega');
  });
});

describe('SEO checker', () => {
  const paragraph = (s: string) => `<p>${s}</p>`;
  const filler = 'She has built a career through steady work, thoughtful role choices and a close relationship with audiences who follow her projects.';
  const article = [
    paragraph(`Sydney Sweeney is an American actress known for Euphoria. ${filler}`),
    '<h2>Sydney Sweeney Quick Bio</h2><table class="quick-bio-table"><tbody>' +
      Array.from({ length: 10 }, (_, i) => `<tr><td>Field ${i}</td><td>Value ${i}</td></tr>`).join('') +
      '</tbody></table>',
    ...Array.from({ length: 5 }, (_, i) =>
      `<h2>Section ${i} of Sydney Sweeney Life</h2>${paragraph(`Sydney Sweeney section ${i}. ${filler} ${filler}`)}<h3>Detail ${i}</h3>${paragraph(`${filler} Unique ${i}.`)}`,
    ),
    '<h2>Frequently Asked Questions About Sydney Sweeney</h2>' +
      Array.from({ length: 5 }, (_, i) => `<h3>Question ${i}?</h3>${paragraph(`Answer number ${i} for readers.`)}`).join(''),
    '<h2>Conclusion</h2>' + paragraph(`Sydney Sweeney continues to grow. ${filler}`),
  ].join('');

  const base = {
    keyword: 'Sydney Sweeney',
    articleTitle: 'Sydney Sweeney: Age, Career, Family and Net Worth',
    seoTitle: 'Sydney Sweeney: Age, Career, Family and Net Worth',
    slug: 'sydney-sweeney',
    metaDescription: 'x'.repeat(150),
    contentHtml: article,
    faqs: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, answer: 'A' })),
    quickBio: Array.from({ length: 10 }, (_, i) => ({ attribute: `F${i}`, details: 'V' })),
    categoryName: 'Actresses',
    tags: ['Sydney Sweeney'],
    settings: { maxArticleWordCount: 1300, minKeywordOccurrences: 8, maxKeywordOccurrences: 18, faqCount: 5 },
  };

  it('scores a well-formed article highly', () => {
    const report = runSeoChecks(base);
    const failed = report.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(failed).not.toContain('keyword_in_title');
    expect(failed).not.toContain('keyword_in_intro');
    expect(failed).not.toContain('faq_exists');
    expect(failed).not.toContain('broken_html');
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.checks.length).toBeGreaterThanOrEqual(23);
  });

  it('penalises missing meta, slug, category and keyword stuffing', () => {
    const stuffed = '<p>' + 'Sydney Sweeney Sydney Sweeney Sydney Sweeney Sydney Sweeney. '.repeat(3) + '</p>';
    const report = runSeoChecks({ ...base, metaDescription: null, slug: 'something-else', categoryName: null, tags: [], contentHtml: stuffed + stuffed });
    const status = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    expect(status.meta_description_length).toBe('fail');
    expect(status.keyword_in_slug).toBe('fail');
    expect(status.category_selected).toBe('fail');
    expect(status.tag_selected).toBe('fail');
    expect(status.keyword_stuffing).toBe('fail');
    expect(report.score).toBeLessThan(60);
  });

  it('detects broken HTML and Markdown leftovers', () => {
    expect(findHtmlProblems('<p>ok</p>')).toEqual([]);
    expect(findHtmlProblems('<p>open <strong>bold</p>')).toContain('Unclosed <strong>');
    expect(findHtmlProblems('<p>## Heading</p>').join()).toMatch(/Markdown heading/);
    expect(findHtmlProblems('<p>**bold**</p>').join()).toMatch(/Markdown bold/);
  });
});
