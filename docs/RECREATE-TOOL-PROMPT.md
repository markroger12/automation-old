# Prompt: Build "Blog Automation Studio" from scratch

> Copy everything below the line into a new AI coding session (Claude Code or similar) in an empty folder.
> It describes the whole tool as it stands on 9 October 2026, including the problems already solved, so the new build
> does not have to rediscover them. Secrets (passwords, API keys) are not included — they go into `.env` by hand.

---

## 1. Your role and the goal

You are a senior full-stack TypeScript engineer. Build **Blog Automation Studio**: a self-hosted dashboard that runs
on one Windows PC. It writes SEO blog articles with **the ChatGPT website** (not the OpenAI API) and saves them as
**WordPress drafts** with Rank Math SEO fields filled in. Optionally, it schedules them, publishes them and asks Google
to index them.

The owner runs several WordPress sites:
- English celebrity/biography sites (for example Info Folks, Peak Buzz, Laraix).
- A German site (Promizeiten.de).

They queue keywords (often hundreds), and the tool writes the articles unattended, a few at the same time.

Work in small, tested steps. After every milestone the app must run with `npm run dev:all` and the tests must pass.

## 2. Hard rules (non-negotiable)

1. **ChatGPT only, through its website.** Do not use the OpenAI API, any other AI provider, or Codex. Never mention
   "API" options to the owner. The owner has a ChatGPT subscription.
2. **ChatGPT runs through our own Chrome extension (Manifest V3) in a real Chrome.** Cloudflare blocks
   Playwright-launched browsers on chatgpt.com with "Verify you are human".
   - No stealth plugins, no webdriver hiding, no CAPTCHA solving, no CDP tricks.
   - When ChatGPT asks for a login or a human check, the extension shows a desktop notification and waits up to 10
     minutes for the person to do it.
3. **WordPress runs through Playwright with saved Chrome profiles**, one per website. The person logs in once by
   hand. No passwords or Application Passwords are stored. The app never types credentials.
4. **Drafts only by default.** A network-level *publish guard* aborts every editor request that would publish,
   schedule, make private or submit for review.
   - The only exception is the Workflow scheduler, for a website whose owner switched on "This website may publish by
     itself".
5. **Runs locally with nothing extra.** Node.js 20.9+ and Google Chrome only.
   - No Docker, PostgreSQL or Redis.
   - The database is one SQLite file, and the job queue is a table in it.
6. **Never overwrite a prompt the user edited.** Default prompts are seeded once. Later default changes only update
   rows that are still byte-identical to the old default.
7. **Every stage is resumable.** A crash, a restart, a login expiry or a retry continues from the last completed stage
   and never duplicates a ChatGPT prompt or a WordPress post.
8. **Missing optional tools never stop an article.** This covers the face detector, the upscaler and the photo check.
   They only produce a warning and the old behaviour.
9. The dashboard UI is in English. Articles are written in each website's language (English or German).

## 3. Tech stack

- **Next.js 15 (App Router) + React 19 + Tailwind CSS 4** for the dashboard on `http://localhost:3000`.
- **TypeScript 5.9 (strict)** everywhere. Use **Zod** for every API input and the settings schema.
- **Prisma 6 + SQLite** (`data/app.db`, `DATABASE_URL="file:../data/app.db"`).
- **Worker:** a separate Node process run with `tsx` (`tsx watch` in development).
- **Playwright 1.6x** using the installed **Google Chrome** channel (`BROWSER_CHANNEL=chrome|msedge|chromium`).
- **Libraries:**
  - `cheerio` for HTML parsing.
  - `sanitize-html` for the allow-list sanitizer.
  - `marked` for Markdown to HTML.
  - `papaparse` for CSV.
  - `bcryptjs` and `jose` for authentication.
  - `sharp` for images. On Windows, always pass buffers, never paths, or files stay locked.
  - `lucide-react` for icons.
  - `concurrently` to run web + worker together.
- **Vitest** for unit tests. Browser tests run the real extension against a fake ChatGPT page in Chrome or Edge.
- **Scripts:** `setup`, `dev`, `worker:dev`, `dev:all`, `build`, `start:all`, `db:*`, `user:create`, `typecheck`,
  `test`.
- `npm run setup` must be safe to re-run. It:
  1. creates `.env` with a random `SESSION_SECRET`;
  2. creates `data/`;
  3. runs migrations;
  4. seeds settings and prompts;
  5. checks Chrome is installed.

## 4. Architecture

```
Dashboard (Next.js :3000)  ──adds jobs──►  data/app.db (SQLite)  ◄──claims jobs──  Worker (Node + Playwright)
        ▲                                   tasks, stages, prompts,                  • article pipelines
        │ /api/extension/agent              responses, logs, queue                   • WordPress automation
        │ (Bearer connection key)                                                    • workflow scheduler
ChatGPT Worker extension (MV3) in the separate "Automation Chrome" (data/chatgpt-chrome) on chatgpt.com
```

- **Only the worker opens browsers.** Only one worker may run per `data/` folder. Enforce this with a heartbeat row
  plus a PID liveness check.
- **ChatGPT prompts are queue jobs**, kept as rows in queue `chatgpt`:
  1. The worker creates the job.
  2. The extension claims it, sends the prompt on chatgpt.com, reports progress, and completes or fails it through
     `POST /api/extension/agent`.
  3. The worker polls the row until it is done.
- **Queues in the `QueueJob` table:** `article` (pipeline runs), `chatgpt` (prompts for the extension), `control`
  (browser session actions), `workflow` (schedule-post, request-indexing) and `humanizer` (test page jobs).
- Every job type has a heartbeat. A job left ACTIVE by a dead worker is re-queued (article) or failed (others) on the
  next start.

## 5. Data model (Prisma)

**User**
- id, email (unique), name, passwordHash (bcrypt), role ADMIN|EDITOR, lastLoginAt.

**BrowserProfile**
- id, name, kind CHATGPT|WORDPRESS|GENERIC.
- directory: a folder name inside `data/profiles`.
- sessionStatus UNKNOWN|ACTIVE|LOGIN_REQUIRED|ERROR, sessionDetail, lastCheckedAt, lastLoginAt.

**Website**
- name, url, adminUrl, profileId, defaultCategoryId, editorType AUTO|GUTENBERG|CLASSIC, isActive.
- celebrityImages and tigramImages (booleans).
- Image template fields: logoFile, accentColour, logoPosition, featuredStyle ("split"|"single"), imageTemplate (JSON
  design).
- canPublish (default false), siteTimezone, searchConsoleProperty.
- An internal-link line text per site, for example "Also read:" or "Das könnte Ihnen gefallen:".

**Category**
- websiteId, name (unique per website).
- Read from WordPress. Never typed by hand unless needed.

**ArticleTask**
- Input: moduleKey, keyword, exampleTitle, secondaryKeywords (JSON array), targetCountry, language, websiteId,
  categoryId, categoryName snapshot.
- Status: status (enum below), currentStage, progress 0–100, statusMessage, reviewReasons (JSON),
  loginRequiredFor ("chatgpt"|"wordpress"), error, cancelRequested.
- Titles: titleOptions, recommendedTitle, selectedTitle, titleApprovedAt, articleApprovedAt.
- Content: bodyHtml (the article body) and contentHtml (the fully assembled article sent to WordPress), faqs (JSON),
  quickBio (JSON rows).
- SEO fields: seoTitle, metaDescription, slug, focusKeyword, tags.
- Metrics: wordCount, keywordCount, keywordDensity, h2Count, h3Count, seoScore, rankMathScore.
- Links: chatgptConversationUrl, wpPostId, wpEditUrl, wpDraftSavedAt.
- Timestamps.

**TaskStatus enum**
- QUEUED, OPENING_CHATGPT, GENERATING_TITLES, AWAITING_TITLE_APPROVAL, RESEARCHING, WRITING_ARTICLE, OPTIMIZING,
  GENERATING_FAQS, GENERATING_BIO_TABLE, SEO_CHECKING, AWAITING_ARTICLE_APPROVAL, OPENING_WORDPRESS, CREATING_DRAFT,
  RUNNING_RANKMATH, DRAFT_CREATED, NEEDS_REVIEW, LOGIN_REQUIRED, FAILED, CANCELLED.

**ArticleStage**
- taskId + key (unique), label, position.
- status PENDING|RUNNING|COMPLETED|FAILED|SKIPPED, attempts.
- prompt, output, outputHtml, data (JSON, stage-private state such as image sources or the humanizer
  original/output), error, startedAt, completedAt.

**ChatGPTResponse**
- taskId, stageKey, attempt, prompt, responseText, responseHtml, conversationUrl, reusedExisting, durationMs.

**PromptTemplate**
- moduleKey + key (unique), name, description, content.

**Setting**
- key, value (JSON).

**Log**
- taskId, level DEBUG|INFO|WARN|ERROR.
- category: SYSTEM|BROWSER|CHATGPT|WORDPRESS|RANKMATH|SEO|QUEUE|SESSION.
- stage, message, data (JSON), screenshotPath.

**QueueJob**
- queue, name, taskId, data (JSON), status WAITING|ACTIVE|COMPLETED|FAILED, result (JSON), error, attempts, lockedBy,
  heartbeatAt.
- runAt: do not pick the job up before this time.
- createdAt, startedAt, finishedAt.

**WorkerStatus**
- id, lastSeenAt, info.
- Rows: one for the worker and one for the extension.

**SEOReport**
- taskId, source INTERNAL|RANKMATH, score, checks, metrics.

**Workflow**
- One per website.
- isActive.
- publishTimes: "HH:MM" in Pakistan time, one article per time.
- days: 0 = Sunday; empty means every day.
- writeAheadHours: 0 means "as soon as added".
- images: null means follow the website.
- indexAfterPublish.

**WorkflowKeyword**
- keyword, title, secondaryKeywords.
- kind UNKNOWN|CELEBRITY|TIGRAM, kindSource, kindNote.
- state WAITING|WRITING|READY|SCHEDULED|PUBLISHED|INDEXED|FAILED|SKIPPED|DONE.
- taskId, publishAt (UTC), publishedUrl, publishedAt, indexedAt, lastError, attempts, position.

## 6. Pipeline engine (worker)

Modules are pluggable:
- A **client-safe manifest** (key, name, icon, href, status active|coming-soon, group Writers|SEO Tools, stage
  descriptors, prompt definitions with defaults, documented variables).
- A **server-side pipeline**, registered separately.

```ts
interface PipelineStage {
  key: string; label: string; kind: 'chatgpt' | 'local' | 'gate' | 'wordpress';
  status: TaskStatus;      // shown while running
  progress: number;        // after completion
  run(ctx): Promise<{ outcome: 'completed'; prompt?; output?; outputHtml?; data? } | { outcome: 'paused'; status; message }>;
}
interface PipelineDefinition {
  moduleKey; stages; regenerationPlan(stageKey, task): string[]; variables(ctx, extra);
  contextPrimer?(ctx, stageKey): Promise<string | null>; finalize(ctx); afterRegeneration(ctx, stageKey);
}
```

**`runPipeline`**
- Creates any missing stage rows, then skips COMPLETED or SKIPPED stages and runs the rest in order.
- Each stage is retried `retryAttempts` times with backoff `min(30 s, 4 s × attempt)` and a failure screenshot.
- A `paused` outcome sets an approval status and stops.
- `LoginRequiredError` gives status LOGIN_REQUIRED, not FAILED. The task resumes automatically after the session is
  fixed.
- `TaskCancelledError` gives CANCELLED.
- Other errors give FAILED with the message.
- Regenerate mode resets the stages from `regenerationPlan` and runs only those.

**`PipelineContext.askChatGPT(stageKey, promptKey, extra, { images, attachments, fresh, newChat })`**
1. Renders the prompt template with `{{var}}`, `{{#if x}}…{{/if}}` and `{{#unless x}}…{{/unless}}`.
2. Appends a language line ("Write in German for readers in Germany") unless the prompt asks for pictures.
3. All prompts of one article go into **one ChatGPT conversation**. Its URL is saved on the task.
4. `allowReuse = !fresh && (mode === 'run' || attempt > 1 || alreadySentThisJob)`. When the conversation's last user
   message already is this prompt, its answer is recovered instead of the prompt being sent again.
5. On `ConversationLostError` (the saved chat cannot be opened), start a new chat. Prefix the prompt with a
   **context primer** built from earlier stage outputs (research, article and so on).
6. Saves a ChatGPTResponse row and logs the prompt and the answer.

## 7. The ChatGPT Worker extension (most fragile part; read carefully)

**Files:** `extension/manifest.json`, `background.js` (service worker), `content.js` (on chatgpt.com),
`popup.html/js`.

**Manifest**
- Permissions: `storage`, `tabs`, `notifications`, `alarms`.
- Host permissions: chatgpt.com, images.openai.com, *.oaiusercontent.com, *.mm.bing.net, localhost, 127.0.0.1.
- Do not ask for `https://*/*`.

**Three version constants must always be equal:** manifest `version`, `CODE_VERSION` in background.js and
`SCRIPT_VERSION` in content.js.
- Chrome caches `background.js` (`Service Worker/ScriptCache`) and can run old code under a new manifest version.
  When `CODE_VERSION` differs from the manifest version, the extension reloads itself once.
- A tab whose ping version differs is treated as dead and reloaded. Mismatched constants therefore reload tabs every
  minute.
- Add a unit test that checks all three are equal.

### 7.1 The Automation Chrome

A separate Chrome with its own folder, `data/chatgpt-chrome`. Start it with:

```
--user-data-dir=<data/chatgpt-chrome> --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows
--disable-renderer-backgrounding --disable-background-timer-throttling --no-first-run --no-default-browser-check
```

This keeps ChatGPT drawing while the window is behind other windows. Never minimize it; keep the PC unlocked.

**Installation is manual, once:** `chrome://extensions` → Developer mode → **Load unpacked** → the `extension`
folder.
- Recent Chrome ignores `--load-extension`.
- An extension loaded over the DevTools pipe is removed on the next start.
- Provide a page `/automation-chrome` with these setup steps. The extension recognises the Automation Chrome when it
  sees this page.

**Connection**
- Settings → "Create connection key" shows `bas_<random>` once. Only its SHA-256 hash is stored.
- The person pastes the key into the extension popup along with the app URL.
- A new key switches off old installs.

**Opening by itself**
- The worker opens the Automation Chrome whenever chatgpt jobs are waiting (control job `open-chatgpt-chrome`).
- Every 30 s the background asks the app for `status`. It opens as many ChatGPT tabs as **Task Concurrency** (1–5) and
  closes tabs that have been idle for 20 s.
- A tab can be in one window with tabs, or in separate windows (a popup option).
- The popup also has "Pause automatic start".

### 7.2 Agent API (`POST /api/extension/agent`, Bearer key)

Actions:
- `claim` returns the next WAITING chatgpt job, preferring a job whose conversation is already open in this tab. It
  refuses features the tab's version lacks.
- `progress` carries a heartbeat, a `debug` snapshot (at most 4000 JSON chars) and the conversation URL. It may answer
  `continue: false` when the job was cancelled.
- `complete` carries text, html, conversationUrl, reusedExisting, image files (base64 JPEG) and `imageLinks`.
- `fail` carries a code: LOGIN | CONVERSATION_LOST | USAGE_LIMIT | CANCELLED | ERROR.

Timing rules:
- A claimed job with no progress for 90 s is treated as abandoned.
- If nothing claims a job for 30 minutes, the task becomes LOGIN_REQUIRED ("open the Automation Chrome").

Background details:
- It records the job held by each tab (`tabJobs` in `chrome.storage.session`).
- Closing a tab fails its job with "window was closed", so the stage retries.
- While a tab is marked as closing it must not claim a job. Watch the race where a claim is in flight while the
  idle-closer removes the tab: check the tab's job again after the claim returns.

### 7.3 Content script job flow

1. **Open the right page.**
   - Use the saved conversation URL, or `https://chatgpt.com/` for a new chat.
   - Save the pending job in `sessionStorage`, so a page reload continues it.
2. **Wait for ready.**
   - Ready means the composer exists and there is no challenge or login page.
   - A login or human check shows a notification and waits up to 10 minutes.
3. **Recover first.**
   - If `allowReuse` is set and the conversation's last user message equals the prompt, return the existing answer.
   - `promptsMatch` compares the start and the end of the prompt after normalising whitespace.
4. **Type the prompt.**
   - Find the composer, excluding canvas or "writing block" editors.
   - Paste prompts up to 8000 characters.
   - **Type longer prompts with `document.execCommand('insertText')`.** Pasting them makes ChatGPT turn them into a
     "Pasted text.txt" attachment. Remove any such chips.
   - Retry up to 3 times if ChatGPT re-renders the composer.
   - Check the composer holds the **complete** text before sending.
5. **Attach files when needed** (the photo check).
   - Set a `DataTransfer` on ChatGPT's hidden `input[type=file]`.
   - Wait for the previews, then wait for Send to become enabled (up to 120 s).
6. **Send, then wait for the answer** (below).
7. **Report.** Send `complete` with the answer and the conversation URL.

### 7.4 Reading the answer (the page has no stable markers)

ChatGPT removed `data-message-author-role` and the conversation-turn test IDs in September 2026, and switches between
page variants without notice. Support both:

**Page path (old variant)**
- Read the last assistant node after the last user node.
- "Done" means no Stop button, the text unchanged for 2.5 s, and the Copy or feedback buttons shown under the answer.

**Conversation path (current)**
1. Get an access token from `/api/auth/session`.
2. Read `/backend-api/conversation/<id>`.
3. Follow `current_node` → `parent` to build the message chain.
4. Keep user messages and assistant messages with `recipient: "all"` and type text or multimodal_text. Skip tool calls,
   hidden and system messages.
5. **The answer is the last text part after the last tool call.** ChatGPT writes a plan ("I'm verifying X's
   identity…") as its own message before a web search. Joining every message put that plan into articles.
6. **Finished** means the last shown answer message after the last user message has status `finished_successfully`,
   `end_turn !== false`, and nothing after it is `in_progress`.
7. Accept `end_turn: true` after one read. Otherwise require the text to stay unchanged across two separate reads.
8. Recognise our prompt by its text, or by `create_time ≥ send time − 10 s`.
9. Strip citation markers. Keep entity names.
10. Strip canvas marks `:::writing{…}` … `:::` from the text and the HTML.
11. A conversation answer has html `''`. The app must turn its Markdown into HTML (use a fallback-text parameter).

**HTTP 429 rate limiting (critical for speed)**
- ChatGPT rate-limits conversation reads per **account**. When limited, its own page also stops loading chats, and
  everything slows down for every tab.
- Read each tab's conversation at most once per 5 s; cache the result in between.
- Keep **one shared read slot** for all tabs in `chrome.storage.local`, `{nextAt, level}`.
  - Gaps by level: 4 s, 30 s, 1 min, 2 min, 4 min, 5 min.
  - Each 429 raises the level (honour Retry-After). Each success lowers it.
- Do not read at all until the answer's action row (`.turn-action-controls`) appears under the answer, or 45 s have
  passed.
- A slot wait must **not** reset the "unchanged across two reads" check. When it did, five tabs never accepted an
  answer.
- Time spent waiting on 429 does not count toward the "prompt did not appear" limit (180 s) or the generation timeout
  (up to 15 min).
- If a saved chat cannot be opened under a lasting 429, fail with CONVERSATION_LOST, so the stage continues in a new
  chat with the context primer.

**Other cases**
- **Placeholder URLs:** `/c/local-chatgpt:<uuid>` means a chat ChatGPT has not created yet. It is **not** a
  conversation. Never save it as the task's chat, in the extension or on the server.
- **Idle tab stuck:** an idle tab standing more than 30 s on a chat page that never finished loading goes back to
  `https://chatgpt.com/`, so it can claim prompts again.
- **"Continue generating"** is clicked automatically. "Which response do you prefer" is answered with the first
  option.
- **Debug snapshot** on every progress or fail: step, generating, title, URL, a page shape summary, marker names found,
  the last conversation read (role, status, end_turn, chars) and the slot level. It is logged in the task log when a
  stage fails, so a ChatGPT page change is diagnosable from logs.

### 7.5 Images through the extension

**Generated images** (Tigram writer)
- Wait for new `<img>` at least 700 px wide that were not on the page before sending.
- Convert to JPEG, crop to **1920×1080**, and return base64.

**Image-search gallery** (Celebrity writer)
- Open the gallery and save up to 10 distinct displayed pictures, like "Save image as".
- For pictures hosted on the publisher's site (no CORS), return `imageLinks: [{url, width, height}]`.
- The **worker** downloads those with SSRF protection:
  - https only;
  - a DNS check against private or loopback addresses on every redirect;
  - no cookies;
  - a 12 MB cap;
  - convert to JPEG with sharp.
- If the answer ended with no gallery after 90 s, fail; the stage retries once in a new chat.

## 8. Writers (modules)

All three writers share the later stages. The **Celebrity writer** is for keywords about a person. The **Tigram
writer** is for everything else (software, apps, how-to, products, local searches).

### 8.1 Celebrity Article Writer 1.0 (`celebrity-writer`)

| # | Stage key | What | Status |
|---|---|---|---|
| 1 | TITLES | ChatGPT gives title ideas plus `Recommended Title: …` (parsed) | GENERATING_TITLES |
| – | TITLE_APPROVAL | Gate: pauses when "Manual Title Approval" is on | AWAITING_TITLE_APPROVAL |
| 2 | RESEARCH | Detailed biography research, same chat | RESEARCHING |
| 3 | LONG_ARTICLE | 1,500–2,000 words, ## / ### headings, paragraphs only | WRITING_ARTICLE |
| 4 | FINAL_ARTICLE | Rewrite to ≤ max words (default 1,300), no title heading, no AI commentary | OPTIMIZING |
| 5 | FAQS | Exactly N FAQs (default 5), question line + answer line | GENERATING_FAQS |
| 6 | QUICK_BIO | 2-column table, about 11–13 rows, "Not publicly confirmed" for unknowns | GENERATING_BIO_TABLE |
| 7 | EXTERNAL_LINKS | See 9.1 | OPTIMIZING |
| 8 | IMAGES | See 9.2 (only if website.celebrityImages and Settings → images) | OPTIMIZING |
| 9 | HUMANIZE | See 9.3 (mandatory) | OPTIMIZING |
| 10 | ASSEMBLY | See 9.4 | SEO_CHECKING |
| 11 | SEO_CHECK | See 9.5 | SEO_CHECKING |
| – | ARTICLE_APPROVAL | Gate: pauses when "Manual Article Approval" is on or auto-send is off | AWAITING_ARTICLE_APPROVAL |
| 12 | WORDPRESS_DRAFT | See 10 | OPENING_WORDPRESS → CREATING_DRAFT |
| 13 | RANKMATH | See 10 | RUNNING_RANKMATH |

### 8.2 Celebrity Writer 2.0 (`celebrity-writer-2`)

- **One** ChatGPT answer writes the whole article from the owner's own long research-and-writing prompt.
- Store that prompt **word for word**. The only variable is `Primary Keyword: [{{keyword}}]`.
- Never condense or "improve" the owner's prompt. Adapt the parser instead.

The parser reads the prompt's labelled OUTPUT FORMAT. Labels may be numbered, bold or headings, with the value on the
same line or the next:
1. H1 / Article Title
2. … the article sections, ending with
3. Meta Description
4. Suggested URL Slug
5. 8–12 tags
6. Internal-link anchors
7. Research Notes

What the parser does with them:
- Drops scaffolding labels ("Introduction", "Main article").
- Turns "Quick Bio table", "Five FAQs" and "Final Thoughts" into `##` headings.
- Extracts the Quick Bio table and the FAQs into structured fields.
- Saves the meta description, slug and tags.
- Logs the research notes but never publishes them.
- Drops any prose before the title.

Other rules:
- Maximum words for the SEO check: 2,000.
- The form has the keyword only: no example title, no secondary keywords.
- Stage order: ARTICLE → EXTERNAL_LINKS → IMAGES → HUMANIZE → ASSEMBLY → SEO_CHECK → ARTICLE_APPROVAL →
  WORDPRESS_DRAFT → RANKMATH.
- A setting `workflowCelebrityWriter` (1.0 | 2.0) decides which writer Workflows use for celebrity keywords.

### 8.3 Tigram Article Writer (`tigram-writer`)

**ARTICLE stage:** one answer that starts with three lines:

```
SEO TITLE: <under 60 chars>
META DESCRIPTION: <100–150 chars>
URL SLUG: <lowercase-hyphens>
```

The article follows:
- an introduction of 100–150 words;
- a 40–60 word featured-snippet paragraph;
- 5–7 H2 sections, with one step-by-step section and one comparison or pros/cons table;
- `## Frequently Asked Questions` with 7 H3 questions;
- `## Conclusion`.

The length comes from the "max words" setting.

**CATEGORY stage**
- ChatGPT picks one of the website's categories and answers `CATEGORY: <exact name>`.

**Then:** EXTERNAL_LINKS → IMAGES → HUMANIZE → ASSEMBLY → SEO_CHECK → ARTICLE_APPROVAL → WORDPRESS_DRAFT → RANKMATH.

**Images**
1. `image_plan` plans 3 images with alt texts:
   - a featured image with a short title text;
   - 2 flat body images without text.
2. Then each image is created in turn with the `image` prompt.
3. Files are named `<slug>.jpg`, `<slug>-1.jpg` and `<slug>-2.jpg`.
4. The website template adds the logo.

## 9. Shared stages

### 9.1 External links

ChatGPT suggests `LINK: <phrase exactly as in the article> | <URL>` lines for 5–7 phrases: people, films, shows,
universities, organisations and places, never the keyword itself.

The app verifies every suggestion:
- **Trusted sites only:** Wikipedia in the article's language, IMDb, a list of large reference and news sites,
  universities and public bodies.
  - Accept a site named after the organisation: the host equals the joined words, a 6+ letter prefix, or the initials
    (chla.org, lmu.edu).
  - Never social media, shops, gossip or net-worth sites.
- **The page must exist and be about that phrase.**
  - Wikipedia pages are opened; disambiguation pages are refused.
  - IMDb IDs are compared with Wikidata property P345.
  - The page title must match.
- **The phrase must occur in a paragraph** (p, li, td or blockquote), never in a heading. Link each phrase once.
- **At most 2 links per paragraph**, counting links already there; use a later mention when a paragraph is full.
- **At most `maxExternalLinks` (default 5) links.** Wikipedia gets at most half of them, and non-Wikipedia links are
  placed first.
- Log every link added or refused with its real reason.
- An empty result never stops the article.

### 9.2 Celebrity images

**Collect and clean up**
1. Send the image-search prompt in the article's chat.
2. Collect the gallery: displayed files plus publisher links downloaded by the worker.
3. De-duplicate:
   - exact copies by sha256;
   - near copies by a 64-bit dHash (≤ 10 bits apart);
   - cropped copies by a fingerprint of the face area (≤ 12 bits apart with 2+ faces, ≤ 6 with one face).

**Order the pictures**
- **Faces first.** Detect faces with MediaPipe BlazeFace (tasks-vision, run in headless Chrome, with local model files
  in `data/tools/mediapipe`).
  - Search the whole picture plus 2×2 and 3×3 tiles.
  - Order pictures by the largest face's height.
  - Only face *locations* are found, never identities.
- **Soft pictures last.** Soft means a Laplacian variance below 0.4× the gallery median, with 3+ pictures.
- Pictures without faces come after those.

**Photo check (optional)**
- Attach up to 8 chosen photos (JPEG, ≤ 1024 px) to one prompt in the same chat.
- The answer has one line per photo: `N: watermark=yes|no | collage=yes|no | alt=…`.
- Order: clean photos first, then watermarked, then collages. Body images never use a collage.
- Alt text is `<Keyword> – <description>`, at most 125 characters.
- A failure only logs "Photo check skipped".

**Enhance (optional)**
- Use Upscayl's `upscayl-bin` with the `remacri-4x` model (in `data/tools/upscayl`).
- Run it only when a picture is stretched more than 2× in its template slot, or is soft.
- One picture at a time, with a 5-minute timeout; cache the result.
- If the tool is missing, keep the original.

**Render**
- Use the website template: 1920×1080, rendered as a headless-Chrome screenshot and saved as **WebP** (quality 90).
- A face-focus crop centres faces at 40% height.
- If WordPress refuses WebP, convert to JPEG and upload again.

**Use each downloaded picture in only one design**, so there are no repeats.
- A featured image in the split style needs 2 pictures.
- Each of the 2 body images needs 1.
- When the gallery is small, leave out body images. Then the task ends as NEEDS_REVIEW, with the reason listed.

**Placement in the article**
- **Body image 1:** directly above the article's **2nd H2**.
  - If the section just above the 2nd H2 is the Quick Bio (by heading or by `table.quick-bio-table`), place it above
    the **3rd H2** instead.
  - Never place it above the FAQs or the conclusion. In that case, place it after the 2nd paragraph.
- **Body image 2:** one paragraph before the FAQs.
- **The first image becomes the featured image.** Upload images to the WordPress media library with their alt text.

### 9.3 Humanizer (mandatory stage HUMANIZE, after IMAGES and before ASSEMBLY)

This is an editorial rewrite with fact locks, not a detector bypass. It runs in **the article's own ChatGPT chat**:
no new chat and no fresh flag.

**Splitting and marks**
- Split `bodyHtml` into blocks.
- Send the paragraphs as `[P1]`, `[P2]` … in parts of about 1,200 words, several prompts in the same chat.
- Links become `{L1}anchor{/L1}`, bold becomes `{b}…{/b}` and italic becomes `{i}…{/i}`. Canvas answers mangled raw
  Markdown links.
- Remove backslash escapes from answers.

**Context sent with each part**
- Per-paragraph problems found by a local analyser. Its lexicon includes AI filler phrases, inflated words and the
  openers Additionally, Furthermore, Moreover.
- Article-wide notes: repeated sentence openers, and sentence lengths that are too even.

**Fact locks: a rewritten paragraph is rejected (the original kept) if any of these changed**
- links;
- numbers;
- quotes;
- multi-word names (reordered words are accepted);
- the keyword count;
- the length, outside 0.6–1.3×.

German relaxations:
- A lost name only blocks a rewrite when every keyword word in it is missing.
- Otherwise it is a "reworded" warning.
- Sentence openers ("Unlike X", "Because Y") are not names.

**Other rules**
- The internal-link line is removed before the rewrite and put back after it.
- Stage data keeps `original` and `output`. A regeneration on an unchanged body starts again from the original.
- A failed part keeps the work of the other parts.
- Stop on logout, cancel, usage limit or a configuration error.
- Log a summary: paragraphs rewritten or kept, AI-signal density before and after, sentence rhythm before and after.

### 9.4 Assembly and SEO meta

**Order:** introduction → Quick Bio → article sections → FAQs → conclusion → internal link (always the last line).

**Headings written by the app**
- "Quick Bio of {Full Name}" and "Frequently Asked Questions".
- German: "Kurzbiografie von {Name}" and "Häufig gestellte Fragen".
- The name comes from the Full Name row of the Quick Bio.

**Cleanup**
- Remove AI commentary ("Here is your article", "Certainly", "I hope this helps"), code fences, a duplicate intro or
  conclusion, duplicate paragraphs and ChatGPT's preamble before the title.
- Convert Markdown to HTML and sanitize it with an allow-list.

**SEO fields**
- The SEO title, meta description and slug are built by the app when ChatGPT gave none.
- Templates exist for English and German.
- An all-lowercase keyword is title-cased in titles and meta ("justin biel" becomes "Justin Biel").

**Internal link** (one bold line at the end):

```html
<p><strong>{website link text} <a href="…">{previous article title}</a></strong></p>
```

- It points to the previous article of the same website: by workflow `publishAt`, otherwise by creation order.
- If that article has no title yet, wait up to 10 minutes.
- Use the real URL from the site's `/feed/` once the article is published; otherwise use `https://site/<slug>/`.
- The first article of a website links to the newest post on the site.
- "Send to WordPress" checks the link again.

### 9.5 Internal SEO check (the "SEO Readiness Score")

The checks:
- keyword in the title, the SEO title, the slug, the introduction, the body and a relevant heading;
- keyword frequency (min/max from settings, default 15–18) and keyword density;
- word count against the module maximum;
- meta description length and title length;
- the number of H2 and H3 headings and paragraph length;
- FAQs exist; Quick Bio exists (celebrity only);
- duplicate paragraphs, keyword stuffing, empty headings, broken HTML, category set, tag set.

**Score:** the weighted percentage. Below the review threshold (default 70), the task finishes as NEEDS_REVIEW.

## 10. WordPress automation (Playwright)

**Profiles**
- Each website has a persistent Chrome profile in `data/profiles/<dir>`.
- Session controls: Login (a visible window; the person logs in and closes it, which saves the cookies), Test Session,
  Refresh Session, Open Browser, Reset Session, Delete Profile, Sync Categories.
- Categories are read from WordPress automatically after login.

**Browser modes:** headless, background (off-screen window), or visible. Login windows are always visible.
- Launch with `--disable-quic`. QUIC caused intermittent hangs on Hostinger.
- `open(url)`: use `goto` with `waitUntil: 'commit'`, then wait at most 30 s for DOMContentLoaded, warn and go on.
  Some hosts never finish loading every asset.

**Overlays:** hide Hostinger's "Kodee" assistant overlay. Never hide `<html>` or `<body>`, which carry kodee classes.

**Draft flow** (block editor and classic editor, auto-detected)
1. Go to Posts → Add New.
2. Set the title and the content: switch to the code editor if needed, then back to visual.
3. **Save the draft immediately** and store the post id and edit URL. Retries and "Send to WordPress" reopen the same
   post: no duplicates.
4. Select **exactly one category**, unticking Uncategorized or Allgemein. Optionally create a missing category.
5. Set the tags and the slug.
6. Set the featured image and upload the body images.
7. Set the Rank Math focus keyword, SEO title and meta description.
   - The focus-keyword tag may show the keyword plus its score ("andre rock 79"). Accept the keyword plus a number,
     but no other words.
8. Save the draft.
   - German admin pages keep the Save button active after saving. Confirm the save from the REST response, not the
     button.

**Rank Math stage**
1. Read the real Rank Math score from the panel.
2. If it is below the target (default 75), apply up to `maxRankMathAttempts` (default 3) rounds of safe fixes:
   - the SEO title, meta description and slug;
   - an optional content revision through the "SEO Correction" prompt.
3. Reject a revision that adds more than 15% words, cuts more than 30%, loses H2s, or pushes keyword density above
   2.5%.
4. Recommendations the app cannot fix (images, links, power words) go to the review reasons.

**Updating posts that are already scheduled or live:** do it through REST from inside the logged-in admin page, with
the `wpApiSettings` nonce.
- GET `content.raw` with `context=edit`, transform it, and POST only `content`. Edits made by hand in WordPress stay.
- Never change the status or the date.

**Selectors:** keep them in one selectors file, with several fallbacks per element. User overrides are tried first
(Settings → Advanced, JSON).

**Failure screenshots:** `chatgpt-error`, `wordpress-error`, `rankmath-error` and `*-login-required`. They are served
only to signed-in users, with path validation.

## 11. Image Template page and editor

**Per-website settings:** create images for celebrity articles (on/off), create images for Tigram articles (on/off),
logo upload (PNG), line colour (empty means the logo's strongest colour), logo place (a corner or the bottom
middle), and the featured style:
- "split": two pictures with a line and the logo between them;
- "single": one picture with the logo in a corner.

**Live preview** of the featured image and a body image before saving, using the real renderer.

**Editor** on a 1920×1080 canvas:
- Layer types:
  - picture place (numbered: which source picture goes there);
  - logo (with or without a white plate);
  - box (rectangle or circle);
  - text;
  - fixed picture.
- Editing:
  - drag and 8 resize handles;
  - snapping to layers and the centre (Shift for free placement);
  - arrow keys move 1 px (Shift: 10 px);
  - Delete removes a layer; Ctrl+Z / Ctrl+Y undo and redo;
  - Fit and 100% zoom.
- The featured image and the body image are edited separately. "Back to automatic" drops the design.

**Import Polotno JSON** (Canva-like editors):
- Every page can be used. A page of another shape is scaled onto 1920×1080 and centred.
- Rectangles, circles, SVGs, text, groups, rotation and shadows come over.
- Pictures become picture places.
- Only `data:` and `https:` sources are accepted, in the browser and again on the server.

## 12. Workflow (per-website automatic publishing)

**Keyword list**
- One article per line: `keyword | secondary keywords | title`. CSV upload is also possible, with the columns keyword,
  title, secondary_keywords and kind.
- Pasting columns from Google Sheets works too.

**Kind detection** (celebrity or tigram), in this order:
1. Wording rules. "… wife", "… net worth", "… age", "… height" mean a person. "best …", "… near me", "download …" or a
   version number mean not a person.
2. Wikidata: is the keyword a known human, or a film, a town or software?
3. Anything still undecided stays UNKNOWN and is chosen by hand in the list.

**Settings**
- Publish times in **Pakistan time** (Asia/Karachi), picked as h:mm AM/PM. One article per time.
- Weekdays (none ticked means every day).
- Write-ahead: "as soon as added", or N hours before the publish time. At most 10 articles per website are written
  ahead at a time.
- Images: follow the website, or force on or off.
- "This website may publish by itself": off by default.
- The WordPress time zone, read from WordPress the first time. Pakistan time is converted into it.
- "Ask Google to index it" and the Search Console property (`https://site/` or `sc-domain:site`).

**Scheduler** (runs every minute in the worker; it never opens a browser itself):
- States go WAITING → WRITING → READY → SCHEDULED → PUBLISHED → INDEXED.
- The title and article approval gates are answered automatically.
- A failed or late article loses its slot and takes the next free one. It is left alone after 3 tries.
- NEEDS_REVIEW counts as finished.
- `schedule-post` job: through REST inside the admin page, set status `future` with the local date in the site's
  time zone. This is the only code that may publish, and only when `canPublish` is on.
- `request-indexing` job: open Search Console URL inspection in the website's own profile (a Google account already
  logged in there) and press "Request indexing".
  - Google allows about 10 requests a day per property. Retry after 6 hours when the quota is used up, otherwise after
    30 minutes, up to 3 times.

## 13. Test tools (sidebar pages, not part of the pipelines)

### AI Humanizer (`/humanizer`)
- Pick any saved article, or paste HTML or text.
- Choose "rewrite flagged paragraphs" or "rewrite every paragraph", and edit the prompt (saved in localStorage).
- It runs as a `humanizer` queue job.
- It shows each paragraph side by side (before and after) with the reasons it was kept, plus the score before and
  after.

### Plagiarism Check (`/plagiarism`)
- Shows evidence (passages side by side), never an "X% = plagiarism" verdict.
- **Sources:**
  - the user's own articles;
  - pages the article links to (at most 10, own hosts skipped);
  - up to 10 URLs the user adds;
  - Wikipedia (the API: a search plus extracts);
  - optionally Google through **serper.dev**, with `SERPER_API_KEY` in `.env`.
    - Send 10 distinctive 10-word phrases (no fact sentences with numbers), one credit each.
    - Fetch and compare the top 12 pages.
- **Matching:**
  - 5-word anchors;
  - exact runs of 8+ words containing at least 4 content words;
  - sentences with word-level edit similarity ≥ 0.8 count as close copies.
  - Quoted text and boilerplate are shown but not counted. Boilerplate means 5-grams found in ≥ 10% of the user's
    own articles.
- **Never scrape Google or DuckDuckGo directly.**

## 14. Dashboard pages

- **Sign-in / first-run admin:** only works while no user exists. bcrypt, a signed HTTP-only cookie, login rate
  limiting.
- **Dashboard:** stats, running tasks, worker online or offline warning, extension connection state.
- **Celebrity Article Writer, Celebrity Writer 2.0, Tigram Article Writer:**
  - Fields: keyword, example title, website, category, secondary keywords, country, language.
  - "Multiple keywords" mode: one per line, with `keyword | secondary1, secondary2`.
  - CSV import.
- **Article Queue:** live progress, cancel, retry, bulk actions.
- **Article History:** view, edit, research, ChatGPT conversation, prompts, responses, retry, regenerate stage, run
  SEO check, send to WordPress, open draft, delete.
- **Article page tabs:** Overview (scores, review reasons, draft link), Titles (pick one when approval is on), Editor
  (title, content, headings, Quick Bio, FAQs, SEO title, meta, slug, focus keyword, category, tags), Stages, Logs,
  Conversation.
- **Websites:** add or edit, a session card with the profile buttons, categories, the internal-link line text and the
  image toggles.
- **Image Template, Workflow, Prompt Manager** (every prompt per module, with its variables documented),
  **Settings**, **Logs** (filter by task, level, category, with screenshots), **AI Humanizer**, **Plagiarism Check**.
- Show "coming soon" placeholders for future modules in the sidebar.

## 15. Settings (one Zod schema shared by client and worker, with defaults)

| Group | Settings |
|---|---|
| Browser | browserMode=headless, browserTimeoutSec=60, generationTimeoutSec=600, captureScreenshots=true, chatgptUrl=https://chatgpt.com/, chatgptChromeMode=separate\|profile |
| Workflow | manualTitleApproval=false, manualArticleApproval=false, autoSendToWordPress=true, createMissingCategory=false, taskConcurrency=1 (1–5), retryAttempts=2, workflowCelebrityWriter |
| Content | maxArticleWordCount=1300, minKeywordOccurrences=15, maxKeywordOccurrences=18, faqCount=5, quickBioRows=12, defaultLanguage=English, targetCountry=United States |
| SEO | seoReviewThreshold=70, rankMathTargetScore=75, maxRankMathAttempts=3, externalLinks=true, maxExternalLinks=5, articleImages=true, enhanceCelebrityImages=true, celebrityPhotoReview=true |
| Advanced | selectorOverrides (JSON) |

## 16. Security

- CSRF on every state-changing request: a same-origin check plus a double-submit token. The extension route uses its
  Bearer key instead.
- Use Zod everywhere. Use Prisma only, with no raw SQL built from input.
- Sanitize article HTML on save and before display. Set security headers and a production CSP.
- Redact credential-like fields in logs.
- `data/` is private and git-ignored. Treat `data/profiles` like passwords.
- Secrets live only in `.env`: `SESSION_SECRET` and `SERPER_API_KEY`.

## 17. Languages

- Articles follow the task language: English or German.
- The language line is appended to every text prompt.
- English sites must get English articles even when the account has many German chats, so append the line for English
  too.
- German needs:
  - Unicode word boundaries (umlauts);
  - German section headings (Fazit, Kurzbiografie, Häufig gestellte Fragen);
  - de.wikipedia for links;
  - German meta templates;
  - the relaxed humanizer name lock.

## 18. Testing

- Write unit tests for every parser:
  - titles, FAQs, Quick Bio, the Writer 2.0 labelled output, the Tigram header lines;
  - cleanup (preamble, canvas marks, AI commentary), assembly order, image placement;
  - external-link rules, SEO checks, humanizer locks, plagiarism matching;
  - workflow time slots, keyword-kind detection, the publish guard.
- **Extension browser tests:** load the real unpacked extension into Chrome (or Edge as a fallback) against
  `tests/fixtures/fake-chatgpt.html`. Its modes:
  - markers and no-markers;
  - rate-limit and rate-limit-hard (429);
  - shell-page (only user-message classes and turn-action-controls);
  - two chats in parallel;
  - preamble before a tool call;
  - canvas marks;
  - a long prompt (typed, not pasted);
  - stale-chat;
  - attachments.
- The version-equality test covers manifest, `CODE_VERSION` and `SCRIPT_VERSION`.
- An optional WordPress end-to-end test runs only when `WP_E2E_ADMIN_URL` points at a disposable WordPress.

## 19. Lessons already learned (do not repeat these mistakes)

1. **Restarting is expensive.** Every Chrome restart fails the running ChatGPT jobs and reloads every tab, which worsens
   429 limits.
   - Restart the Automation Chrome only when no chatgpt job is ACTIVE.
   - To restart: kill the main `chrome.exe` with `--user-data-dir=…chatgpt-chrome` (without /F), enqueue the control
     job `open-chatgpt-chrome`, then wait until the extension reports the new version.
2. **`tsx watch` restarts the worker on every `src/` edit**, which kills running jobs. Check the queue is idle before
   editing.
3. **Never start a second `npm run dev:all`** in the same folder. Two Next servers sharing `.next` break the dashboard.
4. **When something fails, read the extension's debug snapshot in the task log first**, before blaming app code.
   ChatGPT changes its page without notice.
5. **Slowness is usually ChatGPT's account-level 429**, not the app. Low concurrency (2–3) and gentle polling beat
   retries.
6. **Prove the cause from logs, fix it with an automated test, then do one live retry.** Avoid long live trial-and-error
   loops.
7. **Never hide `<html>` or `<body>` when hiding overlays.**
8. **Prompts over 8,000 characters must be typed, not pasted.**
9. **ChatGPT may answer an image search with text only.** Retry once in a new chat, then fail with a clear message.
10. **The last WordPress save must be confirmed from the REST response** (German admin).

## 20. Build order (milestones)

1. Scaffold Next.js, Prisma and SQLite, `setup.ts`, auth with first-run admin, the layout and sidebar, the settings
   schema and page, logs.
2. The built-in queue and worker: heartbeat, single-worker lock, crash-safe re-queue, control jobs.
3. Browser profiles and websites: the login window, Test Session, category sync.
4. The extension, the agent API and the Automation Chrome launcher, plus the extension browser tests with the fake
   ChatGPT page. Get prompt → answer working end to end in one conversation.
5. The pipeline engine plus Celebrity Writer 1.0 (ChatGPT stages, assembly, SEO check), the Prompt Manager and prompt
   seeding.
6. WordPress draft and Rank Math stages, the publish guard, the article page and editor, Send to WordPress, regenerate.
7. External links, the internal link, Tigram writer, Tigram images, then celebrity images and image templates with the
   editor.
8. Celebrity Writer 2.0 (the owner's prompt plus the labelled-output parser).
9. The Humanizer stage and test page.
10. Workflow scheduling, publishing and indexing.
11. The Plagiarism Check page.
12. README with Windows quick start: `npm install` → `npm run setup` → `npm run dev:all` → open localhost:3000.

## 21. Acceptance criteria

- A celebrity keyword such as "Sydney Sweeney" goes from the dashboard to a WordPress draft without help:
  - one category, tags, slug and Rank Math fields;
  - a Rank Math score ≥ 75 or listed review reasons;
  - images placed by the rules;
  - an internal link on the last line;
  - no ChatGPT preamble or canvas marks in the text.
- Killing the worker or Chrome halfway, then restarting, finishes the same task without a duplicate prompt or post.
- Two or three articles run at the same time without tabs hanging under HTTP 429.
- No code path can publish a post unless the website's "may publish by itself" switch is on.
- All tests pass with `npm test`, and `npm run typecheck` is clean.

---

## Appendix A — Default prompts (Celebrity Writer 1.0)

Variables: `{{keyword}}`, `{{example_title}}`, `{{selected_title}}`, `{{secondary_keywords}}`, `{{country}}`,
`{{language}}`, `{{category}}`, `{{research}}`, `{{article}}`, `{{final_article}}`, `{{max_words}}`,
`{{min_keyword_occurrences}}`, `{{max_keyword_occurrences}}`, `{{faq_count}}`, `{{bio_rows_range}}`, `{{seo_title}}`,
`{{meta_description}}`, `{{link_count}}`, `{{wikipedia_site}}`, `{{photo_count}}`, `{{rankmath_issues}}`.

**Title Prompt**
```
Generate some best titles for my blog post.

Target keyword:
"{{keyword}}"

{{#if example_title}}Here's an example article title for an overview:
"{{example_title}}"
{{/if}}

Title Requirements:
Don't use spammy or obvious AI wording terms.
The title should look naturally written by a human.
Keep the title useful, readable and SEO-friendly.
Use the target keyword naturally where appropriate.
Generate several strong title ideas.
At the end, clearly recommend the strongest title to use.

Write the titles in {{language}}.
Put your final recommendation on its own line in exactly this format:
Recommended Title: <the title>
```

**Research Prompt**
```
Collect all available reliable information about the keyword:
"{{keyword}}"

The article title is:
"{{selected_title}}"

Make sure the research provides deep details about the person where information is publicly available, including:
Age, Date of Birth, Birthplace, Nationality, Family, Parents, Mother, Father, Siblings, Relationship Status, Boyfriend,
Girlfriend, Partner, Wife, Husband, Children, Education, Early Life, Career, Movies, TV Shows, Projects, Awards,
Achievements, Lifestyle, Height, Physical Appearance, Net Worth, Income Sources, Social Media Presence, Recent Updates,
Interesting Facts and other useful information related to the person.

The information should be detailed enough to create a complete celebrity biography article.
Do not invent personal information.
Do not present rumors as confirmed facts.
Clearly describe net worth figures as estimates when they are not officially verified.
```

**Long Article Prompt**
```
Now using all the information collected above, write a 1,500 to 2,000-word, humanized and SEO-optimized blog article.

Use the article title provided earlier: "{{selected_title}}"

Focus on the primary keyword:
"{{keyword}}"
{{#if secondary_keywords}}
Where they fit naturally, also use these secondary keywords: {{secondary_keywords}}
{{/if}}
Write in {{language}} for readers in {{country}}.

Strict Formatting & Writing Rules:
Paragraph Format Only: natural narrative paragraphs; no bullet points; no numbered lists; avoid short, disconnected sentences.
Flow & Structure: medium-length flowing paragraphs of about 3 to 5 sentences.
Tone & Style: accessible, engaging, informative and human-like; avoid robotic AI-style wording.
Headings: proper H2 and H3 headings (Markdown ## for H2 and ### for H3); content beneath headings stays in paragraphs.
Keyword Usage: use the primary keyword approximately {{min_keyword_occurrences}} to {{max_keyword_occurrences}} times when
it reads naturally; do not keyword stuff; use pronouns and name variations naturally; do not bold the keyword for SEO.
Important Information: bold genuinely important names, movies, projects, awards, events and facts where useful.
Do not fabricate information. Avoid unnecessary repetition. Create a useful introduction and conclusion.
Do not add FAQs or the Quick Bio table yet.
```

**Final Optimization Prompt**
```
Now rewrite and optimize the previous article into the final publishable version.

Maximum Word Count:
{{max_words}} words.

Follow good SEO practices while keeping the article natural.
Use proper H2 and H3 headings (Markdown ## for H2 and ### for H3).
Write useful content underneath each heading.
Aim for approximately 40 to 70 words under smaller subheadings where suitable.
Larger sections may contain multiple natural paragraphs.
Do not use bullet points or numbered lists inside the main article.
Remove unnecessary filler. Remove repeated information. Avoid spammy wording. Avoid obvious AI phrases.
Make the article easy to read.
Include the primary keyword "{{keyword}}" naturally in the introduction.
Use the keyword naturally in relevant headings when appropriate.
Use semantic and related terms naturally.
Do not fabricate facts.
Keep a short introduction at the top and finish with a conclusion section.

Output only the final article.
Do not include the article title as a heading.
Do not write comments such as "Here is your article", "Certainly", "I hope this helps" or similar AI commentary.
```

**FAQ Prompt**
```
Write exactly {{faq_count}} short frequently asked questions for this article about "{{keyword}}".

Provide short, useful and accurate answers.
Questions should reflect realistic searches people may make about the celebrity.
Do not invent facts.

Format each FAQ as the question on its own line (ending with a question mark), followed by its answer on the next line.
Output only the FAQs without any introduction or closing comments.
```

**Quick Bio Prompt**
```
Create a Quick Bio table for this celebrity article about "{{keyword}}".

Use approximately {{bio_rows_range}} relevant rows.

Possible fields include: Full Name, Known As, Profession, Date of Birth, Age, Birthplace, Nationality, Education,
Relationship Status, Height, Net Worth, Famous For, Social Media.

Only use information supported by the research.
Do not invent missing values.
If important information is unavailable, use wording such as: Not publicly confirmed

Return a clean two-column HTML-compatible table.
Column 1: Attribute
Column 2: Details

Output only the table.
```

**External Links Prompt**
```
Suggest external links for the final article about "{{keyword}}" (the article is repeated below).

Choose {{link_count}} words or short phrases that appear exactly like this in the article text (same spelling) and that
readers may want to look up, for example:
- other well-known people mentioned in the article (not "{{keyword}}" itself)
- titles of movies, TV shows, songs, albums or books
- universities, schools, companies, teams, bands or awards
- cities, countries and famous places

Take the phrases from different paragraphs of the article, at most 2 from the same paragraph.

For each phrase give one link to a trusted page about exactly that person or thing. Use different kinds of sites, not only Wikipedia:
- IMDb for movies, TV shows, actors and directors
- the official website of a university, school, company, team, band, charity, organisation or award
- a major trusted site such as Britannica, Variety, Billboard, Rolling Stone, ESPN or the BBC
- Wikipedia ({{wikipedia_site}}) for people and places the others do not cover — at most half of the links

Use web search to make sure every page really exists and is about the right person or thing.
Never link to social media, online shops, gossip sites or net-worth sites.
Do not rewrite the article.

Answer only with one line per link in exactly this format and nothing else:
LINK: <phrase exactly as written in the article> | <full URL>

Article:
{{final_article}}
```

**Photo Check Prompt** (sent with the photos attached)
```
I am writing an article about "{{keyword}}". I attached {{photo_count}} photos from an image search, numbered 1 to
{{photo_count}} in the order they are attached.

For every photo, write one line in exactly this format:
<number>: watermark=<yes or no> | collage=<yes or no> | alt=<alt text>

watermark=yes when the photo has a watermark, a website name or web address, a channel or photo agency logo, or large
text written over the picture. Text that belongs to the scene itself (a sign, the backdrop at an event, a shirt print)
does not count.
collage=yes when the picture is not one photo but several photos put together: side by side, split by a line, in frames
or a grid, or a designed thumbnail with shapes, borders or boxes around photos.
alt: at most 12 words describing what is visible: the place, the occasion, what the people wear or do. Do not name
anyone and do not guess who the people are; the name is added separately.

Write nothing else.
```

**SEO Correction Prompt**
```
The Rank Math SEO plugin reported these issues for the article about "{{keyword}}":

{{rankmath_issues}}

Revise the final article below so that the issues that can be fixed naturally inside the content are resolved — for
example using the focus keyword "{{keyword}}" early in the introduction, or in one relevant subheading.

Rules:
Keep the article at or under {{max_words}} words.
Keep every fact the same and do not invent new information.
Keep Markdown ## H2 and ### H3 headings.
Write in paragraphs only, with no bullet points or numbered lists.
Do not keyword stuff and do not damage readability just to raise a score.

Output only the revised article with no comments.

Article:
{{final_article}}
```

**Image Search Prompt (celebrity):** the owner sets this one; a plain default is enough.

**Celebrity Writer 2.0 article prompt:** paste the owner's own prompt **unchanged**. In this project it is in
`src/modules/celebrity-writer-2/prompts.ts`.

## Appendix B — Humanizer prompt (default, "humanizer-v3")

```
You are a senior magazine editor. Edit the numbered paragraphs below so they read like a careful human writer wrote
them: natural, clear and specific. This is an editorial rewrite, not an attempt to fool AI-detection software.

Rules:
1. Keep every fact. Do not add facts, examples, statistics, quotes, sources or personal experience that are not already in the paragraph.
2. Keep every name, date, number and quotation exactly as written.
3. Links are marked like {L1}anchor text{/L1}. Keep every mark with exactly the same words inside it. Keep {b}…{/b} (bold) and {i}…{/i} (italic) marks around the same words.
4. Keep "{{keyword}}" exactly as often as it appears in each paragraph.
5. Remove filler that adds nothing, such as "It is important to note", "It is worth noting", "This highlights" or "In conclusion".
6. Do not start sentences with Additionally, Furthermore, Moreover, Notably, Overall or Ultimately. Connect sentences by meaning instead.
7. Replace inflated words (delve, pivotal, intricate, meticulous, underscore, showcase, testament, tapestry, realm, vibrant, embark, navigate, leverage, foster, crucial, remarkable, renowned, boasts) with plain words when the meaning stays the same.
8. Vary sentence length naturally: a short sentence now and then, a longer one where it helps. Do not add slang, typos or fragments on purpose.
9. Use few dashes; prefer commas or full stops.
10. Keep each paragraph about the same length (within 20%), in the same language and spelling, and as one paragraph.
11. Keep real uncertainty ("may", "reportedly", "estimated"). Do not turn a guess into a fact.

What to fix:
{{problems}}

Answer in the chat as plain text, not in a canvas or document. Give only the edited paragraphs. Put each one under the
same label it has below, with the label alone on its own line, for example a line "[P4]" and the edited paragraph on
the next line. No other text.

Paragraphs:
{{paragraphs}}
```

## Appendix C — Tigram article prompt (shape)

Keep the owner's current Tigram prompt from the Prompt Manager. It must start the answer with the three lines
`SEO TITLE:`, `META DESCRIPTION:` and `URL SLUG:`. The article must then follow this order: introduction (hook,
keyword in the first 100 words), featured-snippet paragraph, 5–7 H2 sections with one step-by-step section and one
table, `## Frequently Asked Questions` with 7 H3 questions, and `## Conclusion` with a CTA. The length is set by
`{{word_range}}`, and the input variables are `{{keyword}}` and `{{secondary_keywords}}`.
