import { describe, expect, it } from 'vitest';
import { assembleArticle } from '@/content/assembly';
import { cleanChatGPTHtml } from '@/content/cleanup';
import { parseFaqs } from '@/content/faqs';
import { parseQuickBio } from '@/content/quick-bio';
import { buildMetaDescription, buildSeoTitle, deriveSubjectName } from '@/content/seo-meta';
import { extractTitles } from '@/content/titles';
import { contentLocale, languageInstruction, websiteLanguage } from '@/lib/content-locale';
import { slugify } from '@/lib/utils';

describe('German articles', () => {
  it('detects German from the language name and from German website domains', () => {
    expect(contentLocale('German')).toBe('de');
    expect(contentLocale('Deutsch')).toBe('de');
    expect(contentLocale('English')).toBe('en');
    expect(websiteLanguage('https://promizeiten.de')).toEqual({ language: 'German', country: 'Germany' });
    expect(websiteLanguage('https://www.example.at/')).toEqual({ language: 'German', country: 'Austria' });
    expect(websiteLanguage('https://peakbuzz.co.uk')).toBeNull();
  });

  it('tells ChatGPT which language to answer in, English included', () => {
    expect(languageInstruction('German', 'Germany')).toContain('entire answer in German (Deutsch) for readers in Germany');
    // English is spelled out as well — ChatGPT otherwise followed the user's earlier German chats.
    expect(languageInstruction('English', 'United States')).toContain('entire answer in English for readers in United States');
    expect(languageInstruction('', null)).toBeNull();
  });

  it('spells umlauts out in slugs', () => {
    expect(slugify('Jürgen Drews Größe', 75, 'de')).toBe('juergen-drews-groesse');
    expect(slugify('Fabian Drews', 75, 'de')).toBe('fabian-drews');
    expect(slugify('Timothée Chalamet')).toBe('timothee-chalamet');
  });

  it('finds the person in German keywords', () => {
    expect(deriveSubjectName('Fabian Drews Ehefrau')).toBe('Fabian Drews');
    // Headings show the name, so a typed-in keyword in lower case is capitalised.
    expect(deriveSubjectName('fabian drews alter')).toBe('Fabian Drews');
    expect(deriveSubjectName('duke keaton', [{ attribute: 'Vollständiger Name', details: 'Duke Keaton' }])).toBe('Duke Keaton');
  });

  it('parses German titles, FAQs and a Steckbrief table', () => {
    const titles = extractTitles('1. Fabian Drews: Alles über den Sohn von Jürgen Drews\n2. Wer ist Fabian Drews? Beruf, Familie und mehr\n\nEmpfohlener Titel: Wer ist Fabian Drews? Beruf, Familie und mehr');
    expect(titles.recommended).toBe('Wer ist Fabian Drews? Beruf, Familie und mehr');

    const faqs = parseFaqs('Häufig gestellte Fragen\nFrage: Wer ist Fabian Drews?\nAntwort: Er ist der Sohn von Jürgen Drews.\nIst Fabian Drews verheiratet?\nDazu gibt es keine öffentlich bestätigten Angaben.');
    expect(faqs).toEqual([
      { question: 'Wer ist Fabian Drews?', answer: 'Er ist der Sohn von Jürgen Drews.' },
      { question: 'Ist Fabian Drews verheiratet?', answer: 'Dazu gibt es keine öffentlich bestätigten Angaben.' },
    ]);

    const rows = parseQuickBio('<table><tr><th>Merkmal</th><th>Angaben</th></tr><tr><td>Vollständiger Name</td><td>Fabian Drews</td></tr><tr><td>Beruf</td><td>Nicht öffentlich bestätigt</td></tr><tr><td>Vater</td><td>Jürgen Drews</td></tr></table>', '');
    expect(rows.map((r) => r.attribute)).toEqual(['Vollständiger Name', 'Beruf', 'Vater']);
  });

  it('uses German section titles and recognises German headings from ChatGPT', () => {
    const body = cleanChatGPTHtml('<h2>Einleitung</h2><p>Fabian Drews ist der Sohn von Jürgen Drews.</p><h2>Karriere</h2><p>Text.</p><h2>Häufig gestellte Fragen</h2><p>Doppelt.</p><h2>Fazit</h2><p>Schluss.</p>');
    const { html, hasConclusion } = assembleArticle({
      bodyHtml: body,
      faqs: [{ question: 'Wer ist Fabian Drews?', answer: 'Der Sohn von Jürgen Drews.' }],
      quickBio: [{ attribute: 'Vater', details: 'Jürgen Drews' }],
      subjectName: 'Fabian Drews',
      locale: 'de',
    });
    expect(html).toContain('<h2>Kurzbiografie von Fabian Drews</h2>');
    expect(html).toContain('<th>Attribut</th><th>Details</th>');
    expect(html).toContain('<h2>Häufig gestellte Fragen</h2>');
    expect(html).not.toContain('Häufig gestellte Fragen zu');
    expect(html).not.toContain('Doppelt.');
    expect(html).not.toContain('Einleitung');
    expect(hasConclusion).toBe(true);
    expect(html.trim().endsWith('<p>Schluss.</p>')).toBe(true);
  });

  it('does not repeat the table header when ChatGPT writes "Attribut | Details" as a row', () => {
    const rows = parseQuickBio('<table><tr><td>Attribut</td><td>Details</td></tr><tr><td>Vollständiger Name</td><td>Duke Keaton</td></tr><tr><td>Mutter</td><td>Diane Keaton</td></tr></table>', '');
    expect(rows.map((r) => r.attribute)).toEqual(['Vollständiger Name', 'Mutter']);

    // Rows saved by an older version still contain the header row: it is dropped when the article is assembled.
    const { html } = assembleArticle({
      bodyHtml: '<p>Einleitung.</p><h2>Leben</h2><p>Text.</p>',
      faqs: [],
      quickBio: [
        { attribute: 'Attribut', details: 'Details' },
        { attribute: 'Vollständiger Name', details: 'Duke Keaton' },
      ],
      subjectName: 'Duke Keaton',
      locale: 'de',
    });
    expect(html.match(/Attribut/g)).toHaveLength(1);
    expect(html).toContain('<td><strong>Vollständiger Name</strong></td>');
  });

  it('builds German SEO title and meta description fallbacks', () => {
    expect(buildSeoTitle('', 'Fabian Drews', 60, 'de')).toBe('Fabian Drews');
    const meta = buildMetaDescription({ introText: '', keyword: 'Fabian Drews', subjectName: 'Fabian Drews', locale: 'de' });
    expect(meta.length).toBeGreaterThanOrEqual(120);
    expect(meta.length).toBeLessThanOrEqual(160);
    expect(meta).toMatch(/Fabian Drews/);
    expect(meta).toMatch(/Vermögen|Familie/);
  });
});
