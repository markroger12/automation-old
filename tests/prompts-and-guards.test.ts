import { describe, expect, it } from 'vitest';
import { renderPrompt, extractVariables } from '@/lib/prompts/render';
import { CELEBRITY_PROMPTS } from '@/modules/celebrity-writer/prompts';
import { CELEBRITY_VARIABLES } from '@/modules/celebrity-writer/prompts';
import { isPublishingRequest } from '@/automation/wordpress/publish-guard';
import { planRankMathFixes } from '@/automation/wordpress/rankmath-fixes';
import { normalizeAdminUrl } from '@/lib/wp-url';
import { redact } from '@/lib/logger';

describe('renderPrompt', () => {
  it('replaces variables and handles conditionals', () => {
    const tpl = 'Keyword: "{{keyword}}"\n{{#if example_title}}Example: {{example_title}}{{/if}}\n{{#unless example_title}}No example{{/unless}}';
    expect(renderPrompt(tpl, { keyword: 'Zendaya', example_title: 'Zendaya Age' })).toBe('Keyword: "Zendaya"\nExample: Zendaya Age');
    expect(renderPrompt(tpl, { keyword: 'Zendaya', example_title: '' })).toBe('Keyword: "Zendaya"\n\nNo example');
  });

  it('renders every default celebrity prompt without leftover template syntax', () => {
    const vars = Object.fromEntries(CELEBRITY_VARIABLES.map((v) => [v.name, v.sample]));
    for (const prompt of CELEBRITY_PROMPTS) {
      const out = renderPrompt(prompt.defaultContent, vars);
      expect(out, prompt.key).not.toMatch(/\{\{|\}\}/);
      for (const name of extractVariables(prompt.defaultContent)) {
        expect(CELEBRITY_VARIABLES.some((v) => v.name === name), `${prompt.key} uses undocumented {{${name}}}`).toBe(true);
      }
    }
  });

  it('keeps the exact user-specified wording in the title prompt', () => {
    const out = renderPrompt(CELEBRITY_PROMPTS[0].defaultContent, { keyword: 'Sydney Sweeney', example_title: 'Sydney Sweeney Age', language: 'English' });
    expect(out).toContain('Generate some best titles for my blog post.');
    expect(out).toContain('"Sydney Sweeney"');
    expect(out).toContain('At the end, clearly recommend the strongest title to use.');
  });
});

describe('publish guard', () => {
  it('blocks publish/schedule/review requests from the block editor', () => {
    expect(isPublishingRequest('POST', 'https://s.com/wp-json/wp/v2/posts/12?_locale=user', '{"status":"publish","title":"x"}')).toBe(true);
    expect(isPublishingRequest('PUT', 'https://s.com/wp-json/wp/v2/posts/12', '{"status": "future"}')).toBe(true);
    expect(isPublishingRequest('POST', 'https://s.com/?rest_route=%2Fwp%2Fv2%2Fposts%2F12', '{"status":"pending"}')).toBe(true);
  });

  it('allows draft saves, autosaves and content that merely mentions publishing', () => {
    expect(isPublishingRequest('POST', 'https://s.com/wp-json/wp/v2/posts/12', '{"status":"draft","content":"How to \\"status\\":\\"publish\\""}')).toBe(false);
    expect(isPublishingRequest('POST', 'https://s.com/wp-json/wp/v2/posts/12/autosaves', '{"status":"publish"}')).toBe(false);
    expect(isPublishingRequest('GET', 'https://s.com/wp-json/wp/v2/posts/12', null)).toBe(false);
  });

  it('blocks the classic editor Publish button but not Save Draft', () => {
    expect(isPublishingRequest('POST', 'https://s.com/wp-admin/post.php', 'post_ID=5&original_publish=Publish&publish=Publish')).toBe(true);
    expect(isPublishingRequest('POST', 'https://s.com/wp-admin/post.php', 'post_ID=5&original_publish=Publish&save=Save+Draft&post_status=draft')).toBe(false);
  });
});

describe('Rank Math fix planning', () => {
  const input = {
    keyword: 'Sydney Sweeney',
    articleTitle: 'The Rise of Sydney Sweeney: Career, Family and Net Worth',
    seoTitle: 'The Rise of a Hollywood Star',
    metaDescription: 'A short description.',
    slug: 'the-rise-of-a-star',
    introText: 'Sydney Sweeney is an American actress who rose to fame with Euphoria and The White Lotus, earning Emmy nominations along the way and many new fans.',
    subjectName: 'Sydney Sweeney',
  };

  it('maps recommendations to bounded corrections', () => {
    const plan = planRankMathFixes(
      [
        'Focus Keyword does not appear in the SEO title.',
        'Add Focus Keyword to your SEO Meta Description.',
        'Use Focus Keyword in the URL.',
        'Use Focus Keyword at the beginning of your content.',
        'Add an image with your Focus Keyword as alt text.',
        'Your title doesn’t contain a power word. Add at least one.',
        'Link out to external resources.',
      ],
      input,
    );
    expect(plan.seoTitle).toMatch(/^Sydney Sweeney/);
    expect(plan.seoTitle!.length).toBeLessThanOrEqual(60);
    expect(plan.metaDescription).toContain('Sydney Sweeney');
    expect(plan.slug).toBe('sydney-sweeney');
    expect(plan.contentIssues).toEqual(['Use Focus Keyword at the beginning of your content.']);
    expect(plan.manualIssues).toHaveLength(3);
  });
});

describe('misc helpers', () => {
  it('normalizes WordPress admin URLs', () => {
    expect(normalizeAdminUrl('https://example.com/')).toBe('https://example.com/wp-admin/');
    expect(normalizeAdminUrl('https://example.com', 'https://example.com/wp-admin')).toBe('https://example.com/wp-admin/');
    expect(normalizeAdminUrl('https://example.com/blog', 'https://example.com/blog/wp-admin/index.php')).toBe('https://example.com/blog/wp-admin/');
  });

  it('redacts credential-like fields in logs', () => {
    expect(redact({ password: 'x', nested: { apiKey: 'y', cookie: 'z', prompt: 'keep' } })).toEqual({
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', cookie: '[REDACTED]', prompt: 'keep' },
    });
  });
});
