import { z } from 'zod';
import { parseBody, route } from '@/lib/api';
import { analyseDocument } from '@/content/humanizer/analyse';
import { parseDocument, plainText } from '@/content/humanizer/blocks';

const schema = z.object({
  input: z.string().max(300_000, 'The article is too long'),
  keyword: z.string().trim().max(200).optional(),
});

/** The local check only: no ChatGPT, answers at once. */
export const POST = route(async (req) => {
  const { input, keyword } = await parseBody(req, schema);
  const doc = parseDocument(input);
  const report = analyseDocument(doc, keyword);
  return {
    format: doc.format,
    report,
    texts: report.paragraphReports.map((p) => plainText(doc.blocks[p.block].text)),
  };
});
