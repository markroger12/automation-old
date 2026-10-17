import type { PromptDefinition, PromptVariableDoc } from '../types';

export const TIGRAM_PROMPT_KEYS = {
  article: 'article',
  category: 'category',
  externalLinks: 'external_links',
  imagePlan: 'image_plan',
  image: 'image',
  seoCorrection: 'seo_correction',
} as const;

const ARTICLE = `PRIMARY KEYWORD: {{keyword}}
SECONDARY KEYWORDS: {{secondary_keywords}}

🤖 ROLE

You are a world-class SEO strategist, content writer, and Google ranking expert. Your job is to create a fully optimized, top-ranking blog article that can compete for Page 1 of Google.

🎯 CORE OBJECTIVE

Create a blog post that:

Matches search intent perfectly
Outperforms the top 5 Google results
Is optimized for SEO + NLP + EEAT
Maximizes CTR, readability, and engagement
Provides the most complete answer on the internet for this keyword

🧠 BEFORE WRITING (DO INTERNALLY)

Analyze:

User search intent (informational / commercial / transactional)
What top-ranking pages are doing
What they are missing
How to make this article 10x better
What the reader truly wants to achieve

📝 OUTPUT FORMAT — follow it exactly

Start with these three lines, each on its own line and nothing before them:

SEO TITLE: <under 60 characters, primary keyword near the front, click-worthy>
META DESCRIPTION: <100–150 characters, contains the primary keyword, benefit + curiosity + CTA>
URL SLUG: <short, lowercase, hyphen-separated, keyword-focused>

Then write the article itself, starting directly with the introduction. Do not repeat the title as a heading and do not write section labels such as "Introduction" or "Featured snippet".

1. INTRODUCTION (100–150 words)
Strong hook (question, stat, or bold claim)
Name the reader's problem
Primary keyword used naturally in the first 100 words
Promise the solution clearly

2. FEATURED SNIPPET PARAGRAPH (40–60 words)
Right after the introduction, one short paragraph that answers the main keyword directly, written for Google's "Position Zero".

3. MAIN ARTICLE BODY
5–7 H2 headings (## in Markdown), H3 subheadings where needed
Short paragraphs (2–4 lines), bullet points where they help
ONE step-by-step section
ONE comparison table or pros/cons table
Real examples or case-style explanations
Natural use of the primary keyword, the secondary keywords and related NLP terms and entities

4. FAQ SECTION
An H2 with exactly this heading: Frequently Asked Questions
Then 7 questions taken from Google "People Also Ask", each as an H3, with a 40–60 word answer in a paragraph under it.

5. CONCLUSION
An H2 heading "Conclusion", then 100–150 words: summarize the key points, use the primary keyword naturally once, end with a strong CTA.

⚙️ SEO RULES
Write for humans first, Google second
Semantic SEO: related terms and context, never keyword stuffing
E-E-A-T: expert, experienced, trustworthy tone
No fluff, no filler sentences — every section adds real value
Mobile-friendly formatting

🏆 FINAL RULE
Strict: the whole article must be {{word_range}} words.
It must be better, deeper and more useful than anything currently ranking in the Google top 5 results.`;

const CATEGORY = `These are the categories of the website where this article will be published:

{{categories}}

Pick the ONE category that fits this article best.
Keyword: "{{keyword}}"
Title: "{{selected_title}}"

Answer with exactly one line and nothing else:
CATEGORY: <copy one category exactly as written above>`;

const EXTERNAL_LINKS = `Suggest external links for the article about "{{keyword}}" (the article is repeated below).

Choose {{link_count}} words or short phrases that appear exactly like this in the article text (same spelling) and that readers may want to look up, for example:
- companies, brands, products, apps or software mentioned in the article
- organisations, universities, institutions and official bodies
- well-known people, movies, TV shows, books or places
- standards, laws, technologies or medical/scientific terms

For each phrase give one link to a trusted page about exactly that thing:
1. Wikipedia ({{wikipedia_site}}) — first choice
2. the official website of the company, product, organisation or institution
3. a major trusted reference site such as Britannica, or an official government or health authority page

Use web search to make sure every page really exists and is about the right thing.
Never link to social media, online shops, gossip sites, net-worth sites or competitors' blogs.
Do not link the phrase "{{keyword}}" itself and do not rewrite the article.

Answer only with one line per link in exactly this format and nothing else:
LINK: <phrase exactly as written in the article> | <full URL>

Article:
{{final_article}}`;

const IMAGE_PLAN = `Plan 3 images for this article about "{{keyword}}". Do not create the images yet.

Image 1 — FEATURED IMAGE (blog header), landscape.
It shows this short title text, spelled exactly: "{{image_title}}".
Large, bold, easy to read text in the middle, with empty space above and below it (the top and bottom edges will be cropped to 16:9).
Clean, modern background that fits the topic, strong contrast, no logos, no watermark, no other words.

Image 2 — BODY IMAGE, landscape. A simple flat illustration of the main topic of the article.
Image 3 — BODY IMAGE, landscape. A simple flat illustration of another key part of the article (for example the step-by-step part or the comparison).

Body image style (images 2 and 3): minimal flat illustration, soft colours, plain light background, lots of empty space, only a few simple objects, NO text, letters or numbers at all, no logos, no faces.

Answer only with these six lines and nothing else:
IMAGE 1 PROMPT: <complete prompt for image 1, including the title text and style>
IMAGE 1 ALT: <alt text, max 120 characters, contains "{{keyword}}">
IMAGE 2 PROMPT: <complete prompt for image 2, including the style>
IMAGE 2 ALT: <alt text, max 120 characters>
IMAGE 3 PROMPT: <complete prompt for image 3, including the style>
IMAGE 3 ALT: <alt text, max 120 characters>`;

const IMAGE = `Create this image now, landscape (wide) format:

{{image_prompt}}

Only create the image — no text answer is needed.`;

const SEO_CORRECTION = `The Rank Math SEO plugin reported these issues for the article about "{{keyword}}":

{{rankmath_issues}}

Revise the article below so that the issues that can be fixed naturally inside the content are resolved — for example using the focus keyword "{{keyword}}" early in the introduction, or in one relevant subheading.

Rules:
Keep the article at or under {{max_words}} words.
Keep every fact the same and do not invent new information.
Keep the Markdown ## H2 and ### H3 headings, tables and lists.
Do not keyword stuff and do not damage readability just to raise a score.

Output only the revised article with no comments.

Article:
{{final_article}}`;

export const TIGRAM_PROMPTS: PromptDefinition[] = [
  {
    key: TIGRAM_PROMPT_KEYS.article,
    name: 'Article Prompt',
    description: 'Step 1 — writes the complete SEO article (SEO title, meta description, slug, body, FAQs, conclusion).',
    defaultContent: ARTICLE,
  },
  {
    key: TIGRAM_PROMPT_KEYS.category,
    name: 'Category Prompt',
    description: 'Step 2 — picks one category from the categories of the selected website.',
    defaultContent: CATEGORY,
  },
  {
    key: TIGRAM_PROMPT_KEYS.externalLinks,
    name: 'External Links Prompt',
    description: 'Step 3 — suggests trusted external links; every link is checked before it is added.',
    defaultContent: EXTERNAL_LINKS,
  },
  {
    key: TIGRAM_PROMPT_KEYS.imagePlan,
    name: 'Image Plan Prompt',
    description: 'Step 4a — plans the featured image (with a short title text) and two simple body images, and writes their alt texts.',
    defaultContent: IMAGE_PLAN,
  },
  {
    key: TIGRAM_PROMPT_KEYS.image,
    name: 'Image Prompt',
    description: 'Step 4b — sent once per image: ChatGPT creates the picture; the app crops it to 1920×1080 and adds it to the draft.',
    defaultContent: IMAGE,
  },
  {
    key: TIGRAM_PROMPT_KEYS.seoCorrection,
    name: 'SEO Correction Prompt',
    description: 'Used during Rank Math optimization when content-level recommendations fail.',
    defaultContent: SEO_CORRECTION,
  },
];

export const TIGRAM_VARIABLES: PromptVariableDoc[] = [
  { name: 'keyword', description: 'Target keyword', sample: 'alo discount code' },
  { name: 'secondary_keywords', description: 'Comma separated secondary keywords', sample: 'alo yoga promo code, alo coupon' },
  { name: 'selected_title', description: 'SEO title from Step 1', sample: 'Alo Discount Code: 7 Ways to Save in 2026' },
  { name: 'example_title', description: 'Optional example title from the article form', sample: 'Alo Yoga Discount Codes That Actually Work' },
  { name: 'country', description: 'Target country', sample: 'United States' },
  { name: 'language', description: 'Article language', sample: 'English' },
  { name: 'categories', description: 'Categories of the selected website (Category step only)', sample: 'Deals, Guides, Reviews' },
  { name: 'category', description: 'Selected WordPress category', sample: 'Deals' },
  { name: 'word_range', description: 'Target article length from the word count setting', sample: '1,300 to 1,400' },
  { name: 'max_words', description: 'Maximum article word count setting', sample: '1,300' },
  { name: 'final_article', description: 'Current article as Markdown', sample: '[article]' },
  { name: 'seo_title', description: 'Current SEO title', sample: 'Alo Discount Code: 7 Ways to Save' },
  { name: 'meta_description', description: 'Current meta description', sample: 'Looking for an Alo discount code? …' },
  { name: 'image_title', description: 'Short title text for the featured image (Image Plan only)', sample: 'Alo Discount Code' },
  { name: 'image_prompt', description: 'One image description from the Image Plan (Image prompt only)', sample: 'A minimal flat illustration of a shopping bag…' },
  { name: 'link_count', description: 'How many link suggestions to ask for (External Links only)', sample: '5 to 7' },
  { name: 'wikipedia_site', description: 'Wikipedia in the article language (External Links only)', sample: 'en.wikipedia.org' },
  { name: 'rankmath_issues', description: 'Failed Rank Math checks (SEO Correction only)', sample: '- Use Focus Keyword at the beginning of your content.' },
];
