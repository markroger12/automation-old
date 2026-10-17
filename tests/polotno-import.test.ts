import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-polotno-test-'));
process.env.DATA_DIR = tmp;

const { readPolotno, isPolotnoFile } = await import('@/automation/images/polotno');
const { CANVAS, designHtml, parseDesign, slotCount, slotSizes } = await import('@/automation/images/design');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A tiny red dot, the way an exported file carries its drawings. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const file = (over: Record<string, unknown> = {}) => ({
  width: 1920,
  height: 1080,
  pages: [
    {
      id: 'page-1',
      background: '#101820',
      children: [
        { id: 'a', type: 'figure', subType: 'rect', x: 930, y: 0, width: 60, height: 1080, fill: '#22A139', shadowEnabled: true, shadowBlur: 50, shadowColor: 'black', shadowOpacity: 1 },
        { id: 'b', type: 'figure', subType: 'circle', x: 800, y: 380, width: 320, height: 320, fill: 'rgba(255,255,255,1)' },
        { id: 'c', type: 'image', src: PIXEL, x: 0, y: 0, width: 930, height: 1080 },
        {
          id: 'd',
          type: 'group',
          children: [
            { id: 'd1', type: 'svg', src: PIXEL, x: 895, y: 460, width: 180, height: 185 },
            { id: 'd2', type: 'text', text: 'Peak Buzz', x: 100, y: 900, width: 700, height: 120, fontSize: 64, fill: '#ffffff', fontWeight: 'bold', align: 'left' },
          ],
        },
        { id: 'e', type: 'figure', subType: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#000', visible: false },
      ],
    },
    { id: 'page-2', background: 'white', children: [{ id: 'f', type: 'image', src: PIXEL, x: 0, y: 0, width: 1920, height: 1080 }] },
  ],
  ...over,
});

describe('a design file exported from Polotno', () => {
  it('is recognised before anything is read from it', () => {
    expect(isPolotnoFile(file())).toBe(true);
    expect(isPolotnoFile({ layers: [] })).toBe(false);
    expect(() => readPolotno({ pages: [] })).toThrow();
  });

  it('brings every page over as its own design', () => {
    const { pages } = readPolotno(file());
    expect(pages).toHaveLength(2);
    expect(pages[0].design.background).toBe('#101820');
    expect(pages[1].slots).toBe(1);
  });

  it('turns each kind of element into the right layer', () => {
    const [page] = readPolotno(file()).pages;
    const types = page.design.layers.map((layer) => layer.type);
    // The hidden element is left out; the group's two children come over on their own.
    expect(types).toEqual(['rect', 'rect', 'slot', 'image', 'text']);
    const [line, circle, picture, drawing, title] = page.design.layers;
    expect(line).toMatchObject({ colour: '#22A139', x: 930, width: 60 });
    expect(line.shadow).toMatchObject({ blur: 50, colour: 'black' });
    expect(circle.shape).toBe('circle');
    expect(picture).toMatchObject({ slot: 0, fit: 'cover' });
    expect(drawing.src).toBe(PIXEL);
    expect(title).toMatchObject({ text: 'Peak Buzz', fontSize: 64, fontWeight: 700, align: 'left', colour: '#ffffff' });
  });

  it('counts the pictures ChatGPT has to create for the imported page', () => {
    const [page] = readPolotno(file()).pages;
    expect(page.slots).toBe(1);
    expect(slotCount(page.design)).toBe(1);
    expect(slotSizes(page.design)[0]).toEqual({ width: 930, height: 1080 });
  });

  it('says so when a page has no place for a created picture', () => {
    const empty = file({ pages: [{ id: 'p', children: [{ id: 'x', type: 'figure', x: 0, y: 0, width: 10, height: 10, fill: '#fff' }] }] });
    expect(readPolotno(empty).pages[0].notes.join(' ')).toContain('No picture place');
  });

  it('scales a page of another shape onto the article image and centres it', () => {
    const square = readPolotno({ width: 1080, height: 1080, pages: [{ id: 'p', children: [{ id: 'x', type: 'image', src: PIXEL, x: 0, y: 0, width: 1080, height: 1080 }] }] });
    const [layer] = square.pages[0].design.layers;
    expect(layer.height).toBe(CANVAS.height);
    expect(layer.width).toBe(CANVAS.height);
    // Centred: the same gap on the left and on the right.
    expect(layer.x).toBeCloseTo((CANVAS.width - CANVAS.height) / 2, 5);
  });

  it('refuses a picture that would read something else off this computer', () => {
    const nasty = file({
      pages: [
        {
          id: 'p',
          children: [
            { id: 'x', type: 'svg', src: 'file:///C:/Windows/win.ini', x: 0, y: 0, width: 10, height: 10 },
            { id: 'y', type: 'svg', src: 'http://example.com/a.svg', x: 0, y: 0, width: 10, height: 10 },
          ],
        },
      ],
    });
    const [page] = readPolotno(nasty).pages;
    expect(page.design.layers).toHaveLength(0);
    expect(page.notes.join(' ')).toContain('not a picture built into the file');
    // The same check runs again on the way into the database.
    expect(parseDesign({ layers: [{ id: 'x', type: 'image', src: 'file:///etc/passwd', x: 0, y: 0, width: 10, height: 10 }] })).toBeNull();
  });

  it('draws an imported page as a page the renderer can photograph', () => {
    const [page] = readPolotno(file()).pages;
    const html = designHtml(page.design, ['photo-0.jpg'], 'logo.png');
    expect(html).toContain('photo-0.jpg');
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('Peak Buzz');
    expect(html).toContain(PIXEL);
    // Only the created picture has to load; the drawing of the design itself may have no size of its own.
    expect(html.match(/data-required="1"/g)).toHaveLength(1);
  });
});
