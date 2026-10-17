// Our own humanizer (27 September 2026, from the user's research doc): the local check, fact locks, the prompt and the
// whole run with a fake ChatGPT.
import { describe, expect, it } from 'vitest';
import { analyseDocument, paragraphSignals, type ArticleReport } from '@/content/humanizer/analyse';
import { buildDocument, fromPromptMarks, parseDocument, plainText, toPromptMarks } from '@/content/humanizer/blocks';
import { humanize } from '@/content/humanizer/humanize';
import { checkRewrite, namesIn } from '@/content/humanizer/protect';
import { articleNotes, DEFAULT_HUMANIZER_PROMPT, parseRewrites, renderHumanizerPrompt } from '@/content/humanizer/prompt';

// The research doc's own "synthetic AI-like draft" and its edited version.
const AI_DRAFT =
  "In today's rapidly evolving digital landscape, businesses must leverage robust artificial-intelligence solutions to navigate increasingly complex challenges. Furthermore, it is important to note that a meticulous approach to implementation can significantly enhance organisational efficiency. By fostering collaboration and embracing a nuanced strategy, organisations can unlock the full potential of this transformative technology.";
const HUMAN_EDIT =
  'Most teams do not need a bigger AI model first. They need cleaner source material, an editing brief and a way to catch factual changes before publication. For a typical article workflow, lock the names, dates, figures and citations before rewriting the prose. Then edit for tone. That order prevents a smoother sentence from becoming a less accurate one.';

describe('the check', () => {
  it('flags the doc’s AI-like draft and leaves its human edit alone', () => {
    const ai = paragraphSignals(AI_DRAFT);
    const human = paragraphSignals(HUMAN_EDIT);
    expect(ai.score).toBeGreaterThanOrEqual(6);
    expect(ai.reasons.join(' ')).toMatch(/Furthermore/);
    expect(ai.reasons.join(' ')).toMatch(/it is important to note/);
    expect(ai.reasons.join(' ')).toMatch(/meticulous/);
    expect(human.score).toBe(0);
  });

  it('does not count foster care or Jodie Foster, and counts a sentence-opening "Additionally" once', () => {
    expect(paragraphSignals('She grew up in foster care. Jodie Foster later hired her.').score).toBe(0);
    const once = paragraphSignals('Additionally, he opened a bakery in 2004.');
    expect(once.hits.map((h) => h.label)).toEqual(['opens with "additionally"']);
  });

  it('measures the whole article: rhythm, variety, repeated openings and phrases', () => {
    const text = [
      'He was born in 1970. He grew up in Ohio. He moved to Texas. He married in 1995.',
      'His career began early. His first film came out in 1990 and did well at the box office. His second one did not.',
      'The family business made money. The family business grew fast. The family business closed in 2001.',
    ].join('\n\n');
    const report = analyseDocument(parseDocument(text));
    expect(report.paragraphs).toBe(3);
    expect(report.sentences).toBe(10);
    expect(report.repeatedOpenings).toEqual([
      { word: 'he', count: 4 },
      { word: 'his', count: 3 },
    ]);
    expect(report.repeatedPhrases[0]).toEqual({ phrase: 'the family business', count: 3 });
    expect(report.paragraphReports[0].reasons).toContain('every sentence is about the same length');
    expect(report.wordVariety).toBeGreaterThan(0.5);
  });
});

describe('the article blocks', () => {
  const html =
    '<h2>Early Life</h2><p>Gary was born in <strong>1968</strong> and studied at <a href="https://en.wikipedia.org/wiki/UCLA" target="_blank" rel="noopener">UCLA</a> &amp; later moved.</p><ul><li>Not prose</li></ul><figure><img src="a.webp"></figure>';

  it('only paragraphs are prose; links and bold become light markdown', () => {
    const doc = parseDocument(html);
    expect(doc.format).toBe('html');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'other', 'other']);
    expect(doc.blocks[1].text).toBe('Gary was born in **1968** and studied at [UCLA](https://en.wikipedia.org/wiki/UCLA) & later moved.');
    expect(plainText(doc.blocks[1].text)).toBe('Gary was born in 1968 and studied at UCLA & later moved.');
  });

  it('rebuilds the same article, and a rewritten paragraph keeps the link’s own attributes', () => {
    const doc = parseDocument(html);
    expect(buildDocument(doc, new Map())).toBe(html);
    const rebuilt = buildDocument(doc, new Map([[1, 'Born in **1968**, Gary went to [UCLA](https://en.wikipedia.org/wiki/UCLA) & then moved.']]));
    expect(rebuilt).toBe(
      '<h2>Early Life</h2><p>Born in <strong>1968</strong>, Gary went to <a href="https://en.wikipedia.org/wiki/UCLA" target="_blank" rel="noopener">UCLA</a> &amp; then moved.</p><ul><li>Not prose</li></ul><figure><img src="a.webp"></figure>',
    );
  });

  it('reads plain text and markdown too', () => {
    const doc = parseDocument('# Title\n\nFirst paragraph\nstill first.\n\n- a list\n- item\n\nSecond paragraph.');
    expect(doc.format).toBe('text');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'other', 'paragraph']);
    expect(doc.blocks[1].text).toBe('First paragraph still first.');
  });
});

describe('the fact locks', () => {
  const original = 'Gary Phillip Spector was born in 1968 in Los Angeles. His net worth is about $1,500,000, per [Forbes](https://forbes.com/x).';

  it('finds multi-word names without the sentence’s opening word', () => {
    expect(namesIn('After Gary Phillip Spector moved to New York. The show ended.')).toEqual(['Gary Phillip Spector', 'New York']);
  });

  it('accepts a rewrite that kept every fact', () => {
    const check = checkRewrite(original, 'Born in 1968 in Los Angeles, Gary Phillip Spector is worth about $1500000, per [Forbes](https://forbes.com/x).', 'Gary Phillip Spector');
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.warnings).toEqual(['20 → 15 words']);
  });

  it('refuses a rewrite that changed a number, a link, a name or the keyword', () => {
    const check = checkRewrite(original, 'Spector was born in 1969 in LA. He is worth about $1.5 million, per [Forbes magazine](https://forbes.com/x).', 'Gary Phillip Spector');
    expect(check.ok).toBe(false);
    const all = check.problems.join(' | ');
    expect(all).toMatch(/link/);
    expect(all).toMatch(/lost or changed numbers: 1968, 1500000/);
    expect(all).toMatch(/dropped names: Gary Phillip Spector, Los Angeles/);
    expect(all).toMatch(/keyword 0 time\(s\) instead of 1/);
  });

  it('does not take a sentence-opening word for part of a name (Tommy Gooding, 27 September 2026)', () => {
    expect(namesIn('Unlike Cuba Jr. and Omar, Tommy chose music. Because Cuba Sr. toured often, he learned early.')).toEqual(['Cuba Jr', 'Cuba Sr']);
    const original = 'Unlike Cuba Jr., Tommy Gooding built his career in music rather than acting.';
    expect(checkRewrite(original, 'Tommy Gooding built his career in music, not acting like Cuba Jr.', 'Tommy Gooding').problems).toEqual([]);
  });

  it('in German, only a lost name holding a keyword word stops the rewrite (30 September 2026)', () => {
    const original = 'Seriöse Quellen berichten, dass Dennis’ Mutter Fatou Schröder aus Gambia stammt und in Braunschweig lebte.';
    // "Seriöse Quellen" and "Dennis’ Mutter" reworded: only a warning.
    const reworded = checkRewrite(original, 'Laut verlässlichen Berichten stammt seine Mutter Fatou Schröder aus Gambia und lebte in Braunschweig.', 'dennis schröder vater');
    expect(reworded.problems).toEqual([]);
    expect(reworded.warnings.join(' ')).toMatch(/reworded/);
    // Her name is lost: that still stops it.
    const lost = checkRewrite(original, 'Laut verlässlichen Berichten stammt seine Mutter aus Gambia und lebte in Braunschweig, wie man hört.', 'dennis schröder vater');
    expect(lost.problems.join(' ')).toMatch(/dropped names: .*Fatou Schröder/);
  });

  it('lets a German name move, as long as all its words stay', () => {
    const german = 'Die Schauspielerin Anna Loos lebt seit 2004 mit Jan Josef Liefers in Berlin.';
    expect(checkRewrite(german, 'Seit 2004 lebt Anna Loos, die Schauspielerin, mit Jan Josef Liefers in Berlin.').problems).toEqual([]);
    expect(checkRewrite(german, 'Seit 2004 lebt Anna Loos, die Schauspielerin, mit ihrem Mann in Berlin.', 'jan josef liefers anna loos').problems).toEqual([
      'dropped names: Jan Josef Liefers',
    ]);
  });

  it('refuses a rewrite that is far shorter or longer', () => {
    const long = 'word '.repeat(40).trim() + '.';
    expect(checkRewrite(long, 'Too short now.').problems[0]).toMatch(/cut the paragraph from 40 to 3 words/);
  });
});

describe('the marks ChatGPT gets instead of markdown', () => {
  const links = ['https://en.wikipedia.org/wiki/Jenna_Ortega', 'https://en.wikipedia.org/wiki/Wednesday_(TV_series)'];

  it('turns links and emphasis into marks, and back — also a Wikipedia address with brackets', () => {
    const markdown = '[Jenna Ortega](https://en.wikipedia.org/wiki/Jenna_Ortega) plays in **Netflix’s** *Wednesday* ([Wednesday](https://en.wikipedia.org/wiki/Wednesday_(TV_series))).';
    const marked = toPromptMarks(markdown);
    expect(marked).toEqual({ text: '{L1}Jenna Ortega{/L1} plays in {b}Netflix’s{/b} {i}Wednesday{/i} ({L2}Wednesday{/L2}).', links });
    expect(fromPromptMarks(marked.text, marked.links)).toBe(markdown);
  });

  it('keeps a bracketed Wikipedia link whole in the rebuilt HTML', () => {
    const html = '<p>She plays in <a href="https://en.wikipedia.org/wiki/Wednesday_(TV_series)" target="_blank">Wednesday</a> since 2022.</p>';
    const doc = parseDocument(html);
    expect(doc.blocks[0].text).toBe('She plays in [Wednesday](https://en.wikipedia.org/wiki/Wednesday_(TV_series)) since 2022.');
    expect(buildDocument(doc, new Map([[0, 'Since 2022 she plays in [Wednesday](https://en.wikipedia.org/wiki/Wednesday_(TV_series)).']]))).toBe(
      '<p>Since 2022 she plays in <a href="https://en.wikipedia.org/wiki/Wednesday_(TV_series)" target="_blank">Wednesday</a>.</p>',
    );
  });

  it('reads a writing-block (canvas) answer: backslash escapes go, an unknown mark stays for the check to refuse', () => {
    // As the live canvas answer of 27 September 2026 escaped them.
    expect(fromPromptMarks('Netflix’s \\*Wednesday\\* and \\{L2\\}the show\\{/L2\\}, 1\\. place', links)).toBe(
      'Netflix’s *Wednesday* and [the show](https://en.wikipedia.org/wiki/Wednesday_(TV_series)), 1. place',
    );
    expect(fromPromptMarks('{L7}made up{/L7}', links)).toBe('{L7}made up{/L7}');
  });
});

describe('the prompt', () => {
  it('puts each paragraph with what to fix, and drops the keyword line without a keyword', () => {
    const prompt = renderHumanizerPrompt(DEFAULT_HUMANIZER_PROMPT, '', [{ number: 3, text: 'Some text.', reasons: ['filler: "It is worth noting"'] }]);
    expect(prompt).toContain('P3: filler: "It is worth noting"');
    expect(prompt).toContain('[P3]\nSome text.');
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toMatch(/Keep "" exactly/);
    expect(renderHumanizerPrompt(DEFAULT_HUMANIZER_PROMPT, 'Gary Spector', [])).toContain('Keep "Gary Spector" exactly as often');
  });

  it('tells ChatGPT the whole article’s habits: repeated sentence openings and even sentence lengths', () => {
    // The numbers of the live Jenna Ortega test.
    const report = {
      sentences: 88,
      sentenceLength: { mean: 17, sd: 5.7, variation: 0.33 },
      repeatedOpenings: [
        { word: 'natalie', count: 18 },
        { word: 'jenna', count: 15 },
        { word: 'her', count: 4 },
      ],
    } as ArticleReport;
    const notes = articleNotes(report);
    expect(notes).toEqual([
      '18 sentences start with "Natalie", 15 sentences start with "Jenna": vary how sentences begin (a pronoun, a time, a place or a clause first)',
      'most sentences are 11–23 words long: mix in some short sentences (under 8 words) and a few longer ones',
    ]);
    const prompt = renderHumanizerPrompt(DEFAULT_HUMANIZER_PROMPT, '', [{ number: 1, text: 'Text.', reasons: [] }], notes);
    expect(prompt).toContain('What to fix:\nAll paragraphs: 18 sentences start with "Natalie"');
    expect(prompt).toContain('\nP1: make it read more naturally');
    expect(articleNotes({ ...report, sentenceLength: { mean: 17, sd: 8, variation: 0.47 }, repeatedOpenings: [] })).toEqual([]);
  });

  it('reads the answer even with bold labels, a code fence and a split paragraph', () => {
    const answer = '```\n**[P2]**\nFirst half.\n\nSecond half.\n[P5]: Another one.\n```';
    expect([...parseRewrites(answer)]).toEqual([
      [2, 'First half. Second half.'],
      [5, 'Another one.'],
    ]);
  });
});

describe('a whole run', () => {
  it('sends only flagged paragraphs, keeps an original whose facts changed, and rebuilds the HTML', async () => {
    const input = [
      '<h2>Career</h2>',
      `<p>${AI_DRAFT}</p>`,
      '<p>Gary opened his first shop in 1994 with his brother.</p>',
      '<p>Additionally, it is worth noting that Gary played a pivotal role at <a href="https://example.com/co" rel="nofollow">the company</a> in 2001. Furthermore, his meticulous work was a testament to his skill.</p>',
    ].join('');
    const prompts: string[] = [];
    const result = await humanize({
      input,
      keyword: 'Gary',
      ask: async (prompt) => {
        prompts.push(prompt);
        return [
          '[P1]',
          'Most businesses need solid AI tools for hard problems, and a careful rollout makes an organisation run better. Working together with a clear plan, organisations get far more out of the technology.',
          '[P3]',
          'Gary had a big part at {L1}the company{/L1} in 2002, and his careful work showed his skill.',
        ].join('\n');
      },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('[P1]');
    expect(prompts[0]).toContain('[P3]');
    expect(prompts[0]).not.toContain('[P2]');
    // Links go as marks: the address never reaches ChatGPT.
    expect(prompts[0]).toContain('{L1}the company{/L1}');
    expect(prompts[0]).not.toContain('example.com');
    expect(result.sent).toBe(2);
    expect(result.rewritten).toBe(1);
    expect(result.keptOriginal).toBe(1);

    const p3 = result.paragraphs.find((p) => p.number === 3)!;
    expect(p3.outcome).toBe('kept-original');
    expect(p3.problems.join(' ')).toMatch(/2001/);

    expect(result.output).toContain('<p>Most businesses need solid AI tools');
    expect(result.output).toContain('<p>Gary opened his first shop in 1994 with his brother.</p>');
    expect(result.output).toContain('<a href="https://example.com/co" rel="nofollow">the company</a> in 2001');
    expect(result.after.signals).toBeLessThan(result.before.signals);
  });

  it('keeps the parts ChatGPT answered when a later part fails, and stops on a fatal error', async () => {
    const input = [AI_DRAFT, `Additionally, it is worth noting that his pivotal role was a testament to his meticulous work in 1999.`].join('\n\n');
    const answers = ['[P1]\nMost businesses need solid AI tools for hard problems, and a careful rollout makes an organisation run better. Working together with a clear plan, organisations get far more out of the technology.'];
    const failing = async (_prompt: string, part: number) => {
      if (part === 2) throw new Error('The prompt did not appear in the ChatGPT conversation');
      return answers[0];
    };
    const result = await humanize({ input, ask: failing, maxWordsPerPrompt: 60 });
    expect(result.prompts).toBe(2);
    expect(result.rewritten).toBe(1);
    expect(result.failedPrompts).toEqual(['Part 2: The prompt did not appear in the ChatGPT conversation']);
    expect(result.paragraphs[1]).toMatchObject({ outcome: 'missing', problems: ['ChatGPT failed on this part: The prompt did not appear in the ChatGPT conversation'] });
    expect(result.output).toContain('Most businesses need solid AI tools');

    await expect(humanize({ input, ask: failing, maxWordsPerPrompt: 60, stopOn: () => true })).rejects.toThrow(/did not appear/);
    await expect(humanize({ input, ask: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  });

  it('asks nothing when no paragraph is flagged', async () => {
    const result = await humanize({ input: HUMAN_EDIT, ask: async () => { throw new Error('should not ask'); } });
    expect(result.prompts).toBe(0);
    expect(result.output).toBe(HUMAN_EDIT);
  });
});
