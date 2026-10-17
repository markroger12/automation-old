// The Plagiarism Check page and its report render without errors, with a real report from fake sources.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkPlagiarism } from '@/content/plagiarism/check';
import { MarkedArticle, SourceList, Summary } from '@/components/plagiarism/report';
import { ToastProvider } from '@/components/ui/toast';
import PlagiarismPage from '@/app/(dashboard)/plagiarism/page';

const render = (node: ReturnType<typeof createElement>) => renderToString(createElement(ToastProvider, null, node));

describe('the Plagiarism Check page', () => {
  it('renders the empty page', () => {
    const html = render(createElement(PlagiarismPage));
    expect(html).toContain('Plagiarism Check (test)');
    expect(html).toContain('Check for plagiarism');
  });

  it('renders a report with marked text and its sources', async () => {
    const source = 'Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley. She raised six children with her husband Edward. The family later moved to Los Angeles so that Jenna could attend auditions more easily and meet casting agents.';
    const report = await checkPlagiarism({
      input: '<p>Natalie Ortega worked for many years as an emergency room nurse in the Coachella Valley. She is proud of <a href="https://news.test/a">her daughter</a>.</p>',
      ownArticles: [],
      fetchPage: async (url) => ({ title: 'News', text: source, url }),
    }).catch(() => null);
    expect(report).not.toBeNull();
    const html = render(createElement('div', null, createElement(Summary, { report: report! }), createElement(MarkedArticle, { report: report! }), createElement(SourceList, { report: report! })));
    expect(html).toContain('<mark');
    expect(html).toContain('Linked page');
    expect(html).toContain('of the article');
  });
});
