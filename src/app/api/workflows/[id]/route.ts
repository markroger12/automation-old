import { param, parseBody, route } from '@/lib/api';
import { updateWorkflow, workflowKeywords } from '@/lib/services/workflow';
import { workflowSettingsSchema } from '@/lib/validation';
import { localStamp12, WORKFLOW_TIMEZONE } from '@/lib/workflow/time';

/** The workflow with its keyword list and the plan: which keyword goes live when. */
export const GET = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  const { workflow, keywords, plan } = await workflowKeywords(id);
  return {
    workflow,
    keywords: keywords.map((row) => ({
      id: row.id,
      keyword: row.keyword,
      title: row.title,
      secondaryKeywords: row.secondaryKeywords,
      kind: row.kind,
      kindSource: row.kindSource,
      kindNote: row.kindNote,
      state: row.state,
      attempts: row.attempts,
      lastError: row.lastError,
      publishedUrl: row.publishedUrl,
      publishedAt: row.publishedAt,
      indexedAt: row.indexedAt,
      indexingEvidence: row.indexingEvidence,
      task: row.task,
      // Both as the Pakistan clock shows them, which is how the times are set.
      publishAt: row.publishAt ? localStamp12(row.publishAt, WORKFLOW_TIMEZONE) : null,
      plannedFor: plan.has(row.id) ? localStamp12(plan.get(row.id)!, WORKFLOW_TIMEZONE) : null,
    })),
  };
});

export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, workflowSettingsSchema);
  return { workflow: await updateWorkflow(id, input) };
});
