import type { PromptDefinition, PromptVariableDoc } from '../types';

export const CELEBRITY_PROMPT_KEYS = {
  titles: 'titles',
  research: 'research',
  longArticle: 'long_article',
  finalArticle: 'final_article',
  faqs: 'faqs',
  quickBio: 'quick_bio',
  externalLinks: 'external_links',
  images: 'images',
  imageReview: 'image_review',
  seoCorrection: 'seo_correction',
} as const;

const TITLES = `Generate some best titles for my blog post.

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
Recommended Title: <the title>`;

const RESEARCH = `Collect all available reliable information about the keyword:
"{{keyword}}"

The article title is:
"{{selected_title}}"

Make sure the research provides deep details about the person where information is publicly available, including:

Age
Date of Birth
Birthplace
Nationality
Family
Parents
Mother
Father
Siblings
Relationship Status
Boyfriend
Girlfriend
Partner
Wife
Husband
Children
Education
Early Life
Career
Movies
TV Shows
Projects
Awards
Achievements
Lifestyle
Height
Physical Appearance
Net Worth
Income Sources
Social Media Presence
Recent Updates
Interesting Facts

and other useful information related to the person.

The information should be detailed enough to create a complete celebrity biography article.
Do not invent personal information.
Do not present rumors as confirmed facts.
Clearly describe net worth figures as estimates when they are not officially verified.`;

const LONG_ARTICLE = `Now using all the information collected above, write a 1,500 to 2,000-word, humanized and SEO-optimized blog article.

Use the article title provided earlier: "{{selected_title}}"

Focus on the primary keyword:
"{{keyword}}"
{{#if secondary_keywords}}
Where they fit naturally, also use these secondary keywords: {{secondary_keywords}}
{{/if}}
Write in {{language}} for readers in {{country}}.

Strict Formatting & Writing Rules:

Paragraph Format Only:
Write the article in natural narrative paragraphs.
Do not use bullet points.
Do not use numbered lists.
Avoid short, disconnected sentences.

Flow & Structure:
Use medium-length flowing paragraphs.
Most paragraphs should contain approximately 3 to 5 sentences.

Tone & Style:
Use an accessible and easy-to-read writing style.
The tone should be engaging, informative and human-like.
Avoid robotic AI-style wording.

Headings:
Organize the article using proper H2 and H3 headings (use Markdown ## for H2 and ### for H3).
All content beneath headings must remain in paragraph form.

Keyword Usage:
Use the primary keyword approximately {{min_keyword_occurrences}} to {{max_keyword_occurrences}} times when it reads naturally.
Do not keyword stuff.
Use pronouns such as he, she, him, her, his and their name variations naturally.
Do not bold the main keyword just for SEO purposes.

Important Information:
Bold genuinely important names, movies, projects, awards, events and facts where useful.
Do not fabricate information.
Avoid unnecessary repetition.
Create a useful introduction and conclusion.
Do not add FAQs or the Quick Bio table yet.`;

const FINAL_ARTICLE = `Now rewrite and optimize the previous article into the final publishable version.

Maximum Word Count:
{{max_words}} words.

Follow good SEO practices while keeping the article natural.
Use proper H2 and H3 headings (Markdown ## for H2 and ### for H3).
Write useful content underneath each heading.
Aim for approximately 40 to 70 words under smaller subheadings where suitable.
Larger sections may contain multiple natural paragraphs.
Do not use bullet points or numbered lists inside the main article.
Remove unnecessary filler.
Remove repeated information.
Avoid spammy wording.
Avoid obvious AI phrases.
Make the article easy to read.
Include the primary keyword "{{keyword}}" naturally in the introduction.
Use the keyword naturally in relevant headings when appropriate.
Use semantic and related terms naturally.
Do not fabricate facts.
Keep a short introduction at the top and finish with a conclusion section.

Output only the final article.
Do not include the article title as a heading.
Do not write comments such as:
"Here is your article"
"Certainly"
"I hope this helps"
or similar AI commentary.`;

const FAQS = `Write exactly {{faq_count}} short frequently asked questions for this article about "{{keyword}}".

Provide short, useful and accurate answers.
Questions should reflect realistic searches people may make about the celebrity.
Do not invent facts.

Format each FAQ as the question on its own line (ending with a question mark), followed by its answer on the next line.
Output only the FAQs without any introduction or closing comments.`;

const QUICK_BIO = `Create a Quick Bio table for this celebrity article about "{{keyword}}".

Use approximately {{bio_rows_range}} relevant rows.

Possible fields include:
Full Name
Known As
Profession
Date of Birth
Age
Birthplace
Nationality
Education
Relationship Status
Height
Net Worth
Famous For
Social Media

Only use information supported by the research.
Do not invent missing values.
If important information is unavailable, use wording such as:
Not publicly confirmed

Return a clean two-column HTML-compatible table.
Column 1: Attribute
Column 2: Details

Output only the table.`;

const EXTERNAL_LINKS = `Suggest external links for the final article about "{{keyword}}" (the article is repeated below).

Choose {{link_count}} words or short phrases that appear exactly like this in the article text (same spelling) and that readers may want to look up, for example:
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
{{final_article}}`;

const SEO_CORRECTION = `The Rank Math SEO plugin reported these issues for the article about "{{keyword}}":

{{rankmath_issues}}

Revise the final article below so that the issues that can be fixed naturally inside the content are resolved — for example using the focus keyword "{{keyword}}" early in the introduction, or in one relevant subheading.

Rules:
Keep the article at or under {{max_words}} words.
Keep every fact the same and do not invent new information.
Keep Markdown ## H2 and ### H3 headings.
Write in paragraphs only, with no bullet points or numbered lists.
Do not keyword stuff and do not damage readability just to raise a score.

Output only the revised article with no comments.

Article:
{{final_article}}`;

const IMAGE_REVIEW = `I am writing an article about "{{keyword}}". I attached {{photo_count}} photos from an image search, numbered 1 to {{photo_count}} in the order they are attached.

For every photo, write one line in exactly this format:
<number>: watermark=<yes or no> | collage=<yes or no> | alt=<alt text>

watermark=yes when the photo has a watermark, a website name or web address, a channel or photo agency logo, or large text written over the picture. Text that belongs to the scene itself (a sign, the backdrop at an event, a shirt print) does not count.
collage=yes when the picture is not one photo but several photos put together: side by side, split by a line, in frames or a grid, or a designed thumbnail with shapes, borders or boxes around photos.
alt: at most 12 words describing what is visible: the place, the occasion, what the people wear or do. Do not name anyone and do not guess who the people are; the name is added separately.

Write nothing else.`;

export const CELEBRITY_PROMPTS: PromptDefinition[] = [
  {
    key: CELEBRITY_PROMPT_KEYS.titles,
    name: 'Title Prompt',
    description: 'Step 1 — generates title ideas and recommends the strongest one.',
    defaultContent: TITLES,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.research,
    name: 'Research Prompt',
    description: 'Step 2 — collects reliable biography information in the same conversation.',
    defaultContent: RESEARCH,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.longArticle,
    name: 'Long Article Prompt',
    description: 'Step 3 — writes the long 1,500–2,000 word humanized article.',
    defaultContent: LONG_ARTICLE,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.finalArticle,
    name: 'Final Optimization Prompt',
    description: 'Step 4 — rewrites into the final publishable article (max word count).',
    defaultContent: FINAL_ARTICLE,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.faqs,
    name: 'FAQ Prompt',
    description: 'Step 5 — writes the FAQs.',
    defaultContent: FAQS,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.quickBio,
    name: 'Quick Bio Prompt',
    description: 'Step 6 — builds the Quick Bio table.',
    defaultContent: QUICK_BIO,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.externalLinks,
    name: 'External Links Prompt',
    description: 'Step 7 — suggests 3–5 trusted external links (Wikipedia, IMDb, official sites); every link is checked before it is added.',
    defaultContent: EXTERNAL_LINKS,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.images,
    name: 'Image Search Prompt',
    description: 'Finds colour/background pictures in ChatGPT. The website templates turn them into a featured image and two body images.',
    defaultContent: 'Search On google and give me any random colors pic high quality 5 to 10 pic simple pic random color.',
  },
  {
    key: CELEBRITY_PROMPT_KEYS.imageReview,
    name: 'Photo Check Prompt',
    description: 'Sent with the chosen gallery photos attached: finds photos with a watermark or site name (they are used last) and describes each photo for its alt text.',
    defaultContent: IMAGE_REVIEW,
  },
  {
    key: CELEBRITY_PROMPT_KEYS.seoCorrection,
    name: 'SEO Correction Prompt',
    description: 'Used during Rank Math optimization when content-level recommendations fail.',
    defaultContent: SEO_CORRECTION,
  },
];

export const CELEBRITY_VARIABLES: PromptVariableDoc[] = [
  { name: 'keyword', description: 'Target keyword', sample: 'Sydney Sweeney' },
  {
    name: 'example_title',
    description: 'Optional example title',
    sample: 'Sydney Sweeney Age, Biography, Family, Career, Net Worth and Latest Updates',
  },
  { name: 'selected_title', description: 'Title chosen in Step 1', sample: 'Sydney Sweeney: Age, Career, Family and Net Worth' },
  { name: 'secondary_keywords', description: 'Comma separated secondary keywords', sample: 'Sydney Sweeney movies, Sydney Sweeney height' },
  { name: 'country', description: 'Target country', sample: 'United States' },
  { name: 'language', description: 'Article language', sample: 'English' },
  { name: 'category', description: 'Selected WordPress category', sample: 'Actresses' },
  { name: 'research', description: 'Research response text (Step 2)', sample: '[research text]' },
  { name: 'article', description: 'Long article text (Step 3)', sample: '[long article]' },
  { name: 'final_article', description: 'Final article as Markdown (Step 4 / edited)', sample: '[final article]' },
  { name: 'max_words', description: 'Maximum article word count setting', sample: '1,300' },
  { name: 'min_keyword_occurrences', description: 'Minimum keyword occurrences setting', sample: '15' },
  { name: 'max_keyword_occurrences', description: 'Maximum keyword occurrences setting', sample: '18' },
  { name: 'faq_count', description: 'Number of FAQs setting', sample: '5' },
  { name: 'bio_rows_range', description: 'Quick Bio rows range from settings', sample: '11 to 13' },
  { name: 'seo_title', description: 'Current SEO title', sample: 'Sydney Sweeney Age, Career and Net Worth' },
  { name: 'meta_description', description: 'Current meta description', sample: 'Learn about Sydney Sweeney…' },
  { name: 'link_count', description: 'How many link suggestions to ask for (External Links only)', sample: '5 to 7' },
  { name: 'wikipedia_site', description: 'Wikipedia in the article language (External Links only)', sample: 'en.wikipedia.org' },
  { name: 'photo_count', description: 'How many photos are attached (Photo Check only)', sample: '6' },
  { name: 'rankmath_issues', description: 'Failed Rank Math checks (SEO Correction only)', sample: '- Use Focus Keyword at the beginning of your content.' },
];
