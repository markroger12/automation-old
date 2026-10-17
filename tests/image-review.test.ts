// The photo check: ChatGPT's per-photo answer is read into watermark + alt description, and photos are attached small.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { altText, isCollage, parseReview, reviewAttachments } from '@/automation/images/review';
import { putFlaggedLast, type Candidate } from '@/automation/images/choose';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-review-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('the photo check answer', () => {
  it('reads one line per photo, in the format asked for or close to it', () => {
    const answer = [
      '1: watermark=no | alt=Smiling couple holding a baby inside a church',
      '**2:** watermark=yes | alt="Man in a blue shirt at a family party."',
      'Photo 3 - watermark: no | alt: Two men in suits on a red carpet',
      '4) Wasserzeichen=ja | alt=Paar vor einer Hochzeitstorte',
      'Here are your results!',
    ].join('\n\n');
    expect(parseReview(answer, 5)).toEqual([
      { watermark: false, collage: false, alt: 'Smiling couple holding a baby inside a church' },
      { watermark: true, collage: false, alt: 'Man in a blue shirt at a family party' },
      { watermark: false, collage: false, alt: 'Two men in suits on a red carpet' },
      { watermark: true, collage: false, alt: 'Paar vor einer Hochzeitstorte' },
      null,
    ]);
  });

  it('ignores numbers outside the attached photos and a second line for the same photo', () => {
    expect(parseReview('1: watermark=no | alt=First\n1: watermark=yes | alt=Again\n7: watermark=yes | alt=Nope', 2)).toEqual([
      { watermark: false, collage: false, alt: 'First' },
      null,
    ]);
  });

  it('knows another site’s collage from the answer, or from a description that calls it one', () => {
    // As the photo check answered for gary phillip spector (27 September 2026), before collages were asked about.
    const answer = [
      '1: watermark=no | collage=no | alt=Three women perform onstage with musicians behind them',
      '2: watermark=no | collage=yes | alt=Mother kissing a child next to an old photo at a piano',
      '3: watermark=no | alt=Black-and-white collage showing children and adults in family settings',
      '4: watermark=no | alt=Family photo shown side by side with a studio portrait',
    ].join('\n');
    expect(parseReview(answer, 4).map((review) => review?.collage)).toEqual([false, true, true, true]);
    expect(isCollage({ watermark: false, alt: 'Family photo collage with children and adults indoors' })).toBe(true);
    expect(isCollage({ watermark: false, alt: 'Woman embraces two children in an indoor family snapshot' })).toBe(false);
  });

  it('writes the alt text as the name plus what the photo shows, or keeps the plain one', () => {
    expect(altText('Peter Buchignani', { watermark: false, alt: 'Smiling couple holding a baby inside a church' }, 'plain'))
      .toBe('Peter Buchignani – Smiling couple holding a baby inside a church');
    expect(altText('Peter Buchignani', undefined, 'Peter Buchignani – Featured image')).toBe('Peter Buchignani – Featured image');
    expect(altText('Peter', { watermark: false, alt: 'x'.repeat(200) }, 'plain')).toHaveLength(125);
    // Seen live: the keyword was typed in small letters.
    expect(altText('justin biel', { watermark: false, alt: 'Couple kissing at a charity gala' }, 'plain')).toBe('Justin Biel – Couple kissing at a charity gala');
    expect(altText('jean-luc dupont', { watermark: false, alt: 'Man on a stage' }, 'plain')).toBe('Jean-Luc Dupont – Man on a stage');
    expect(altText('LeBron James', { watermark: false, alt: 'Player' }, 'plain')).toBe('LeBron James – Player');
  });

  it('puts photos with a watermark after the clean ones and collages last, keeping each group in order', () => {
    const photo = (name: string, watermark?: boolean, collage?: boolean): Candidate => ({
      path: name, mime: 'image/jpeg', width: 1, height: 1, bytes: 1,
      ...(watermark === undefined ? {} : { review: { watermark, collage, alt: '' } }),
    });
    const ordered = putFlaggedLast([photo('a', true), photo('b', false, true), photo('c'), photo('d', true), photo('e', false), photo('f', false, true)]);
    expect(ordered.map((p: Candidate) => p.path)).toEqual(['c', 'e', 'a', 'd', 'b', 'f']);
  });

  it('attaches each photo as a JPEG of at most 1024 px', async () => {
    const big = path.join(root, 'big.png');
    await sharp({ create: { width: 3000, height: 2000, channels: 4, background: '#33669980' } }).png().toFile(big);
    const [attachment] = await reviewAttachments([big]);
    expect(attachment).toMatchObject({ name: 'photo-1.jpg', mime: 'image/jpeg' });
    const meta = await sharp(Buffer.from(attachment.data, 'base64')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1024, 683]);
  });
});
