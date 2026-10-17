import { z } from 'zod';
import { parseBody, route } from '@/lib/api';
import { contentLocale } from '@/lib/content-locale';
import { prisma } from '@/lib/db';
import { checkPlagiarism } from '@/content/plagiarism/check';
import { fetchPage, searchGoogle, searchWikipedia, serperKey, wikipediaPage } from '@/content/plagiarism/sources';

const schema = z.object({
  input: z.string().trim().min(40, 'Paste an article of at least a few sentences').max(300_000, 'The article is too long'),
  keyword: z.string().trim().max(200).optional(),
  /** The article's task when it was loaded from the list: it is then not compared with itself. */
  taskId: z.string().max(40).optional(),
  urls: z.array(z.string().trim().url('Each extra page must be a full web address (https://…)')).max(10).optional(),
  language: z.enum(['auto', 'en', 'de']).optional(),
  /** Search Google through serper.dev (one credit per searched phrase). */
  google: z.boolean().optional(),
});

const host = (url: string | null | undefined) => {
  try {
    return url ? new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/** The plagiarism check (test): runs right here, no ChatGPT — only public pages and Wikipedia's API are read. */
export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const [tasks, websites, task] = await Promise.all([
    prisma.articleTask.findMany({
      where: { OR: [{ contentHtml: { not: null } }, { bodyHtml: { not: null } }], ...(body.taskId ? { id: { not: body.taskId } } : {}) },
      select: { id: true, keyword: true, contentHtml: true, bodyHtml: true, website: { select: { name: true } } },
    }),
    prisma.website.findMany({ select: { url: true, adminUrl: true } }),
    body.taskId ? prisma.articleTask.findUnique({ where: { id: body.taskId }, select: { language: true } }) : null,
  ]);
  const language = body.language && body.language !== 'auto' ? body.language : task?.language ? contentLocale(task.language) : undefined;
  return checkPlagiarism({
    input: body.input,
    keyword: body.keyword || undefined,
    language: language === 'de' ? 'de' : language === 'en' ? 'en' : undefined,
    urls: body.urls,
    ownArticles: tasks.map((t) => ({ id: t.id, title: `${t.keyword}${t.website ? ` — ${t.website.name}` : ''}`, html: t.contentHtml || t.bodyHtml || '' })),
    ownHosts: websites.flatMap((w) => [host(w.url), host(w.adminUrl)]).filter((h): h is string => Boolean(h)),
    fetchPage,
    searchWikipedia,
    wikipediaPage,
    ...(body.google !== false && serperKey() ? { searchWeb: searchGoogle } : {}),
  });
});

/** Whether Google can be searched (a serper.dev key is in .env). */
export const GET = route(async () => ({ google: Boolean(serperKey()) }));
