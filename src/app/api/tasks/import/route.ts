import Papa from 'papaparse';
import { prisma } from '@/lib/db';
import { HttpError, route } from '@/lib/api';
import { createArticleTasks } from '@/lib/services/tasks';
import { createTaskSchema, type CreateTaskInput } from '@/lib/validation';

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 1000;

type Row = Record<string, string | undefined>;

function pick(row: Row, ...names: string[]): string {
  for (const name of names) {
    const v = row[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * CSV bulk import. Columns: keyword, example_title, website, category, secondary_keywords
 * (optional: target_country, language). One article task per row.
 */
export const POST = route(async (req, _ctx, session) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Upload a CSV file in the "file" field');
  if (file.size > MAX_BYTES) throw new HttpError(400, 'CSV file is larger than 1 MB');
  const moduleKey = typeof form?.get('moduleKey') === 'string' ? String(form.get('moduleKey')) : 'celebrity-writer';

  const text = await file.text();
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'),
  });
  if (!parsed.meta.fields?.includes('keyword')) throw new HttpError(400, 'The CSV must contain a "keyword" column');
  if (parsed.data.length > MAX_ROWS) throw new HttpError(400, `A maximum of ${MAX_ROWS} rows can be imported at once`);

  const websites = await prisma.website.findMany({ include: { categories: true } });
  const errors: { row: number; message: string }[] = [];
  const inputs: CreateTaskInput[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 2; // header is row 1
    const websiteRef = pick(row, 'website', 'website_name', 'site');
    let websiteId: string | null = null;
    let categoryId: string | null = null;

    if (websiteRef) {
      const ref = websiteRef.toLowerCase();
      const site = websites.find((w) => {
        let host = '';
        try {
          host = new URL(w.url).host.toLowerCase();
        } catch {
          /* ignore */
        }
        return w.id === websiteRef || w.name.toLowerCase() === ref || host === ref.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      });
      if (!site) {
        errors.push({ row: rowNumber, message: `Website "${websiteRef}" not found` });
        continue;
      }
      websiteId = site.id;
      const categoryName = pick(row, 'category');
      if (categoryName) {
        let category = site.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) {
          category = await prisma.category.create({ data: { websiteId: site.id, name: categoryName.slice(0, 100) } });
          site.categories.push(category);
        }
        categoryId = category.id;
      }
    }

    const candidate = createTaskSchema.safeParse({
      moduleKey,
      keyword: pick(row, 'keyword'),
      exampleTitle: pick(row, 'example_title', 'title'),
      websiteId,
      categoryId,
      secondaryKeywords: pick(row, 'secondary_keywords', 'secondary'),
      targetCountry: pick(row, 'target_country', 'country') || null,
      language: pick(row, 'language', 'article_language') || null,
    });
    if (!candidate.success) {
      errors.push({ row: rowNumber, message: candidate.error.issues[0]?.message ?? 'Invalid row' });
      continue;
    }
    inputs.push(candidate.data);
  }

  const result = inputs.length ? await createArticleTasks(inputs, session.userId) : { tasks: [], warning: null };
  return { created: result.tasks.length, errors, warning: result.warning };
});
