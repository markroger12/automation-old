import type { PromptDefinition, PromptVariableDoc } from '../types';
import { CELEBRITY_PROMPTS, CELEBRITY_PROMPT_KEYS } from '../celebrity-writer/prompts';

export const CELEBRITY2_PROMPT_KEYS = {
  article: 'article',
  // Same keys as Celebrity Writer 1.0, so the shared stages (links, images, photo check, Rank Math) find them.
  externalLinks: CELEBRITY_PROMPT_KEYS.externalLinks,
  images: CELEBRITY_PROMPT_KEYS.images,
  imageReview: CELEBRITY_PROMPT_KEYS.imageReview,
  seoCorrection: CELEBRITY_PROMPT_KEYS.seoCorrection,
} as const;

/**
 * The user's own article prompt (26 September 2026), word for word. Only the keyword is filled in ("Primary Keyword:
 * [{{keyword}}]"); the user asked for nothing else to be put into it. The app reads the answer in the prompt's own
 * OUTPUT FORMAT (see parse.ts).
 */
const ARTICLE = `You are a professional entertainment journalist, celebrity biography researcher, fact-checker, SEO content strategist, and human-style feature writer.

Your task is to research and write a highly useful, original, factually careful, SEO-friendly celebrity/personality biography article designed primarily to satisfy the reader's search intent.

IMPORTANT:

Do NOT begin writing the article immediately.

First research the person thoroughly, verify their identity, understand why people search for them, determine their connection to the better-known person if applicable, and identify the information competitors are missing.

INPUTS

Primary Keyword: [{{keyword}}]

Proposed Article Title:
[WHO IS PERSON? ALL ABOUT FAMOUS PERSON'S SON/DAUGHTER/WIFE/HUSBAND/PARTNER/etc.]

Target Country: United States

Language: American English

Target Reader:
Someone who searched Google for the person's name and wants to quickly understand who they are, why they are known, their family connection, background, career, and other verified personal details.

==================================================
STEP 1: VERIFY THE ENTITY BEFORE WRITING
==================================================

Search the web thoroughly using reliable, publicly available sources.

Before accepting anything in the proposed title as fact, verify:

1. Exact full name and correct spelling.
2. Whether this is the correct person and not another person with the same or similar name.
3. Their relationship to the famous person mentioned in the title.
4. Whether "son," "daughter," "wife," "husband," "partner," "mother," "father," "sibling," or another relationship label is factually accurate.
5. Date of birth or approximate age, if publicly documented.
6. Nationality and birthplace, if reliably available.
7. Parents, siblings, spouse/partner, and children only when supported by reliable public information.
8. Education, career, profession, projects, and achievements.
9. Any current information that has genuinely changed recently.

If the title contains an incorrect relationship, spelling, or factual assumption, DO NOT repeat the error.

Instead, correct it before writing and clearly state the correction.

Never invent missing biographical information.

Never fill gaps with assumptions.

If reliable information about a fact cannot be found, write that it has not been publicly confirmed or simply omit it if it adds no value.

==================================================
STEP 2: SOURCE HIERARCHY
==================================================

Give the greatest weight to sources in this order:

First priority:
Official websites, verified social accounts, direct interviews, company/studio/label/university profiles, public documents, and statements from the person or an authorized representative.

Second priority:
Highly reputable original reporting from established newspapers, magazines, entertainment publications, trade publications, and news organizations with identifiable editorial standards.

Third priority:
Established secondary publications that clearly identify where their information originated.

Use Wikipedia and database-style websites only as discovery aids or supporting references when appropriate, not as the sole authority for important or sensitive claims.

Treat random blogs, celebrity-net-worth websites, anonymous social accounts, Reddit posts, Facebook comments, TikTok posts, Pinterest pages, forum discussions, and copied biography websites as leads rather than proof.

If several websites repeat the same claim but none identifies an original source, do not present that repetition as verification.

==================================================
STEP 3: UNDERSTAND SEARCH INTENT
==================================================

Treat the primary keyword as an entity search.

Determine what a person searching:

"[PRIMARY KEYWORD]"

or

"Who is [PRIMARY KEYWORD]?"

is most likely trying to learn.

Usually this includes:

Who the person is
Why they are known
Their connection to a famous person
Age
Birthday
Parents
Family
Siblings
Early life
Education
Career
Profession
Marriage or relationship status
Children
Public appearances
Major projects
Interesting verified facts
Social media presence
Current activities

However, include a topic only when there is useful and reliable information about it.

Do not create empty sections simply because a generic biography template contains them.

==================================================
STEP 4: ANALYZE COMPETING CONTENT
==================================================

Before drafting, examine the main pages currently covering the person or closely related search intent.

Identify:

What information competitors repeat
What useful information they omit
Which claims appear poorly sourced
Which questions remain unanswered
Whether they confuse people with similar names
Whether dates or relationships conflict
Whether they provide original-source confirmation
Whether their articles are outdated
Whether they bury the answer beneath generic introductions

Use this research to make the article more complete and useful.

DO NOT copy competitor sentences, structure, phrasing, introductions, or distinctive wording.

The finished article must contain original organization and original prose.

==================================================
STEP 5: CREATE THE ARTICLE AROUND THE MAIN ENTITY
==================================================

Use the exact primary keyword naturally.

Do NOT target an artificial keyword-density percentage.

Do NOT force the full keyword into sentences where a surname, first name, pronoun, or natural variation reads better.

Include the primary keyword naturally in:

The H1/title
The opening paragraph
At least one useful H2 where appropriate
Several places throughout the article
The conclusion if natural
The meta description

Use related entities and semantic terms only when relevant.

Examples include:

[famous relative's name]
family
parents
mother
father
siblings
career
education
early life
spouse
partner
children
profession

Do not repeat variations simply for SEO.

==================================================
STEP 6: OPEN WITH THE ANSWER
==================================================

The introduction must immediately answer:

Who is [PRIMARY KEYWORD]?

Do not start with generic sentences such as:

"Many people become famous for different reasons..."
"In the world of celebrities..."
"Fans are always curious about..."
"There are many personalities who..."

Instead, begin with a concise identity statement.

Ideal structure:

"[PRIMARY KEYWORD] is best known as [verified identity/relationship/reason for public interest]. [He/She/They] is connected to [FAMOUS PERSON] through [verified relationship]. Unlike [famous relative], [Name] has [brief useful distinction about career/public profile/private life]."

Only use statements that have actually been verified.

The first approximately 100–150 words should answer the central query rather than tease the answer.

==================================================
STEP 7: ARTICLE STRUCTURE
==================================================

Use an H1 followed by logical H2 headings.

Use H3 headings only when genuinely needed.

A typical structure may include:

H1: Who Is [PRIMARY KEYWORD]? All About [FAMOUS PERSON]'s [RELATIONSHIP]

Introduction

H2: Who Is [PRIMARY KEYWORD]?

Provide the clearest identity summary and explain why this person is searched.

H2: [PRIMARY KEYWORD] Quick Bio

Create a concise two-column fact table using approximately 10–13 useful facts.

Possible fields:

Full Name
Known For
Date of Birth
Age
Birthplace
Nationality
Profession
Father
Mother
Siblings
Relationship Status
Children
Education

ONLY include information supported by reliable sources.

For anything genuinely unavailable, use "Not publicly confirmed" rather than inventing an answer.

Do not fill half the table with meaningless "Unknown" entries. Remove fields that add no value.

H2: Early Life and Family Background

Explain verified family background naturally.

Include the famous family connection here when relevant, but do more than repeat the introduction.

H2: Parents and Family

Explain the relationship with publicly documented family members.

If the primary reason for search demand is a famous parent, give appropriate context about that parent without turning the article into a biography of the parent.

Keep [PRIMARY KEYWORD] as the main entity.

H2: Siblings

Include this section only if there is enough reliable information.

H2: Education and Upbringing

Discuss schooling, university education, interests, or upbringing only if documented.

H2: Career and Professional Life

Explain what the person actually does.

If they are not known to have a public career, say so carefully instead of inventing a profession.

Separate their career from the career of their famous relative.

H2: Personal Life and Relationships

Only state romantic relationships, marriage, children, or dating status when supported by strong evidence.

Do not turn rumors into facts.

Do not speculate based on photographs, follows, comments, or fan discussions.

H2: Relationship With [FAMOUS RELATIVE]

Use this section when the family relationship is central to the search query.

Explain what is publicly known without guessing about private emotions, family dynamics, closeness, conflicts, or personal motives.

H2: Public Appearances and Media Attention

Include notable verified appearances, interviews, events, projects, or media coverage where relevant.

H2: Social Media Presence

Mention only accounts that can reasonably be identified as belonging to the person.

Never present an unverified fan page as an official account.

H2: Net Worth and Income

ONLY create this section when there is meaningful evidence.

Never fabricate a net-worth figure.

Do not take an unsourced number from celebrity biography websites and state it as fact.

If no credible estimate exists, explain briefly that the person's finances have not been publicly documented well enough to provide a reliable figure.

If a credible estimate exists, clearly label it as an estimate, identify the source, and distinguish known business/career information from speculation.

H2: Where Is [PRIMARY KEYWORD] Now?

Use only if current information is available.

Discuss the latest verifiable career, public appearance, project, education, or other relevant activity.

Do not create fake freshness.

H2: Interesting Facts About [PRIMARY KEYWORD]

If used, write these as short flowing paragraphs rather than recycled trivia.

Include only meaningful, verified facts that have not simply been repeated throughout the article.

H2: Frequently Asked Questions

Create five concise FAQs based on genuine search intent.

Possible questions:

Who is [PRIMARY KEYWORD]?
How old is [PRIMARY KEYWORD]?
Who are [PRIMARY KEYWORD]'s parents?
What does [PRIMARY KEYWORD] do?
Is [PRIMARY KEYWORD] married?
Does [PRIMARY KEYWORD] have children?
How is [PRIMARY KEYWORD] related to [FAMOUS PERSON]?
Where is [PRIMARY KEYWORD] now?

Choose the five questions with the strongest factual answers for this specific person.

Do not create questions merely to add keywords.

H2: Final Thoughts

Summarize who the person is and why people know them.

Do not introduce new unsupported claims in the conclusion.

==================================================
STEP 8: WRITING STYLE
==================================================

Write for readers in the United States.

Use natural, clear American English.

The article must sound like it was researched and written by an experienced human entertainment writer.

Use accessible vocabulary.

Keep paragraphs easy to read, normally around 2–4 sentences.

Vary sentence structure and paragraph length naturally.

Avoid repetitive sentence openings.

Avoid robotic transitions.

Avoid filler.

Avoid exaggerated admiration.

Avoid generic statements that could describe any celebrity.

Do not write:

"has carved a niche for..."
"has made a name for..."
"is a testament to..."
"continues to inspire millions..."
"captivating journey..."
"remarkable journey..."
"multifaceted personality..."
"behind the glitz and glamour..."
"the world of entertainment..."
"fans are eager to know..."
"it is worth noting that..."
"delve into..."
"let's take a closer look..."
"without further ado..."
"only time will tell..."

unless the wording is genuinely necessary.

Do not repeatedly describe the subject as "famous," "successful," "renowned," "talented," or "well-known."

Prefer concrete facts over adjectives.

==================================================
STEP 9: ORIGINALITY REQUIREMENTS
==================================================

Write every sentence from scratch.

Do not closely paraphrase another article sentence by sentence.

Do not follow a competitor's exact heading sequence simply because it ranks.

Synthesize facts from multiple reliable sources into original prose.

Where several sources contain the same basic fact, explain it in your own natural wording.

Do not manufacture "original facts."

Originality should come from:

Better organization
Clearer explanations
Source comparison
Resolving conflicting information
Useful context
Accurate chronology
Answering missing questions
Connecting related verified facts

==================================================
STEP 10: FACTUAL SAFETY
==================================================

Clearly distinguish between:

CONFIRMED:
Supported by direct or strong evidence.

REPORTED:
Published by a credible named source but not independently confirmed.

ALLEGED:
A claim made by an identified person, legal document, or organization.

RUMORED/SPECULATED:
Discussed publicly without reliable confirmation.

UNKNOWN/NOT PUBLICLY CONFIRMED:
Reliable information could not be established.

Do not upgrade a "reported" or "rumored" claim into a fact.

For sensitive subjects—including health, criminal allegations, cheating, abuse, sexuality, addiction, finances, or family disputes—use especially strong sourcing and neutral attribution.

Do not speculate about private family relationships or motivations.

==================================================
STEP 11: WORD COUNT
==================================================

Do not add filler simply to reach an arbitrary length.

Aim for approximately 1,400–2,000 words for a normal biography/profile when enough reliable information exists.

Use fewer words for a person with little verifiable public information.

Use more only if the subject genuinely requires additional context.

Completeness and usefulness are more important than hitting an exact number.

==================================================
STEP 12: SEO REQUIREMENTS
==================================================

The article should naturally establish:

Primary entity:
[PRIMARY KEYWORD]

Main relationship entity:
[FAMOUS PERSON]

Entity relationship:
[RELATIONSHIP]

Important supporting entities:
Relevant relatives, companies, schools, films, TV shows, employers, locations, projects, or organizations.

Do not keyword-stuff.

Do not repeat the celebrity's full name unnaturally.

Use descriptive H2 headings that answer real reader questions.

Make each major section provide new information rather than restating previous sections.

Avoid creating separate sections that substantially answer the same question.

Where appropriate, suggest 3–5 natural internal-link anchor opportunities to related celebrity articles after the article.

==================================================
STEP 13: TITLE QUALITY
==================================================

Use the supplied title only if its factual premise has been verified.

A strong title pattern is:

Who Is [PERSON]? All About [FAMOUS PERSON]'s [RELATIONSHIP]

Alternative patterns when appropriate:

Who Is [PERSON]? What to Know About [FAMOUS PERSON]'s [RELATIONSHIP]

Who Is [PERSON]? Inside Their Family, Career and Life

[PERSON]: What to Know About [FAMOUS PERSON]'s [RELATIONSHIP]

Do not use clickbait such as:

"You Won't Believe..."
"Shocking Truth..."
"Untold Truth..."
"Fans Are Stunned..."
"Everything They Don't Want You to Know..."

Do not automatically add the current year unless freshness is genuinely important to the search intent.

==================================================
STEP 14: META DESCRIPTION
==================================================

After the article, provide one unique meta description.

Aim for approximately 130–155 characters when practical.

Include the primary keyword naturally.

Explain the actual value of the page.

Use active, readable language.

Do not stuff keywords.

Do not make claims that the article does not support.

==================================================
STEP 15: FINAL FACT-CHECK BEFORE OUTPUT
==================================================

Before producing the final article, silently audit every major claim.

Check:

Is the person's identity correct?
Is their famous-family relationship correct?
Are names spelled correctly?
Are dates consistent?
Are ages calculated correctly from verified dates?
Are parents and siblings correctly identified?
Is relationship status current and sourced?
Did I accidentally convert a rumor into fact?
Did I invent education or career details?
Did I invent height?
Did I invent net worth?
Did I mistake another person for the subject?
Did I use an unreliable biography website as the sole source?
Does the introduction immediately answer "Who is this person?"
Does each H2 add useful new information?
Does the article provide information beyond generic competitor rewrites?
Is the headline accurate?
Is the article genuinely useful even if the reader never visits another page?

Correct any problem before presenting the article.

==================================================
OUTPUT FORMAT
==================================================

Return the finished content in this order:

1. H1 / Article Title

2. Introduction

3. Main article with H2/H3 headings

4. Quick Bio table with approximately 10–13 relevant verified fields

5. Five FAQs

6. Final Thoughts

7. Meta Description

8. Suggested URL Slug

9. 8–12 relevant tags separated by commas

10. Suggested internal-link anchor opportunities

11. Research Notes

Under "Research Notes," briefly list:
- Important facts that could not be verified
- Conflicting information found during research
- Any correction made to the supplied title/premise
- Facts that should be checked again before publication

Do NOT display a fake bibliography or invent citations.`;

const shared = (key: string) => {
  const prompt = CELEBRITY_PROMPTS.find((p) => p.key === key);
  if (!prompt) throw new Error(`Celebrity Writer prompt "${key}" is missing`);
  return prompt;
};

export const CELEBRITY2_PROMPTS: PromptDefinition[] = [
  {
    key: CELEBRITY2_PROMPT_KEYS.article,
    name: 'Article Prompt (research + writing)',
    description:
      'Step 1 — researches and verifies the person and writes the whole article in one answer: title, Quick Bio table, FAQs, Final Thoughts, meta description, slug, tags and research notes. Only {{keyword}} is filled in.',
    defaultContent: ARTICLE,
  },
  shared(CELEBRITY2_PROMPT_KEYS.externalLinks),
  shared(CELEBRITY2_PROMPT_KEYS.images),
  shared(CELEBRITY2_PROMPT_KEYS.imageReview),
  shared(CELEBRITY2_PROMPT_KEYS.seoCorrection),
];

export const CELEBRITY2_VARIABLES: PromptVariableDoc[] = [
  { name: 'keyword', description: 'Primary keyword (the person) — the only input of the Article Prompt', sample: 'John Paul Sarkisian' },
  { name: 'final_article', description: 'The article as Markdown (External Links / SEO Correction)', sample: '[article]' },
  { name: 'max_words', description: 'Most words the article may have (SEO Correction)', sample: '2,000' },
  { name: 'link_count', description: 'How many link suggestions to ask for (External Links only)', sample: '5 to 7' },
  { name: 'wikipedia_site', description: 'Wikipedia in the article language (External Links only)', sample: 'en.wikipedia.org' },
  { name: 'photo_count', description: 'How many photos are attached (Photo Check only)', sample: '6' },
  { name: 'rankmath_issues', description: 'Failed Rank Math checks (SEO Correction only)', sample: '- Use Focus Keyword at the beginning of your content.' },
  { name: 'seo_title', description: 'Current SEO title', sample: 'Who Is John Paul Sarkisian? All About Cher’s Father' },
  { name: 'meta_description', description: 'Current meta description', sample: 'John Paul Sarkisian…' },
];
