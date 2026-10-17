import type { ArticleTask, Prisma } from '@prisma/client';
import { CELEBRITY2_MAX_WORDS, CELEBRITY2_MODULE_KEY } from '@/modules/celebrity-writer-2/manifest';
import { prisma } from '../db';
import { getSettings } from '../settings';
import type { AppSettings } from '../settings-schema';
import { assembleArticle } from '@/content/assembly';
import { contentLocale } from '../content-locale';
import type { FaqItem } from '@/content/faqs';
import type { BioRow } from '@/content/quick-bio';
import { deriveSubjectName } from '@/content/seo-meta';
import { runSeoChecks, type SeoReportResult } from '@/seo/checker';
import { asStringArray } from '../json';

export function asFaqs(value: Prisma.JsonValue | null | undefined): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { question: string; answer: string } => {
      const o = v as Record<string, unknown> | null;
      return Boolean(o && typeof o.question === 'string' && typeof o.answer === 'string');
    })
    .map((v) => ({ question: v.question, answer: v.answer }));
}

export function asBioRows(value: Prisma.JsonValue | null | undefined): BioRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { attribute: string; details: string } => {
      const o = v as Record<string, unknown> | null;
      return Boolean(o && typeof o.attribute === 'string' && typeof o.details === 'string');
    })
    .map((v) => ({ attribute: v.attribute, details: v.details }));
}

/** Rebuilds the full article (Intro → Quick Bio → Body → FAQs → Conclusion) from its stored parts. */
export function assembleTaskContent(task: Pick<ArticleTask, 'bodyHtml' | 'faqs' | 'quickBio' | 'keyword' | 'language'>): string | null {
  if (!task.bodyHtml) return null;
  const quickBio = asBioRows(task.quickBio);
  return assembleArticle({
    bodyHtml: task.bodyHtml,
    faqs: asFaqs(task.faqs),
    quickBio,
    subjectName: deriveSubjectName(task.keyword, quickBio),
    locale: contentLocale(task.language),
  }).html;
}

/** Re-assembles the article, runs the internal SEO checker and stores metrics + a report. */
export async function runInternalSeoCheck(taskId: string, settings?: AppSettings): Promise<SeoReportResult> {
  const s = settings ?? (await getSettings());
  const task = await prisma.articleTask.findUniqueOrThrow({ where: { id: taskId } });
  const contentHtml = assembleTaskContent(task) ?? task.contentHtml ?? '';

  const report = runSeoChecks({
    locale: contentLocale(task.language ?? s.defaultLanguage),
    keyword: task.keyword,
    articleTitle: task.selectedTitle,
    seoTitle: task.seoTitle,
    slug: task.slug,
    metaDescription: task.metaDescription,
    contentHtml,
    faqs: asFaqs(task.faqs),
    quickBio: asBioRows(task.quickBio),
    categoryName: task.categoryName,
    tags: asStringArray(task.tags),
    settings: {
      // Celebrity Writer 2.0 asks ChatGPT for 1,400–2,000 words.
      maxArticleWordCount: task.moduleKey === CELEBRITY2_MODULE_KEY ? Math.max(s.maxArticleWordCount, CELEBRITY2_MAX_WORDS) : s.maxArticleWordCount,
      minKeywordOccurrences: s.minKeywordOccurrences,
      maxKeywordOccurrences: s.maxKeywordOccurrences,
      faqCount: s.faqCount,
    },
  });

  await prisma.$transaction([
    prisma.articleTask.update({
      where: { id: taskId },
      data: {
        contentHtml,
        wordCount: report.metrics.wordCount,
        keywordCount: report.metrics.keywordCount,
        keywordDensity: report.metrics.keywordDensity,
        h2Count: report.metrics.h2Count,
        h3Count: report.metrics.h3Count,
        seoScore: report.score,
      },
    }),
    prisma.sEOReport.create({
      data: {
        taskId,
        source: 'INTERNAL',
        score: report.score,
        checks: report.checks as unknown as Prisma.InputJsonValue,
        metrics: report.metrics as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  return report;
}
