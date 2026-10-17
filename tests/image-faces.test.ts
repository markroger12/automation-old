// Faces in gallery pictures: where a photo that fills its place by cropping is cut, the render with that crop, and
// the real MediaPipe detector loading in headless Chrome (when it is installed in data/tools/mediapipe).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';

const tools = path.resolve('data/tools/mediapipe');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-faces-test-'));
process.env.DATA_DIR = tmp;

const { faceFocus, detectFaces, findFaceDetector } = await import('@/automation/images/faces');
const { renderTemplate, templateFor } = await import('@/automation/images/template');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HALF = { width: 946, height: 1080 };
const face = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, score: 0.9 });

describe('cropping around faces', () => {
  it('moves a wide picture so a face near its edge stays in a narrow place', () => {
    // 1600×900 shown 1920×1080 in a 946 px half: 974 px of it are cut away.
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [face(0.875, 0.33, 0.1, 0.22)])).toEqual({ x: 100, y: 50 });
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [face(0.45, 0.3, 0.1, 0.2)])).toEqual({ x: 50, y: 50 });
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [face(0.02, 0.3, 0.1, 0.2)])).toEqual({ x: 0, y: 50 });
  });

  it('keeps room over the heads in a tall picture and keeps two people together', () => {
    // 600×1200 shown 1920×3840 in the full image: faces at the top stay near the top, not in the middle.
    expect(faceFocus({ width: 600, height: 1200 }, { width: 1920, height: 1080 }, [face(0.4, 0.1, 0.2, 0.1)])).toEqual({ x: 50, y: 5.2 });
    // Two faces side by side (0.55 to 0.85 across): the middle of both, 0.70, is centred as far as the picture allows.
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [face(0.55, 0.3, 0.1, 0.2), face(0.75, 0.3, 0.1, 0.2)])?.x).toBeCloseTo(89.4, 1);
  });

  it('ignores small faces in the background and pictures without faces', () => {
    const main = face(0.1, 0.3, 0.1, 0.2);
    const background = face(0.9, 0.3, 0.03, 0.05);
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [main, background])).toEqual(faceFocus({ width: 1600, height: 900 }, HALF, [main]));
    expect(faceFocus({ width: 1600, height: 900 }, HALF, [])).toBeNull();
  });

  it('renders the split featured image with the face inside, as WebP', async () => {
    // A grey picture with a red "face" near its right edge, left half of a split image.
    const picture = path.join(tmp, 'wide.png');
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#808080' } })
      .composite([{ input: { create: { width: 160, height: 200, channels: 3, background: '#ff0000' } }, left: 1400, top: 300 }])
      .png()
      .toFile(picture);
    const other = path.join(tmp, 'other.png');
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#2040a0' } }).png().toFile(other);
    const template = templateFor({ id: 'faces', name: 'Faces Test', featuredStyle: 'split' });
    const pixel = async (file: string) => [...(await sharp(fs.readFileSync(file)).extract({ left: 800, top: 480, width: 1, height: 1 }).raw().toBuffer())];

    const plain = path.join(tmp, 'plain.jpg');
    await renderTemplate([picture, other], template, plain, 'featured');
    const [r0, g0] = await pixel(plain);
    expect(r0 - g0).toBeLessThan(40);

    const focused = path.join(tmp, 'focused.webp');
    await renderTemplate([picture, other], template, focused, 'featured', [[face(1400 / 1600, 300 / 900, 160 / 1600, 200 / 900)]]);
    expect((await sharp(fs.readFileSync(focused)).metadata()).format).toBe('webp');
    const [r, g, b] = await pixel(focused);
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(80);
  }, 60_000);
});

describe('the MediaPipe face detector', () => {
  it('is only used when it is installed', () => {
    expect(findFaceDetector(path.join(tmp, 'nothing'))).toBeNull();
  });

  it.skipIf(!findFaceDetector(tools))('loads in headless Chrome and finds no face where there is none', async () => {
    const grey = path.join(tmp, 'grey.jpg');
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#9a9a9a' } }).jpeg().toFile(grey);
    expect(await detectFaces([grey, path.join(tmp, 'missing.jpg')], tools)).toEqual([[], []]);
  }, 60_000);
});
