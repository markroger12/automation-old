import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TIMEZONE,
  formatTime,
  formatTime12,
  fromWallClock,
  isTimeZone,
  localStamp,
  localStamp12,
  nextPublishSlots,
  parseTimes,
  wallClockIn,
} from '@/lib/workflow/time';
import { celebrityCategory, detectKeywordKind, kindFromWording, moduleForKind } from '@/lib/workflow/keyword-kind';
import { canonicalAddress, startsNow } from '@/worker/workflow-scheduler';
import { parseKeywordLines } from '@/lib/services/workflow';

describe('the workflow clock', () => {
  it('reads the publish times and puts them in order', () => {
    expect(parseTimes(['05:00', '04:00', '04:30', 'nonsense', '25:00', '04:00']).map(formatTime)).toEqual(['04:00', '04:30', '05:00']);
  });

  it('understands a time written the way a clock at home shows it', () => {
    expect(parseTimes(['4:00 PM', '4:30 pm', '9 AM', '12:00 AM', '12:00 PM']).map(formatTime)).toEqual(['00:00', '09:00', '12:00', '16:00', '16:30']);
    // The same moment written both ways counts once.
    expect(parseTimes(['16:00', '4:00 PM'])).toHaveLength(1);
    // A twelve-hour time can only go up to twelve.
    expect(parseTimes(['13:00 PM'])).toHaveLength(0);
  });

  it('shows a time back the same way', () => {
    // Midnight and midday are both written as 12.
    expect(parseTimes(['16:30', '00:15', '12:00', '09:05']).map(formatTime12)).toEqual(['12:15 AM', '9:05 AM', '12:00 PM', '4:30 PM']);
    const moment = fromWallClock({ year: 2026, month: 9, day: 24, hour: 16, minute: 30 }, WORKFLOW_TIMEZONE);
    expect(localStamp12(moment, WORKFLOW_TIMEZONE)).toBe('24 Sep, 4:30 PM');
  });

  it('turns a Pakistan time into the real moment', () => {
    // Pakistan stays five hours ahead of UTC all year.
    const moment = fromWallClock({ year: 2026, month: 9, day: 24, hour: 4, minute: 30 }, WORKFLOW_TIMEZONE);
    expect(moment.toISOString()).toBe('2026-09-23T23:30:00.000Z');
  });

  it('shows that same moment on the clock of the website', () => {
    const moment = fromWallClock({ year: 2026, month: 9, day: 24, hour: 4, minute: 30 }, WORKFLOW_TIMEZONE);
    // Berlin is on summer time in September: one hour behind Pakistan's five, so late the evening before.
    expect(localStamp(moment, 'Europe/Berlin')).toBe('2026-09-24 01:30');
    expect(localStamp(moment, 'America/New_York')).toBe('2026-09-23 19:30');
    expect(localStamp(moment, WORKFLOW_TIMEZONE)).toBe('2026-09-24 04:30');
  });

  it('survives the night a country puts its clocks forward', () => {
    // Germany moves to summer time on 29 March 2026 at 02:00 local.
    const before = fromWallClock({ year: 2026, month: 3, day: 29, hour: 1, minute: 0 }, 'Europe/Berlin');
    const after = fromWallClock({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 }, 'Europe/Berlin');
    expect(after.getTime() - before.getTime()).toBe(60 * 60 * 1000);
    expect(wallClockIn(before, 'Europe/Berlin').hour).toBe(1);
    expect(wallClockIn(after, 'Europe/Berlin').hour).toBe(3);
  });

  it('knows a real time zone from a made-up one', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone(null)).toBe(false);
  });

  it('lists the next five publish moments, one per time', () => {
    const from = fromWallClock({ year: 2026, month: 9, day: 23, hour: 12, minute: 0 }, WORKFLOW_TIMEZONE);
    const slots = nextPublishSlots({ times: ['04:00', '04:30', '05:00', '05:30', '06:00'], from, count: 5 });
    expect(slots.map((slot) => localStamp(slot, WORKFLOW_TIMEZONE))).toEqual([
      '2026-09-24 04:00',
      '2026-09-24 04:30',
      '2026-09-24 05:00',
      '2026-09-24 05:30',
      '2026-09-24 06:00',
    ]);
  });

  it('carries on into the next day when today is used up', () => {
    const from = fromWallClock({ year: 2026, month: 9, day: 23, hour: 4, minute: 45 }, WORKFLOW_TIMEZONE);
    const slots = nextPublishSlots({ times: ['04:00', '05:00'], from, count: 3 });
    expect(slots.map((slot) => localStamp(slot, WORKFLOW_TIMEZONE))).toEqual(['2026-09-23 05:00', '2026-09-24 04:00', '2026-09-24 05:00']);
  });

  it('keeps to the days it is allowed to run', () => {
    const from = fromWallClock({ year: 2026, month: 9, day: 25, hour: 12, minute: 0 }, WORKFLOW_TIMEZONE); // a Friday
    const slots = nextPublishSlots({ times: ['04:00'], days: [1], from, count: 2 }); // Mondays only
    expect(slots.map((slot) => localStamp(slot, WORKFLOW_TIMEZONE))).toEqual(['2026-09-28 04:00', '2026-10-05 04:00']);
  });

  it('gives nothing when no time is set', () => {
    expect(nextPublishSlots({ times: [], count: 5 })).toEqual([]);
  });
});

describe('when an article starts being written', () => {
  const now = fromWallClock({ year: 2026, month: 9, day: 23, hour: 12, minute: 0 }, WORKFLOW_TIMEZONE);
  const tomorrowMorning = fromWallClock({ year: 2026, month: 9, day: 24, hour: 4, minute: 0 }, WORKFLOW_TIMEZONE);

  it('waits until the set number of hours before it goes live', () => {
    // Sixteen hours away: a twelve-hour lead is not reached yet, a twenty-hour one is.
    expect(startsNow(tomorrowMorning, 12, now)).toBe(false);
    expect(startsNow(tomorrowMorning, 20, now)).toBe(true);
  });

  it('starts straight away when the workflow is set to no waiting', () => {
    expect(startsNow(tomorrowMorning, 0, now)).toBe(true);
    // Even for a time that is days away.
    const nextWeek = fromWallClock({ year: 2026, month: 9, day: 30, hour: 4, minute: 0 }, WORKFLOW_TIMEZONE);
    expect(startsNow(nextWeek, 0, now)).toBe(true);
    expect(startsNow(nextWeek, 12, now)).toBe(false);
  });
});

describe('the address Google is given', () => {
  const page = 'https://laraixmagazine.co.uk/latest-tech-info-beaconsoft/';

  it('takes the address the article names as its own', () => {
    const html = `<head><link rel='stylesheet' href='/style.css' /><link rel="canonical" href="${page}" /></head>`;
    expect(canonicalAddress(html, 'https://laraixmagazine.co.uk/?p=2291')).toBe(page);
    // Attributes in any order.
    expect(canonicalAddress(`<link href="${page}" rel="canonical">`, page)).toBe(page);
  });

  it('ignores a page without one, or one that points to another site', () => {
    expect(canonicalAddress('<link rel="stylesheet" href="/a.css">', page)).toBeNull();
    expect(canonicalAddress('<link rel="canonical" href="https://other.example/post/">', page)).toBeNull();
  });
});

describe('the keyword box', () => {
  it('reads a keyword, its secondary keywords and its title', () => {
    const lines = parseKeywordLines(
      [
        'dillon brooks wife',
        'best antivirus for windows 11 | free antivirus, antivirus 2026 | The Best Antivirus for Windows 11',
        'Sydney Sweeney | | Sydney Sweeney: Age, Career and Net Worth',
        'x',
        '',
        'DILLON BROOKS WIFE',
      ].join('\n'),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ keyword: 'dillon brooks wife', secondaryKeywords: [], title: null });
    expect(lines[1]).toMatchObject({
      keyword: 'best antivirus for windows 11',
      secondaryKeywords: ['free antivirus', 'antivirus 2026'],
      title: 'The Best Antivirus for Windows 11',
    });
    // A title without secondary keywords keeps its place.
    expect(lines[2]).toMatchObject({ keyword: 'Sydney Sweeney', secondaryKeywords: [], title: 'Sydney Sweeney: Age, Career and Net Worth' });
  });

  it('reads columns pasted from a sheet', () => {
    const [line] = parseKeywordLines('jackie rozo\tjackie rozo age\tWho Is Jackie Rozo?');
    expect(line).toMatchObject({ keyword: 'jackie rozo', secondaryKeywords: ['jackie rozo age'], title: 'Who Is Jackie Rozo?' });
  });
});

describe('telling a celebrity keyword from a Tigram one', () => {
  it('reads the wording of the keyword', () => {
    expect(kindFromWording('dillon brooks wife')).toMatchObject({ kind: 'CELEBRITY' });
    expect(kindFromWording('Sydney Sweeney net worth')).toMatchObject({ kind: 'CELEBRITY' });
    expect(kindFromWording('Best Pollo Al Chilindron Near Me')).toMatchObject({ kind: 'TIGRAM' });
    expect(kindFromWording('Antivirus FreeDoor2.4.6.8')).toMatchObject({ kind: 'TIGRAM' });
    expect(kindFromWording('how to reset a router')).toMatchObject({ kind: 'TIGRAM' });
    // A plain name says nothing on its own.
    expect(kindFromWording('Jackie Rozo')).toBeNull();
  });

  it('does not read "age" inside another word', () => {
    expect(kindFromWording('package tracking')).not.toMatchObject({ kind: 'CELEBRITY' });
  });

  it('asks Wikidata about a plain name, and only trusts an entry with that exact name', async () => {
    const answers: Record<string, unknown> = {
      wbsearchentities: { search: [{ id: 'Q1', label: 'Jackie Rozo', description: 'American model' }] },
      wbgetentities: { entities: { Q1: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } } } },
    };
    const fetchMock = async (input: string | URL) => {
      const url = String(input);
      const key = Object.keys(answers).find((name) => url.includes(name));
      return { ok: true, json: async () => answers[key ?? ''] } as Response;
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      expect(await detectKeywordKind('Jackie Rozo')).toMatchObject({ kind: 'CELEBRITY', source: 'wikidata' });
      // The film "Inception" is not a person.
      answers.wbsearchentities = { search: [{ id: 'Q2', label: 'Inception', description: '2010 film' }] };
      answers.wbgetentities = { entities: { Q2: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] } } } };
      expect(await detectKeywordKind('Inception')).toMatchObject({ kind: 'TIGRAM', source: 'wikidata' });
      // Nothing found at all: the user decides.
      answers.wbsearchentities = { search: [] };
      expect(await detectKeywordKind('Zzz Unknown Person')).toMatchObject({ kind: 'UNKNOWN' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('sends each kind to its own writer', () => {
    expect(moduleForKind('CELEBRITY')).toBe('celebrity-writer');
    expect(moduleForKind('TIGRAM')).toBe('tigram-writer');
    expect(moduleForKind('UNKNOWN')).toBe('tigram-writer');
  });

  it('puts a celebrity article in the celebrity category of the website', () => {
    const named = (...names: string[]) => names.map((name) => ({ name }));
    expect(celebrityCategory(named('Blog', 'Business', 'Celebrity', 'News'))?.name).toBe('Celebrity');
    expect(celebrityCategory(named('Blog', 'Celebrities'))?.name).toBe('Celebrities');
    expect(celebrityCategory(named('Gesundheit', 'Prominente', 'Unterhaltung'))?.name).toBe('Prominente');
    expect(celebrityCategory(named('Stars', 'Tech'))?.name).toBe('Stars');
    // Nothing that only looks similar, and nothing at all on a site without one.
    expect(celebrityCategory(named('Startups', 'Promotions', 'Star Wars'))).toBeNull();
    expect(celebrityCategory(named('Blog', 'Tech'))).toBeNull();
  });
});
