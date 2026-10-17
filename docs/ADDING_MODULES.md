# Adding a new dashboard module

The dashboard is built so that new writers and SEO tools reuse the shared infrastructure:

| Shared piece | Where | What you get for free |
| --- | --- | --- |
| Queue + worker | `src/lib/queue.ts`, `src/worker/*` | Built-in database queue, concurrency, one job per task, crash recovery |
| Pipeline engine | `src/automation/pipeline/*` | Ordered stages, per-stage persistence, retries, resume from last completed stage, `LOGIN_REQUIRED` handling, failure screenshots, cancellation |
| ChatGPT browser client | `src/automation/chatgpt/*` | One conversation per task, completion detection, duplicate-safe retries |
| WordPress browser client | `src/automation/wordpress/*` | Login detection, Add New Post, content paste, categories, tags, slug, Save Draft, Rank Math, publish guard |
| Prompt Manager | `src/lib/services/prompts.ts`, `/prompts` page | Editable templates with `{{variables}}` and `{{#if}}` blocks |
| SEO toolkit | `src/seo/*`, `src/content/*` | Keyword counter, SEO checker, HTML cleanup, FAQ / table parsing, meta helpers |
| UI kit | `src/components/*` | Cards, tables, status badges, editor, log viewer, session buttons |

A module has four parts.

## 1. Manifest (client-safe)

Create `src/modules/<module-key>/manifest.ts`:

```ts
import type { ModuleManifest } from '../types';
import { NEWS_PROMPTS, NEWS_VARIABLES } from './prompts';

export const newsWriterManifest: ModuleManifest = {
  key: 'news-writer',
  name: 'News Writer',
  description: 'Timely news articles from current sources.',
  icon: 'newspaper',
  href: '/modules/news-writer',
  status: 'active',
  group: 'Writers',
  stages: [
    { key: 'OUTLINE', label: 'Outline', kind: 'chatgpt', regenerable: true, promptKey: 'outline' },
    { key: 'ARTICLE', label: 'Article', kind: 'chatgpt', regenerable: true, promptKey: 'article' },
    { key: 'SEO_CHECK', label: 'SEO Check', kind: 'local' },
    { key: 'WORDPRESS_DRAFT', label: 'WordPress Draft', kind: 'wordpress' },
  ],
  prompts: NEWS_PROMPTS,       // [{ key, name, description, defaultContent }]
  variables: NEWS_VARIABLES,   // documented {{variables}} shown in the Prompt Manager
};
```

Manifests must not import server code (Prisma, Playwright). They are used by the sidebar, dashboard, Prompt Manager and regenerate menus.

## 2. Register it

In `src/modules/registry.ts` replace the `comingSoon('news-writer', …)` entry with your manifest. The sidebar, dashboard module grid and Prompt Manager pick it up automatically, and the default prompts are inserted into the database on the next worker start or Prompt Manager visit.

## 3. Pipeline (worker-only)

Create `src/modules/<module-key>/pipeline.ts` implementing `PipelineDefinition` (see `src/automation/pipeline/types.ts` and the Celebrity Writer pipeline as a reference):

```ts
const outline: PipelineStage = {
  key: 'OUTLINE', label: 'Outline', kind: 'chatgpt', status: 'RESEARCHING', progress: 30,
  async run(ctx) {
    const { prompt, answer } = await ctx.askChatGPT('OUTLINE', 'outline');
    return { outcome: 'completed', prompt, output: answer.text, outputHtml: answer.html };
  },
};
```

Useful context helpers:

- `ctx.askChatGPT(stageKey, promptKey, extraVars?)` – renders the template, sends it in the task's conversation, stores the response.
- `ctx.wordpress()` – a logged-in `WordPressClient` for the task's website (publish guard installed).
- `ctx.update(data)` / `ctx.reload()` – persist task fields.
- Throw `GenerationError` for retryable problems, `ConfigurationError` for user-fixable ones. `LoginRequiredError` is raised by the clients automatically.
- Return `{ outcome: 'paused', status: 'NEEDS_REVIEW', message }` to wait for the user.

Register it in `src/modules/pipelines.server.ts`:

```ts
export const PIPELINES = {
  [celebrityPipeline.moduleKey]: celebrityPipeline,
  [newsPipeline.moduleKey]: newsPipeline,
};
```

## 4. Page

Add `src/app/(dashboard)/modules/<module-key>/page.tsx`. The simplest approach is to copy the Celebrity Writer page and adjust the form fields. Create tasks with `POST /api/tasks` and `moduleKey: '<module-key>'`. The Article Queue, History, detail page, editor, logs and SEO report work for any module.

## Adding task statuses or database fields

Task statuses live in both `prisma/schema.prisma` (`TaskStatus`) and `src/lib/task-status.ts`. After changing the schema, stop the app and run:

```bash
npx prisma migrate dev --name <change-name>
```

Users of an existing install then apply it with `npm run setup`.

Module-specific data that doesn't deserve a column can be stored in `ArticleStage.data` (JSON).
