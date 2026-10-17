// Choosing and ordering the gallery pictures: copies of one photo count once (the biggest stays), pictures with a
// clear face come first, soft pictures go last. Real pictures are drawn here; the face detector is a stand-in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { choosePictures, type Candidate } from '@/automation/images/choose';
import { fingerprintDistance, pictureFingerprint, pictureSharpness, SAME_PICTURE_BITS } from '@/automation/images/similar';

let root = '';
const messages: string[] = [];
const log = { info: (m: string) => messages.push(`info ${m}`), warn: (m: string) => messages.push(`warn ${m}`) };

/** A picture of coloured shapes; `layout` decides where they are, so two layouts are two different photos. */
async function picture(name: string, layout: number, width: number, height: number, options: { blur?: number; quality?: number } = {}): Promise<Candidate> {
  const shapes = Array.from({ length: 6 }, (_, i) => {
    const x = ((layout * 37 + i * 53) % 90) + 5;
    const y = ((layout * 23 + i * 41) % 80) + 10;
    return `<circle cx="${x}%" cy="${y}%" r="${8 + ((layout + i) % 5) * 3}%" fill="hsl(${(layout * 70 + i * 50) % 360},70%,${30 + i * 8}%)"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f4f1ea"/>${shapes}</svg>`;
  let image = sharp(Buffer.from(svg));
  if (options.blur) image = image.blur(options.blur);
  const file = path.join(root, name);
  await image.jpeg({ quality: options.quality ?? 90 }).toFile(file);
  return { path: file, mime: 'image/jpeg', width, height, bytes: fs.statSync(file).size };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-choose-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const face = (height: number) => ({ x: 0.4, y: 0.2, width: height * 0.8, height, score: 0.95 });
const names = (list: Candidate[]) => list.map((p) => path.basename(p.path));

describe('choosing the gallery pictures', () => {
  it('knows the same photo in another size and quality, and tells different photos apart', async () => {
    const big = await picture('same-big.jpg', 1, 1200, 800);
    const small = await picture('same-small.jpg', 1, 480, 320, { quality: 45 });
    const other = await picture('other.jpg', 2, 1200, 800);
    const [a, b, c] = await Promise.all([big, small, other].map((p) => pictureFingerprint(p.path)));
    expect(fingerprintDistance(a, b)).toBeLessThanOrEqual(SAME_PICTURE_BITS);
    expect(fingerprintDistance(a, c)).toBeGreaterThan(SAME_PICTURE_BITS);
    expect(await pictureSharpness((await picture('soft.jpg', 3, 1200, 800, { blur: 6 })).path)).toBeLessThan((await pictureSharpness(other.path)) * 0.4);
  });

  it('keeps the biggest copy, puts faces first (the biggest face first) and soft pictures last', async () => {
    messages.length = 0;
    const copySmall = await picture('copy-small.jpg', 4, 600, 400, { quality: 50 });
    const copyBig = await picture('copy-big.jpg', 4, 1500, 1000);
    const smallFace = await picture('small-face.jpg', 5, 700, 700);
    const bigFace = await picture('big-face.jpg', 6, 900, 900);
    const softFace = await picture('soft-face.jpg', 7, 1600, 1000, { blur: 8 });
    const noFace = await picture('no-face.jpg', 8, 2000, 1300);
    const faces: Record<string, ReturnType<typeof face>[]> = { 'small-face.jpg': [face(0.2)], 'big-face.jpg': [face(0.4)], 'soft-face.jpg': [face(0.5)] };
    const detect = vi.fn(async (files: string[]) => files.map((file) => faces[path.basename(file)] ?? []));

    const ordered = await choosePictures([copySmall, noFace, smallFace, copyBig, softFace, bigFace], log, detect);
    expect(names(ordered)).toEqual(['big-face.jpg', 'small-face.jpg', 'soft-face.jpg', 'no-face.jpg', 'copy-big.jpg']);
    expect(messages).toEqual([
      'info 1 gallery picture(s) left out as copies of another one (same photo from another site or in another size)',
      'info Gallery pictures ordered: 5 different, 3 with a face, 1 soft (used last)',
    ]);

    // What was measured travels with the pictures: a retry looks at nothing again.
    detect.mockClear();
    expect(names(await choosePictures(ordered, log, detect))).toEqual(names(ordered));
    expect(detect).not.toHaveBeenCalled();
  });

  it('knows a cropped copy by the area around the faces (seen live: justin biel)', async () => {
    messages.length = 0;
    // One site shows the whole photo, another only a part of it: as a whole they differ, around the faces they do not.
    const whole = await picture('crop-whole.jpg', 12, 1200, 800);
    const cropped = path.join(root, 'crop-part.jpg');
    await sharp(fs.readFileSync(whole.path)).extract({ left: 200, top: 100, width: 700, height: 600 }).jpeg({ quality: 70 }).toFile(cropped);
    const part: Candidate = { path: cropped, mime: 'image/jpeg', width: 700, height: 600, bytes: fs.statSync(cropped).size };
    const other = await picture('crop-other.jpg', 13, 1000, 700);
    // Two faces at (300–420, 200–340) and (600–720, 220–360) in the whole photo; the same pixels in the part.
    const inWhole = [{ x: 300 / 1200, y: 200 / 800, width: 120 / 1200, height: 140 / 800, score: 0.9 }, { x: 600 / 1200, y: 220 / 800, width: 120 / 1200, height: 140 / 800, score: 0.9 }];
    const inPart = [{ x: 100 / 700, y: 100 / 600, width: 120 / 700, height: 140 / 600, score: 0.9 }, { x: 400 / 700, y: 120 / 600, width: 120 / 700, height: 140 / 600, score: 0.9 }];
    const faces: Record<string, typeof inWhole> = { 'crop-whole.jpg': inWhole, 'crop-part.jpg': inPart, 'crop-other.jpg': inWhole };
    expect(fingerprintDistance(await pictureFingerprint(whole.path), await pictureFingerprint(cropped))).toBeGreaterThan(SAME_PICTURE_BITS);
    const ordered = await choosePictures([part, other, whole], log, async (files) => files.map((file) => faces[path.basename(file)] ?? []));
    expect(names(ordered)).toEqual(['crop-whole.jpg', 'crop-other.jpg']);
    expect(messages).toContain('info 1 gallery picture(s) left out as cropped copies of another one (the same faces in the same moment)');
  });

  it('still orders by size when the face detector is not installed or fails', async () => {
    messages.length = 0;
    const small = await picture('plain-small.jpg', 9, 500, 400);
    const big = await picture('plain-big.jpg', 10, 1400, 900);
    expect(names(await choosePictures([small, big], log, async () => null))).toEqual(['plain-big.jpg', 'plain-small.jpg']);
    expect(names(await choosePictures([small, big], log, async () => { throw new Error('WebAssembly failed'); }))).toEqual(['plain-big.jpg', 'plain-small.jpg']);
    expect(messages.filter((m) => m.startsWith('warn'))).toEqual([
      'warn Face detection is not installed in data\\tools\\mediapipe — pictures are ordered and cropped without it',
      'warn Face detection failed (WebAssembly failed) — pictures are ordered and cropped without it',
    ]);
  });

  it('leaves out a file that is not a picture', async () => {
    messages.length = 0;
    const broken = path.join(root, 'broken.jpg');
    fs.writeFileSync(broken, 'not a picture');
    const good = await picture('good.jpg', 11, 800, 600);
    const ordered = await choosePictures([{ path: broken, mime: 'image/jpeg', width: 800, height: 600, bytes: 13 }, good], log, async () => null);
    expect(names(ordered)).toEqual(['good.jpg']);
    expect(messages[0]).toMatch(/^warn Picture broken\.jpg could not be read \(.+\) — left out$/);
  });
});
