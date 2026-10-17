# Blog Automation Studio

A modular, self-hosted blogging automation dashboard. It writes articles on **the ChatGPT website** through a small Chrome extension in your own Chrome, and fills in **your WordPress admin** with browser automation (Playwright + Chrome) — then saves the finished article as a **WordPress draft** with Rank Math fields filled in.

> **Runs on your PC with nothing extra to install.** You need Node.js and Google Chrome. The database is a single file (SQLite) and the job queue is built in — no PostgreSQL, Redis or Docker.
>
> **No APIs.** There is no OpenAI/ChatGPT API, no WordPress REST API calls from the app, and no Application Passwords. You log in yourself in Chrome and that session is reused.
>
> **Drafts only, unless you say otherwise.** The final action of a normal run is always *Save Draft*, and a network-level guard aborts any request that would publish, schedule or submit a post. Only a website whose *Workflow* has **"This website may publish by itself"** switched on may hand a finished article to WordPress with a publish time — nothing else ever publishes.

---

## Quick start (Windows, macOS or Linux)

Requirements: **Node.js 20.9+** (22 or 24 recommended) and **Google Chrome**.

In the project folder:

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev:all
```

Then open **http://localhost:3000**:

1. **Create your admin account** on the first screen (this is only the dashboard login — not your ChatGPT or WordPress account).
2. **Set up the ChatGPT Chrome extension** once — see [ChatGPT through the Chrome extension](#chatgpt-through-the-chrome-extension).
3. **Websites → Add Website**: your site's name and URL.
4. Click **Login** on the website card, log in to wp-admin yourself (tick *Remember Me*), close the window, then **Test Session**. The site's categories are read from WordPress (Posts → Categories) right after — no typing. **Sync from WordPress** on the card reads them again after you add or rename categories in WordPress.
5. **Celebrity Article Writer** → type a keyword (e.g. `Sydney Sweeney`), pick your website and category → **Start Article**.
6. Watch it on the **Dashboard** or **Article Queue**. When it finishes, click **Open WordPress Draft**.

**Every day after that:** open a terminal in the project folder, run `npm run dev:all`, and keep that window open while you use http://localhost:3000. Press **Ctrl+C** to stop.

---

## Contents

1. [Features](#features)
2. [How it works](#how-it-works)
3. [Setup details](#setup-details)
4. [Browser profiles, ChatGPT login and WordPress login](#browser-profiles-chatgpt-login-and-wordpress-login)
5. [Using the dashboard](#using-the-dashboard)
6. [Commands](#commands)
7. [Running on a server](#running-on-a-server)
8. [Reliability features](#reliability-features)
9. [Security](#security)
10. [Backups and updates](#backups-and-updates)
11. [Troubleshooting](#troubleshooting)
12. [Adding future modules](#adding-future-modules)
13. [Project structure](#project-structure)

## Features

- **SaaS-style dashboard** with sidebar navigation: Dashboard, Celebrity Article Writer, Article Queue, Article History, Websites, Prompt Manager, Settings, Logs — plus placeholders for upcoming modules.
- **Celebrity Article Writer (Module #1)** — six ChatGPT steps in **one conversation per article**: titles → research → long article → final optimized article (≤ 1,300 words) → FAQs → Quick Bio table.
- **Tigram Article Writer (Module #2)** — for every other kind of keyword (software, apps, discount codes, product questions, how-to, local searches). One ChatGPT answer writes the whole SEO article: SEO title, meta description, slug, introduction, a featured-snippet paragraph, 5–7 H2 sections with a step-by-step part and a comparison table, 7 FAQs and a conclusion. ChatGPT then picks **one** category from the categories saved for the website.
- **Programmatic assembly**: Introduction → Quick Bio → Article → FAQs → Conclusion → internal link; removes AI commentary, code fences, duplicate intros/conclusions and duplicate paragraphs; sanitizes HTML.
  The app writes the two section headings itself: *Quick Bio of {Name}* and *Frequently Asked Questions* (German: *Kurzbiografie von {Name}* and *Häufig gestellte Fragen*). The name comes from the Full Name row of the Quick Bio table.
- **One category per article**: the selected category is set and every other category (Uncategorized, Allgemein…) is unchecked.
- **Keyword counter & SEO checker** computed by the application (word count, exact keyword occurrences, density, H2/H3 counts, 24 checks) → **SEO Readiness Score**.
- **WordPress browser automation** (block editor and classic editor): Posts → Add New Post → title → content → category → tag → slug → Rank Math focus keyword / SEO title / meta description → reads the **actual Rank Math score** → bounded optimization attempts → **Save Draft**.
- **Queue** with concurrency, live progress, CSV bulk import and multi-keyword input.
- **Resumable**: every stage is stored separately. Failures, cancellations, crashes and expired logins resume from the last completed stage. Individual stages can be regenerated.
- **Login Required** state (not Failed) when a ChatGPT/WordPress session expires, with **Reconnect** buttons and automatic resume after a successful session test.
- **Prompt Manager** — every prompt editable with `{{variables}}`.
- **Built-in editor** for title, content, headings, Quick Bio, FAQs, SEO title, meta description, slug, focus keyword, category and tags.
- **Detailed logs** with prompts, responses, browser actions, retries, errors, Rank Math scores and automatic failure screenshots.

## How it works

`npm run dev:all` starts two programs that share one database file:

```
 ┌────────────────────────────┐          ┌─────────────────────────────────┐
 │  Dashboard (Next.js)       │          │  Automation worker (Node.js)    │
 │  http://localhost:3000     │          │  Playwright + Google Chrome     │
 │  pages, API, sign-in,      │          │  • saved browser profiles       │
 │  validation                │          │  • ChatGPT website automation   │
 └─────────────┬──────────────┘          │  • WordPress admin automation   │
               │  adds jobs              │  • resumable article pipeline   │
               ▼                         └────────────────┬────────────────┘
        ┌─────────────────────────────────────────────┐   │ claims jobs,
        │  data/app.db  (SQLite)                      │◄──┘ saves results
        │  articles, stages, prompts, responses,      │
        │  websites, settings, logs, job queue        │
        └─────────────────────────────────────────────┘
```

- **The database** (`data/app.db`) keeps every article and each step's result, every ChatGPT prompt/answer, websites and categories, prompts, settings and logs.
- **The job queue** lives in the same database: the dashboard adds a job, the worker claims it and runs it. One job per article at a time, so nothing is generated twice.
- **The worker** is the only program that opens Chrome. Login windows open on the computer running the worker. Only one worker may run at a time (it refuses to start a second one).
- **Browser profiles** (`data/profiles/`) hold the Chrome cookies for each WordPress site. ChatGPT uses your own Chrome profile with the extension.

### Celebrity Article workflow

| # | Stage | Where | Status shown |
|---|---|---|---|
| 1 | Generate Titles (+ extract recommended title) | ChatGPT | Generating Titles |
| – | Title Approval (optional pause) | App | Awaiting Title Approval |
| 2 | Celebrity Research | ChatGPT | Researching |
| 3 | Long Article (1,500–2,000 words) | ChatGPT | Writing Article |
| 4 | Final Article (≤ max words) | ChatGPT | Optimizing |
| 5 | FAQs | ChatGPT | Generating FAQs |
| 6 | Quick Bio Table | ChatGPT | Generating Bio Table |
| – | External Links (on by default, Settings) | ChatGPT + App checks | Optimizing |
| 7 | Assembly + SEO title/meta/slug | App | SEO Checking |
| 8 | Internal SEO check | App | SEO Checking |
| – | Article Approval (optional pause) | App | Awaiting Article Approval |
| 9 | Create WordPress draft | WordPress | Opening WordPress → Creating Draft |
| 10 | Rank Math fields, score & corrections, final Save Draft | WordPress | Running Rank Math Check |

Celebrity articles have no images: the app adds none, and a featured image is chosen in WordPress by hand. (Until
24 September 2026 a *Photos* stage took pictures from ChatGPT's image search; it was removed.)

**Image template** (sidebar → *Image Template*, or Websites → edit a website): every website carries its own picture
settings, and the page shows a live preview of the featured image and a picture from the text before anything is saved.

The same page holds a small editor. Press *Start from the standard look* and the current template opens as layers on a
1920 × 1080 canvas that can be dragged and resized:

| Layer | What it is |
| --- | --- |
| *Picture place* | Where one of the pictures ChatGPT creates goes. Its number says which one (1 = the first). Every picture is created in the shape of its place, so nothing is cropped away twice. |
| *Logo* | The uploaded logo, with or without the white plate behind it. |
| *Box* | A coloured rectangle or circle — the line between two pictures is one of these. |
| *Text* | A fixed line of text, with its own size, colour and alignment. |
| *Fixed picture* | A drawing that belongs to the design itself and stays the same on every article image. It comes in with an imported file. |

Dragging moves a layer and the eight handles resize it; layers line up with each other and with the middle of the canvas
by themselves (hold *Shift* to place one freely). Arrow keys move the selected layer by one pixel, with *Shift* by ten,
*Delete* removes it and *Ctrl+Z* / *Ctrl+Y* step back and forward. *Fit* and *100%* set how large the canvas is shown.
*Featured image* and *Picture in the text* are edited separately, and *Back to automatic* drops the design again so the
website follows the settings on the left. A design is only used once it is saved, and *Preview* renders it with the
real renderer.

**Importing a design** (*Import design file*): a JSON file exported from Polotno — the editor behind Canva-like tools —
becomes a design. Every page of the file can be used, for the featured image or for the picture in the text; a page of
another shape is scaled onto the 1920 × 1080 article image and centred on it. Rectangles, circles, drawings, text,
groups, turned elements and shadows come over; pictures in the file become picture places, so ChatGPT fills them.
A design that has no picture place draws the same image on every article — the editor offers to put one behind the
drawing. Only pictures built into the file and addresses starting with `https:` are kept, both in the browser and again
on the way into the database.

| Setting | What it does |
| --- | --- |
| *Create images for Tigram articles* | Off: the Tigram articles of that website are written without any images — useful for a site whose pictures are added by hand. |
| *Logo* | Uploaded here (PNG with a transparent background works best). It sits on every article image of that website, 226 px high: in the middle of two photos, otherwise in the chosen corner. |
| *Line colour* | The line between the two photos of the featured image. Empty: the strongest colour of the logo is used. |
| *Logo place* | Where the logo sits when a single photo fills the image: a corner, or the middle of the lower edge. |
| *Featured image* | *Two pictures with the line between them* (the Peak Buzz look) or *one picture with the logo in a corner*. |

The Tigram articles use it, so they carry the website's logo on all three of their pictures. A logo can also be dropped into `data/templates/`
by hand (see the README there) — the upload on the Websites page wins.

**Workflow** (sidebar → *Workflow*): every website can have its own keyword list that runs by itself — the app picks
the writer, writes the article ahead of time, hands it to WordPress with a publish time and asks Google to index it
once it is live.

| Setting | What it does |
| --- | --- |
| *Publish times* | The times of day an article goes live, in **Pakistan time**. Each one is picked as hours, minutes and AM or PM (4:00 AM, 4:30 AM, …). One article per time, so five times means five articles a day. |
| *Days* | The weekdays it runs. Nothing ticked means every day. |
| *Start writing* | *As soon as I add the keywords* writes every new keyword straight away; the finished drafts then wait for their times. Or *a set time before it goes live* — an article needs ChatGPT, its images and WordPress, so leave enough room (12 hours writes tonight's list during the evening). At most ten articles of one website are written ahead at a time; the rest follow as those finish. |
| *Images* | Follow the website's own switches, or force images on or off for this list. |
| *This website may publish by itself* | Off by default. Off, the app only ever saves drafts, exactly as before. On, a finished article is handed to WordPress as a **scheduled** post, and WordPress publishes it at its time even when this computer is off. |
| *WordPress time zone* | The zone under Settings → General in WordPress. The Pakistan time is converted into it, so 04:30 in Pakistan is entered as 01:30 on a German site. It is read from WordPress by itself the first time. |
| *Ask Google to index it* | After the article is live, Search Console is opened in that website's own browser profile and the address is sent with *Request indexing*. |
| *Search Console property* | Exactly as Search Console writes it: `https://example.com/` or `sc-domain:example.com`. Sign in to Search Console once in the website's browser profile — no account is shared with the app and no key is stored. Google allows roughly ten requests a day per property. |

**The keyword list.** One article per line: `keyword | secondary keywords | title`. Only the keyword is needed; a
title is handed to the writer as the example title, and columns pasted from a sheet work the same way. *Upload CSV*
takes a file with the columns `keyword`, `title`, `secondary_keywords` and `kind` (`celebrity` or `tigram` — the app
works the kind out itself when the column is missing). The app then works out which writer each one needs: the wording first ("… wife", "… net worth" is a person;
"best …", "… near me", "download …", a version number is not), then Wikidata, which knows whether a name belongs to a
person or to a film, a town or a piece of software. Anything neither can decide stays open and is chosen in the list.
Celebrity keywords go through the Celebrity Article Writer with its prompts, the rest through the Tigram Article Writer.

**What happens to each keyword:** *waiting* → *writing* → *ready* → *scheduled* → *published* → *indexed*. The title
and article approval gates are answered by the workflow itself, so a list runs without stopping. If an article fails,
it loses its slot, moves to the next free time and says why in the list and in the log; after three tries it is left
alone. An article that is not finished in time also takes the next free slot instead of going out late.
| ✓ | | | Draft Created / Needs Review |

> **Terms of service.** Automating the ChatGPT website may conflict with OpenAI's Terms of Use and can lead to rate limits or account restrictions. Use your own account responsibly, keep concurrency low, and review generated facts before publishing.

## Setup details

`npm run setup` is safe to run again at any time (for example after updating the app). It:

1. Creates `.env` with a random `SESSION_SECRET` (or repairs an old one).
2. Creates the private `data/` folder.
3. Creates or updates the database file `data/app.db`.
4. Loads default settings and the default prompts (your edited prompts are never overwritten).
5. Checks that Google Chrome is installed.

`.env` options (you normally don't need to change them — see `.env.example`):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Database file. Default `file:../data/app.db` (relative to the `prisma/` folder). |
| `SESSION_SECRET` | ≥ 32 random characters, generated by setup. Keep it private. |
| `DATA_DIR` | Private folder for the database, browser profiles and screenshots (default `./data`). |
| `BROWSER_CHANNEL` | `chrome` (default), `msedge`, or `chromium` (Playwright's bundled Chromium — setup installs it). |
| `BROWSER_EXECUTABLE_PATH` | Optional absolute path to a Chrome/Chromium binary. |
| `COOKIE_SECURE` | `true` only when the dashboard is served over HTTPS. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional: create the admin during setup instead of on the first visit. |

To add another dashboard user or reset a password:

```bash
npm run user:create -- you@example.com "a-new-strong-password"
```

**WordPress browser mode** (Settings → Browser):

| Mode | Behaviour |
| --- | --- |
| Headless | Invisible. Fastest; some sites show extra verification to headless browsers. |
| Background window | A real Chrome window positioned off-screen. |
| Visible | Normal window — useful for watching or debugging. |

Login windows (*Open … Login Browser*) are always visible.

## Browser profiles, ChatGPT login and WordPress login

A **browser profile** is a Chrome user-data directory in `data/profiles/<name>` holding the WordPress cookies. The app never sees or stores your ChatGPT/WordPress passwords.

- Each **website** gets its own WordPress profile (created when you add the site), or you can share one between sites on the same login.

### ChatGPT through the Chrome extension

ChatGPT blocks browsers that are controlled by automation tools with a "Verify you are human" check. The app therefore sends ChatGPT prompts through a small Chrome extension (`extension/` folder) that runs in **your own Chrome** — no Playwright on the ChatGPT side. WordPress drafts are created by the worker's browser.

The extension runs in a **separate automation Chrome** (Settings → *Chrome for ChatGPT*). It is a normal Google Chrome with its own folder (`data/chatgpt-chrome`) started with switches that keep a window drawing while other windows cover it — so ChatGPT's answers and pictures finish while you work in other windows, and the ChatGPT window never has to jump to the front. One-time setup:

1. In the app: **Settings → ChatGPT Chrome extension → Open automation Chrome**. A separate Chrome opens with ChatGPT and `chrome://extensions`.
2. There, turn on **Developer mode**, click **Load unpacked** and choose the project's `extension` folder.
3. Log in to ChatGPT in that Chrome yourself.
4. In the app: **Create connection key**, copy it. Click the extension's icon in the automation Chrome (puzzle icon → *Blog Automation Studio*), paste the key, keep the app address `http://localhost:3000`, click **Save & test**. A new key switches off an extension that is still installed in your normal Chrome — remove it there.
5. Set **Settings → Task Concurrency** to how many articles should be written at the same time (for example 3).

From then on the worker opens the automation Chrome by itself whenever prompts are waiting. It may stay behind other windows; do not minimize it and keep the computer unlocked.

(*A profile of my normal Chrome* is still available in Settings; then Chrome slows the ChatGPT window down when it is covered and the extension brings it to the front.)

That's all — there is no Start button. When articles are queued, the extension (it checks every 30 seconds) opens one ChatGPT tab per article — up to Task Concurrency — by itself, in one window or in separate windows (choose in the extension), and closes a tab about 20 seconds after its article's ChatGPT steps are done. Each tab takes the next waiting prompt, pastes it, waits until ChatGPT has completely finished and returns the answer. All prompts of one article stay in one ChatGPT conversation. If that Chrome profile is not open, the worker opens it. The extension's *Pause automatic start* button switches this off.

Good to know:

- Keep the ChatGPT window open and not minimized (behind other windows is fine in the automation Chrome). Chrome slows down tabs that are not the selected tab of their window, so in one-window mode the extension switches between its tabs inside that window — don't type in that window. Closing a tab hands its prompt back to the queue (the stage is retried).
- If ChatGPT asks you to log in or to *verify you are human*, the extension shows a Windows notification and waits up to 10 minutes. Do it in that window; the article continues. The extension never tries to get around these checks.
- If nothing picks a prompt up for 30 minutes (Chrome closed, extension stopped), the task switches to **Login Required**. It resumes by itself once the extension is started again.
- Many prompts in a short time can hit ChatGPT's usage limits, and ChatGPT's terms restrict automated use of the website — use a sensible Task Concurrency.
- After updating the extension files, click **Reload extension** in its popup (or the reload icon on `chrome://extensions`).

### WordPress login (once per website)

1. **Websites → Add Website**: name, site URL, optional admin URL (defaults to `/wp-admin/`), editor type (auto-detect is fine).
2. Add the **categories** exactly as they're named in WordPress (e.g. `Celebrities, Actors, Actresses, Musicians, Athletes, Influencers, Business People`), and optionally pick a default category.
3. Click **Login** on the website card, sign in to wp-admin (tick *Remember Me*), close the window.
4. Click **Test Session**.

Other session buttons: **Refresh Session** (reopens the profile to renew and save cookies), **Open Browser** (look around manually), **Delete Session / Reset Browser Session** (wipes cookies so you can log in as someone else).

When a WordPress session later expires, tasks switch to **Login Required**. Click **Reconnect WordPress** (queue or article page), log in, close the window, then **Test Session** — waiting tasks resume automatically from their last completed stage. For ChatGPT, log in again in the extension's Chrome window; waiting tasks resume by themselves.

## Using the dashboard

1. **Celebrity Article Writer** → enter the *Target Keyword* (e.g. `Sydney Sweeney`), optional example title, website, category, secondary keywords, country and language → **Start Article**. For bulk use *Multiple keywords* — one article per line, each with its own secondary keywords after a `|` (e.g. `Sydney Sweeney | Sydney Sweeney movies, Sydney Sweeney height`; two columns pasted from Google Sheets work too) — or *CSV import*.
2. Watch progress on the **Dashboard** or **Article Queue**.
3. With **Manual Title Approval** on, the task pauses — pick a title on the article's *Titles* tab.
4. With **Manual Article Approval** on (or auto-send off), review in the *Editor* tab, then **Create WordPress Draft**.
5. When finished the article page shows **Draft Created Successfully**, the **Rank Math Score**, the **SEO Readiness Score** and **Open WordPress Draft**.
6. **Article History** actions: View, Edit, View Research, View ChatGPT Conversation, View Prompts, View Responses, Retry, Regenerate Stage, Run SEO Check, Send to WordPress (updates the same draft — no duplicates), Open WordPress Draft, Delete.

### CSV format

```csv
keyword,example_title,website,category,secondary_keywords
Sydney Sweeney,"Sydney Sweeney Age, Biography, Net Worth",My Celeb Blog,Actresses,"Sydney Sweeney movies, Sydney Sweeney height"
Jenna Ortega,,My Celeb Blog,Actresses,
```

`website` may be the website name or its domain. Optional extra columns: `target_country`, `language`.

### Prompt variables

`{{keyword}}`, `{{example_title}}`, `{{selected_title}}`, `{{research}}`, `{{article}}`, `{{final_article}}`, `{{country}}`, `{{language}}`, `{{secondary_keywords}}`, `{{category}}`, `{{max_words}}`, `{{min_keyword_occurrences}}`, `{{max_keyword_occurrences}}`, `{{faq_count}}`, `{{bio_rows_range}}`, `{{seo_title}}`, `{{meta_description}}`, `{{rankmath_issues}}`.
Conditional blocks: `{{#if example_title}}…{{/if}}` and `{{#unless …}}…{{/unless}}`.

### SEO scores

- **SEO Readiness Score** is the app's own checker (keyword placement, frequency, density, word count, meta/title length, headings, paragraph length, FAQ and Quick Bio presence, duplicates, stuffing, empty headings, broken HTML, category, tag). It is **not** the Rank Math score.
- **Actual Rank Math Score** is read from the Rank Math panel in WordPress when visible. If it is below the target, the worker applies at most *Maximum Rank Math Attempts* rounds of safe fixes: SEO title, meta description, slug, and an optional content revision through the **SEO Correction Prompt**. Revisions that exceed the word limit, drop headings or raise density above 2.5% are rejected. Recommendations such as images, links or power words are left for you and listed under *Needs Review*.

### External links

Settings → *SEO & Rank Math* → **Add external links**. After the Quick Bio step ChatGPT suggests links for people, movies and shows, universities and places named in the article (Wikipedia in the article's language first, then IMDb or official sites). The app checks every suggestion before adding it:

- only trusted sites: Wikipedia, IMDb, a list of large reference/news sites, universities and public bodies — never social media, shops, gossip or net-worth sites;
- the page must really exist and be about those words (Wikipedia pages are opened, IMDb ids are compared with Wikidata, disambiguation pages are refused);
- the words must appear in the article text; each is linked once, in a paragraph (never in a heading), up to *Maximum external links*.

The task log lists every link that was added or refused and why. If ChatGPT gives no usable links the article simply continues without them.

> Keep the computer unlocked while articles are written: Chrome does not draw ChatGPT's answer while the screen is locked or the ChatGPT window is minimized.

### Internal link (previous article)

Websites → *Add website* / *Edit* → **Internal link line**. Each website has its own text, e.g. `Das könnte Ihnen gefallen:` for a German site. Leave it empty for no internal link.

Every article then ends with one bold line after the conclusion:

`<p><strong>Das könnte Ihnen gefallen: <a href="https://site/previous-article/">Full title of the previous article</a></strong></p>`

- The link goes to the **previous article added for the same website** (the order the keywords were added; cancelled ones are skipped). When several articles are written at once and the previous one has no title yet, the article waits up to 10 minutes for it.
- If the previous article is already published, the address and title come from the website feed (`/feed/`); otherwise its slug address is used (`https://site/<slug>/`).
- The first article for a website links to the newest post on that website.
- **Send to WordPress** checks the link again, so a draft always points to the previous article under its final title. The task log shows which article was linked.

### Tigram Article Writer

`/modules/tigram-writer` — type a keyword (or paste many), pick the website and start. The steps are:

| # | Stage | Where |
|---|---|---|
| 1 | Article (SEO title, meta description, slug, body, FAQs, conclusion) | ChatGPT |
| 2 | Category — one of the website's categories | ChatGPT |
| 3 | External links (checked before they are added) | ChatGPT + App |
| 4 | Images — ChatGPT plans 3 images with alt texts, then creates them one by one | ChatGPT + extension |
| 5 | Assembly + internal link, SEO check, WordPress draft, Rank Math | App + WordPress |

The prompt is editable in the **Prompt Manager** like every other prompt, and the article length follows *Maximum article word count* in Settings.

**Images** (Settings → *Add images*, on by default): a featured image with a short title text and two simple flat body images without text. The extension waits until ChatGPT has finished each picture, crops it to **1920×1080** and sends it to the app as a JPEG. The files are named after the keyword (`<slug>.jpg`, `<slug>-1.jpg`, `<slug>-2.jpg`, kept in `data/images/`), uploaded to the WordPress media library with their alt text, and placed in the draft: body image 1 after the second paragraph, body image 2 one paragraph before the FAQs; the first image becomes the **featured image**. If ChatGPT cannot create an image (for example its image limit), the draft is still saved and marked *Needs Review*. The extension needs version 1.3.0 or newer (popup → *Reload extension*).

### Celebrity article images

Celebrity articles use pictures from ChatGPT's image-search gallery. The default **Image Search Prompt** is:

> Search On google and give me any random colors pic high quality 5 to 10 pic simple pic random color.

The extension opens the returned gallery and saves up to ten distinct displayed pictures, like Chrome's **Save
image as**. It saves the displayed image file instead of following publisher URLs in alt text. JPEG, PNG and WebP
files keep their original bytes and dimensions, including smaller or portrait images. The website's **featured**
design creates one featured image, and its **body** design creates two body images, all at 1920×1080. Split designs
use separate source pictures for their slots. When fewer originals are available, the body designs can reuse the
downloaded sources used in the featured design. Only pictures obtained through the ChatGPT answer are used.

Enable **Settings → Add article images** and the website's **Celebrity images** switch. The Images stage is shown
in the article workflow and can be regenerated independently. WordPress receives the images, alt text, featured
image selection and body placements through the existing browser automation. Missing images leave a review reason.
After updating, reload the ChatGPT Worker extension to version **1.6.4**. Update the unpacked folder shown in Chrome's extension details; Sessions displays the connected version. Older page scripts and incomplete image downloads pause the image stage instead of continuing to WordPress without images. Downloads use the images displayed by ChatGPT/OpenAI or Bing; publisher domains referenced in image descriptions do not need extra permissions.

The extension excludes article and canvas editors when locating the chat prompt box. If ChatGPT opens a full-screen
writing view, the next stage reopens the saved conversation once before entering its prompt. Prompt entry must match
the complete requested text, so an appended instruction cannot be mistaken for a successful paste.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Create `.env`, the data folder, the database and default prompts (safe to re-run) |
| `npm run dev:all` | **Start the app**: dashboard + automation worker together |
| `npm run dev` / `npm run worker:dev` | Dashboard only / worker only (development, auto-reload) |
| `npm run build` then `npm run start:all` | Production build, then start dashboard + worker |
| `npm run user:create -- <email> <password>` | Add a dashboard user or reset a password |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:migrate` | Create a migration after changing `prisma/schema.prisma` (developers) |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests + real-browser tests (ChatGPT extension against a simulated ChatGPT page, publish guard) |

The browser tests use installed Chrome by default; set `BROWSER_CHANNEL=chromium` to use Playwright's Chromium.

`tests/wordpress-editor.e2e.test.ts` is an optional end-to-end test of the block-editor draft flow. It is skipped unless `WP_E2E_ADMIN_URL` points at a disposable, already-logged-in WordPress (for example WordPress Playground). Don't point it at your live site — it creates draft posts.

## Running on a server

The simplest and recommended setup is your own computer, because the ChatGPT extension runs in your Chrome and WordPress login windows open where the worker runs. If you want it on a Linux VPS:

1. Install Node.js and Google Chrome (`wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install ./google-chrome-stable_current_amd64.deb`).
2. `npm ci`, `npm run setup`, `npm run build`.
3. Keep it running with **pm2**: `npm i -g pm2`, `pm2 start npm --name blog-web -- run start`, `pm2 start npm --name blog-worker -- run worker`, `pm2 save && pm2 startup`.
4. Put the dashboard behind **HTTPS** (Nginx/Caddy reverse proxy to port 3000), set `COOKIE_SECURE=true`, restrict access (firewall/VPN), and **create the admin account immediately** after the first start.
5. **Logging in on a server without a screen:** run the worker under a virtual display (`sudo apt install xvfb x11vnc`, `Xvfb :99 &`, `export DISPLAY=:99`) and view it through VNC over an SSH tunnel — or log in on your own computer and copy the profile folder from `data/profiles/` to the server (same Chrome version; stop the worker first).
6. Keep **exactly one worker** per `data/` folder.

## Reliability features

- Element-based waiting everywhere (no fixed sleeps for page state); multiple fallback selectors per element; user-defined selector overrides in *Settings → Advanced*.
- ChatGPT completion (extension) = no Stop button, the answer text unchanged for a moment **and** ChatGPT's Copy/feedback buttons under the answer; clicks *Continue generating*; handles "which response do you prefer" and document-style "writing block" answers.
- Retry safety: before re-sending a prompt the client checks whether the conversation already contains it and recovers/regenerates the answer instead of duplicating content.
- Conversation URL stored per task; if the conversation cannot be reopened, earlier outputs are supplied as context automatically.
- WordPress: the draft is saved immediately after inserting content and its edit URL stored, so retries and *Send to WordPress* reopen the same post. The editor is switched back to visual mode if it was left in code mode, and tag/category lookups are awaited before saving.
- Login expiry and human-verification pages → **Login Required** (not Failed).
- Crash-safe queue: if the worker stops mid-article (closed window, PC restart), the job is re-queued on the next start and continues from the last completed stage.
- The dashboard shows a warning when the worker is not running.
- Configurable timeouts, retry attempts with backoff, cancellation.
- Screenshots on failures: `chatgpt-error`, `wordpress-error`, `rankmath-error`, `*-login-required`.

## Security

- Dashboard protected by login (bcrypt-hashed password, signed HTTP-only session cookie, login rate limiting). The first-run admin screen only works while no account exists.
- CSRF protection: same-origin check + double-submit token on every state-changing API request.
- Input validation with Zod on every API route; Prisma parameterized queries (no raw SQL with user input).
- Article HTML sanitized with an allow-list on save and before display; React escapes all other output. Security headers and a production CSP.
- No ChatGPT/WordPress passwords are stored anywhere; logs redact credential-like fields.
- The database, browser profiles and screenshots live in `data/` (private permissions on Linux/macOS, git-ignored, never web-served; screenshots are served only to signed-in users with path validation). **Treat `data/profiles` like a password:** it contains live login cookies.
- Secrets via `.env` only.

## Backups and updates

- **Back up:** stop the app, then copy the `data/` folder (database + saved logins) and `.env`.
- **Update the app:** stop it, replace the code, run `npm install`, then `npm run setup` (applies any database changes), then `npm run dev:all`.
- **Start completely fresh:** stop the app, delete the `data/` folder, run `npm run setup`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Dashboard says "The automation worker is not running" | Start the app with `npm run dev:all` (not just `npm run dev`) and keep that window open. |
| Buttons say "The automation worker did not respond" | Same as above. |
| Worker says "Another automation worker is already running" | Another `npm run dev:all` window is open — close it (or use that one). |
| "Invalid environment configuration" or "database file could not be opened" | Run `npm run setup`. |
| `npm run setup` says it could not update the database client | Stop the app (Ctrl+C in its window), then run setup again. |
| Task says *Waiting for the ChatGPT Chrome extension* | Open the Chrome profile with the extension (the worker also tries to open it). Check that automatic start is not paused in the extension and that the connection key is saved. Settings → *ChatGPT Chrome extension* shows whether it is connected. |
| Extension says *Wrong connection key* | Create a new key in Settings and paste it into the extension. |
| Task shows *Login Required* repeatedly | WordPress: log in via the login browser, **close the window**, then *Test Session*. ChatGPT: log in (or complete "verify you are human") in the extension's Chrome window. The app does not try to get around such checks. |
| Test Session says "login window is still open" | Close the normal Chrome window you logged in with — cookies are saved when it closes. |
| "Profile is open in another Chrome process" | Close any Chrome window using that profile (e.g. a login window) and retry. |
| WordPress UI changed and a step fails | Check the failure screenshot in *Logs*, then add updated selectors in *Settings → Advanced → selector overrides* (keys match `src/automation/wordpress/selectors.ts`). If ChatGPT's page changed, the extension's diagnostics are logged with the failed step. |
| Category not selected | The category name must match WordPress exactly, or enable *Create missing categories*. |
| Rank Math score not detected | Make sure the Rank Math plugin is active and its sidebar/metabox is enabled for posts. |
| `Executable doesn't exist` | Install Google Chrome, or set `BROWSER_CHANNEL="chromium"` in `.env` and run `npm run setup`. |
| Forgot the dashboard password | `npm run user:create -- your@email.com "new-password"` |

## Adding future modules

The queue, pipeline engine, browser clients, prompt manager, SEO toolkit and UI components are shared. A new module (General Guest Post Writer, Local SEO Writer, Product Review Writer, News Writer, Keyword Research, Internal Linking, SEO Audit, Bulk Content Generator…) needs a **manifest**, **prompts**, a **pipeline** and a **page**. See **[docs/ADDING_MODULES.md](docs/ADDING_MODULES.md)**.

## Project structure

```
extension/                    ChatGPT Worker Chrome extension (load unpacked in Chrome)
prisma/                       database schema (SQLite), migrations, seed
scripts/setup.ts              one-command setup
scripts/create-user.ts        add/reset dashboard users
src/
  app/
    (dashboard)/              dashboard pages (queue, history, articles/[id], websites, prompts, settings, logs, modules)
    api/                      route handlers (auth + first-run setup, tasks, websites, profiles, prompts, settings, logs, stats…)
    login/                    sign-in / create-admin page
  automation/
    browser/                  BrowserManager (persistent profiles), locator helpers, screenshots
    chatgpt/                  bridge to the ChatGPT Chrome extension (prompt queue)
    wordpress/                WordPress client, block & classic editors, Rank Math panel, publish guard
    pipeline/                 generic resumable stage engine
  components/                 UI kit, editor, article panels, session controls
  content/                    ChatGPT output cleanup, titles/FAQ/Quick Bio parsing, assembly, SEO meta
  lib/                        env, db, built-in job queue, auth, settings, logger, validation, services
  modules/                    module registry, manifests, prompts, worker pipelines
  seo/                        keyword metrics and SEO checker
  worker/                     worker entry point, job runner and session-control jobs
  middleware.ts               auth + CSRF
data/                         created by setup: app.db, browser profiles, screenshots (private, not in git)
tests/                        unit tests and browser tests
docs/ADDING_MODULES.md
```
