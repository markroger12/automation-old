// Signals of AI-style writing, from the user's research doc "AI Writing Fingerprints, Humanising AI Articles, and
// Deploying an AI Humaniser" (27 September 2026). None of them proves anything alone: the doc is clear that density and
// regularity matter, not presence, so every hit only adds weight to a paragraph.

export type SignalKind = 'word' | 'filler' | 'cliche';

export interface Signal {
  label: string;
  kind: SignalKind;
  pattern: RegExp;
  weight: number;
}

const word = (label: string, pattern: RegExp, weight = 1): Signal => ({ label, kind: 'word', pattern, weight });
const filler = (label: string, pattern: RegExp, weight = 2): Signal => ({ label, kind: 'filler', pattern, weight });
const cliche = (label: string, pattern: RegExp, weight = 1): Signal => ({ label, kind: 'cliche', pattern, weight });

/**
 * Words. The first group has corpus evidence in the doc (Kousha–Thelwall's set and the LREC 2026 adverbs); the rest are
 * the doc's "editorial review triggers" plus words ChatGPT leans on in celebrity bios. Very common adverbs weigh half.
 */
export const WORD_SIGNALS: Signal[] = [
  word('delve', /\bdelv(?:e|es|ed|ing)\b/gi),
  word('underscore', /\bunderscor(?:e|es|ed|ing)\b/gi),
  word('intricate', /\bintrica(?:te|tely|cy|cies)\b/gi),
  word('meticulous', /\bmeticulous(?:ly)?\b/gi),
  word('pivotal', /\bpivotal\b/gi),
  word('showcase', /\bshowcas(?:e|es|ed|ing)\b/gi),
  word('unveil', /\bunveil(?:s|ed|ing)?\b/gi),
  word('heighten', /\bheighten(?:s|ed|ing)?\b/gi),
  word('nuanced', /\bnuanc(?:e|es|ed)\b/gi),
  word('bolster', /\bbolster(?:s|ed|ing)?\b/gi),
  // Lowercase only, and not "foster care/parents": Jodie Foster and foster families are real facts in bios.
  word('foster', /\bfoster(?:s|ed|ing)?\b(?!\s+(?:care|child|children|kids?|parents?|homes?|famil(?:y|ies)|mother|father|son|daughter|brother|sister))/g),
  word('interplay', /\binterplay\b/gi),
  word('additionally', /\badditionally\b/gi),
  word('notably', /\bnotably\b/gi),
  word('furthermore', /\bfurthermore\b/gi),
  word('subsequently', /\bsubsequently\b/gi),
  word('primarily', /\bprimarily\b/gi, 0.5),
  word('solely', /\bsolely\b/gi, 0.5),
  word('effectively', /\beffectively\b/gi, 0.5),
  word('particularly', /\bparticularly\b/gi, 0.5),
  word('moreover', /\bmoreover\b/gi),
  word('testament', /\btestament\b/gi),
  word('tapestry', /\btapestr(?:y|ies)\b/gi),
  word('realm', /\brealms?\b/gi),
  word('vibrant', /\bvibrant\b/gi),
  word('embark', /\bembark(?:s|ed|ing)?\b/gi),
  word('captivating', /\bcaptivat(?:e|es|ed|ing)\b/gi),
  word('remarkable', /\bremarkabl[ey]\b/gi),
  word('renowned', /\brenowned\b/gi),
  word('boasts', /\bboast(?:s|ed|ing)\b/gi),
  word('seamless', /\bseamless(?:ly)?\b/gi),
  word('navigate', /\bnavigat(?:e|es|ed|ing)\b/gi),
  word('leverage', /\bleverag(?:e|es|ed|ing)\b/gi),
  word('robust', /\brobust\b/gi),
  word('crucial', /\bcrucial(?:ly)?\b/gi),
  word('resonate', /\bresonat(?:e|es|ed|ing)\b/gi),
  word('profound', /\bprofound(?:ly)?\b/gi),
  word('indelible', /\bindelible\b/gi),
  word('multifaceted', /\bmulti-?faceted\b/gi),
  word('transformative', /\btransformative\b/gi),
  word('paramount', /\bparamount\b(?!\s+pictures)/g),
  word('invaluable', /\binvaluable\b/gi),
  word('noteworthy', /\bnoteworthy\b/gi),
  word('garner', /\bgarner(?:s|ed|ing)?\b/gi),
  word('spearhead', /\bspearhead(?:s|ed|ing)?\b/gi),
  word('unwavering', /\bunwavering\b/gi),
  word('undeniable', /\bundeniabl[ey]\b/gi),
  word('illustrious', /\billustrious\b/gi),
  word('trailblazing', /\btrailblaz(?:er|ers|ing)\b/gi),
  word('meteoric', /\bmeteoric\b/gi),
  word('ever-evolving', /\bever-(?:evolving|changing|growing)\b/gi),
  word('enduring', /\benduring\b/gi, 0.5),
  word('comprehensive', /\bcomprehensive\b/gi, 0.5),
  word('landscape', /\blandscapes?\b/gi, 0.5),
  word('journey', /\bjourneys?\b/gi, 0.5),
  word('dynamic', /\bdynamic\b/gi, 0.5),
];

/** Sentences that only announce that something matters (the doc's "over-signposting"), and stock phrases. */
export const PHRASE_SIGNALS: Signal[] = [
  filler('it is important to note', /\bit(?: is|['’]s) (?:important|crucial|essential) to (?:note|remember|understand)\b/gi),
  filler('it is worth noting', /\bit(?: is|['’]s) worth (?:noting|mentioning|pointing out)\b/gi),
  filler('it is evident / clear that', /\bit(?: is|['’]s) (?:evident|clear|undeniable) that\b/gi),
  filler("it's no secret", /\bit(?: is|['’]s) no secret\b/gi),
  filler('needless to say', /\b(?:needless to say|it goes without saying)\b/gi),
  filler('this highlights / underscores', /\bth(?:is|at|ese) (?:highlights|underscores|demonstrates|showcases|emphasi[sz]es)\b/gi),
  filler('plays a key role', /\bplay(?:s|ed|ing)? an? (?:crucial|pivotal|vital|key|significant|important|major) role\b/gi),
  filler('valuable insights', /\bprovid(?:e|es|ed|ing) (?:valuable|unique|deep) insights?\b/gi),
  filler('serves as a reminder', /\bserv(?:e|es|ed|ing) as an? (?:reminder|testament|reflection|symbol)\b/gi),
  cliche("in today's world", /\bin today['’]s (?:fast-paced |digital |modern |ever-changing )?(?:world|age|society|landscape|era)\b/gi),
  cliche('in the world of', /\bin the (?:world|realm) of\b/gi),
  cliche('when it comes to', /\bwhen it comes to\b/gi),
  cliche("whether you're", /\bwhether you['’]re\b/gi),
  cliche('at the end of the day', /\bat the end of the day\b/gi),
  cliche('in conclusion', /\b(?:in conclusion|in summary|to sum up|all in all)\b/gi),
  cliche('left a lasting mark', /\bleft an? (?:indelible|lasting|permanent) (?:mark|impression|legacy)\b/gi),
  cliche('rose to fame', /\brose to (?:fame|prominence|stardom)\b/gi),
  cliche('stands as', /\bstands? as an?\b/gi),
  cliche('continues to inspire', /\bcontinu(?:e|es|ed) to (?:inspire|captivate|resonate)\b/gi),
  cliche('a force to be reckoned with', /\ba force to be reckoned with\b/gi),
  cliche('not only … but also', /\bnot only\b[^.!?]{1,80}?\bbut also\b/gi),
  cliche('not just … but', /\bnot (?:just|merely|simply)\b[^.!?]{1,80}?\bbut\b/gi),
  cliche('more than just', /\bmore than just\b/gi),
  cliche('a wide range of', /\ba (?:wide|diverse|broad|rich) (?:range|array|variety|tapestry) of\b/gi),
  cliche('shed light on', /\bshed(?:s|ding)? light on\b/gi),
  cliche('paved the way', /\bpav(?:e|es|ed|ing) the way\b/gi),
  cliche('dive into', /\b(?:dive|dives|diving) (?:into|deeper)\b|\blet['’]s (?:dive|explore|take a (?:closer )?look)\b/gi),
  cliche('without further ado', /\b(?:without further ado|look no further|buckle up)\b/gi),
];

/**
 * Words that open a sentence only to link it to the last one. Paragraph after paragraph of them is what the doc
 * describes as machine-like; one "However" is not.
 */
export const OPENER_WORDS = [
  'additionally',
  'furthermore',
  'moreover',
  'notably',
  'consequently',
  'subsequently',
  'ultimately',
  'overall',
  'in addition',
  'importantly',
  'interestingly',
  'indeed',
  'thus',
  'hence',
  'in essence',
  'essentially',
  'undoubtedly',
  'remarkably',
];

/** Function words ignored when looking for repeated phrases. */
export const STOP_WORDS = new Set(
  (
    'a an the and or but if of to in on at by for with from as into about over after before than then that this these those ' +
    'is are was were be been being has have had do does did it its it’s it\'s he she they them his her their we our you your i my me ' +
    'who whom which what when where while also not no so such can could would should will may might one two'
  ).split(' '),
);
