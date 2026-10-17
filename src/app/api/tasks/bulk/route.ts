import { parseBody, route } from '@/lib/api';
import { performBulkTaskAction } from '@/lib/services/tasks';
import { bulkTaskActionSchema } from '@/lib/validation';

/** Article History bulk actions: send to WordPress, retry, SEO check, assign website, cancel or delete many articles. */
export const POST = route(async (req) => {
  const input = await parseBody(req, bulkTaskActionSchema);
  return performBulkTaskAction(input);
});
