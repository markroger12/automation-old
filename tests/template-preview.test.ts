import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-preview-test-'));
process.env.DATA_DIR = tmp;

const { templatePreview } = await import('@/lib/services/template-preview');

/** Width and height of a JPEG, read from the file itself. */
function jpegSize(data: Buffer): { width: number; height: number } {
  for (let i = 2; i < data.length - 9; ) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw new Error('no size found in the JPEG');
}

const decode = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the image template preview', () => {
  it('shows a featured image and a picture from the text, both 1920×1080', async () => {
    const preview = await templatePreview({ id: 'w1', name: 'Preview Site' }, { featuredStyle: 'split', accentColour: '#ff0000' });
    expect(preview.accent).toBe('#ff0000');
    expect(preview.logo).toBe(false);
    for (const image of [preview.featured, preview.body]) {
      expect(image.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(jpegSize(decode(image))).toEqual({ width: 1920, height: 1080 });
    }
    // The two previews differ: the featured one is split, the other is a single picture.
    expect(preview.featured).not.toBe(preview.body);
  }, 120_000);

  it('leaves no working folders behind', async () => {
    await templatePreview({ id: 'w1', name: 'Preview Site' }, { featuredStyle: 'single' });
    const left = fs.readdirSync(path.join(tmp, 'templates')).filter((name) => name.startsWith('preview-'));
    expect(left).toHaveLength(0);
  }, 120_000);
});

describe('a design made in the editor', () => {
  it('is used for the preview before it is saved', async () => {
    const design = {
      background: '#101820',
      layers: [
        { id: 'a', type: 'slot', slot: 0, x: 0, y: 0, width: 1280, height: 1080 },
        { id: 'b', type: 'slot', slot: 1, x: 1280, y: 0, width: 640, height: 1080 },
        { id: 'c', type: 'rect', colour: '#ff0000', x: 1270, y: 0, width: 10, height: 1080 },
      ],
    };
    const preview = await templatePreview({ id: 'w2', name: 'Design Site' }, { design: { featured: design } });
    expect(jpegSize(decode(preview.featured))).toEqual({ width: 1920, height: 1080 });
    // Two places means two pictures are needed for the featured image.
    const plain = await templatePreview({ id: 'w2', name: 'Design Site' }, {});
    expect(preview.featured).not.toBe(plain.featured);
  }, 180_000);

  it('renders a design brought in from a file, drawings and all, without any picture place', async () => {
    const dot =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const design = {
      background: '#ffffff',
      layers: [
        { id: 'line', type: 'rect', colour: '#22A139', x: 930, y: 0, width: 60, height: 1080 },
        { id: 'circle', type: 'rect', shape: 'circle', colour: '#ffffff', x: 800, y: 380, width: 320, height: 320, shadow: { blur: 50, colour: 'black', opacity: 1 } },
        { id: 'mark', type: 'image', src: dot, x: 880, y: 460, width: 160, height: 160, fit: 'fill' },
      ],
    };
    const preview = await templatePreview({ id: 'w3', name: 'Imported Site' }, { design: { featured: design } });
    expect(jpegSize(decode(preview.featured))).toEqual({ width: 1920, height: 1080 });
  }, 180_000);
});
