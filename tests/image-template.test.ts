// The website image template: designs, rendering and colours (used by the Tigram images and the template preview).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-template-test-'));
process.env.DATA_DIR = tmp;

const { DEFAULT_TEMPLATE, DIVIDER_WIDTH, LOGO_HEIGHT, picturesFor, renderTemplate, templateFor } = await import('@/automation/images/template');
const { defaultDesign, designHtml, parseDesign, slotCount, slotSizes, shapeOf } = await import('@/automation/images/design');

/** Width and height from the JPEG itself, so the test does not trust the renderer's own numbers. */
function jpegSize(file: string): { width: number; height: number } {
  const data = fs.readFileSync(file);
  for (let i = 2; i < data.length - 9; ) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    // SOF0/SOF1/SOF2 carry the size.
    if (marker >= 0xc0 && marker <= 0xc2) return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw new Error('no size found in the JPEG');
}

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('website template', () => {
  it('falls back to the default template when a website has no files', () => {
    expect(templateFor('Peak Buzz')).toMatchObject({ ...DEFAULT_TEMPLATE, logo: null, accentFromSettings: false });
  });

  it('uses the logo and colour saved on the Websites page', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'site123-logo.png'), 'not really a png');
    const template = templateFor({ id: 'site123', name: 'Any Name', logoFile: 'site123-logo.png', accentColour: '#112233', logoPosition: 'top-left' });
    expect(template.logo).toContain('site123-logo.png');
    expect(template.accent).toBe('#112233');
    expect(template.logoPosition).toBe('top-left');
    expect(template.accentFromSettings).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a logo file that is gone and keeps working', () => {
    const template = templateFor({ id: 'site123', name: 'Any Name', logoFile: 'deleted-logo.png', accentColour: null, logoPosition: null });
    expect(template.logo).toBeNull();
    expect(template.logoPosition).toBe('bottom-right');
  });

  it('uses the logo and colour of that website', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'peak-buzz-logo.png'), 'not really a png');
    fs.writeFileSync(path.join(dir, 'peak-buzz.json'), JSON.stringify({ accent: '#ff0000', logoPosition: 'top-left' }));
    const template = templateFor('Peak Buzz');
    expect(template.accent).toBe('#ff0000');
    expect(template.logoPosition).toBe('top-left');
    expect(template.logo).toContain('peak-buzz-logo.png');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('draws two picture places with the line between them for a split website', () => {
    const design = defaultDesign('featured', { split: true, accent: '#0179DE', logoPosition: 'bottom-right', dividerWidth: DIVIDER_WIDTH, logoHeight: LOGO_HEIGHT });
    expect(slotCount(design)).toBe(2);
    const [left, right] = slotSizes(design);
    expect(left.width * 2 + DIVIDER_WIDTH).toBe(1920);
    expect(right).toEqual(left);
    const html = designHtml(design, ['a.jpg', 'b.jpg'], 'logo.png');
    expect(html).toContain('#0179DE');
    expect(html.match(/<img(?![^>]*data-backdrop)/g)).toHaveLength(3); // two pictures and the logo
    // Each picture has a hidden blurred copy behind it, used when a picture is much taller than its place.
    expect(html.match(/data-backdrop="1"[^>]*display:none/g)).toHaveLength(2);
  });

  it('draws one picture place with the logo in its corner otherwise', () => {
    const design = defaultDesign('body', { split: false, accent: '#0179DE', logoPosition: 'bottom-right', dividerWidth: DIVIDER_WIDTH, logoHeight: LOGO_HEIGHT });
    expect(slotCount(design)).toBe(1);
    expect(slotSizes(design)[0]).toEqual({ width: 1920, height: 1080 });
    expect(designHtml(design, ['a.jpg'], null).match(/<img(?![^>]*data-backdrop)/g)).toHaveLength(1); // no logo file, so no logo
  });

  it('can hang the logo in the middle of the lower edge', () => {
    const design = defaultDesign('body', { split: false, accent: '#0179DE', logoPosition: 'bottom-center', dividerWidth: DIVIDER_WIDTH, logoHeight: LOGO_HEIGHT });
    const logo = design.layers.find((layer) => layer.type === 'logo');
    expect(Math.round((logo?.x ?? 0) + (logo?.width ?? 0) / 2)).toBe(960);
    expect(templateFor({ name: 'X', logoPosition: 'bottom-center' }).logoPosition).toBe('bottom-center');
  });
});

describe('rendering the template', () => {
  const photo = path.join(tmp, 'photo.png');
  const logo = path.join(tmp, 'logo.png');
  beforeAll(() => {
    // A tiny but valid PNG (1×1, red) — the template scales it to fill the frame.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(photo, png);
    fs.writeFileSync(logo, png);
  });

  it('writes a 1920×1080 JPEG from the pictures', async () => {
    const out = path.join(tmp, 'featured.jpg');
    await renderTemplate([photo, photo], { ...DEFAULT_TEMPLATE, logo }, out);
    expect(fs.existsSync(out)).toBe(true);
    expect(jpegSize(out)).toEqual({ width: 1920, height: 1080 });
    // The working copies of the pictures are cleaned up again.
    expect(fs.readdirSync(tmp).filter((name) => name.startsWith('template-'))).toHaveLength(0);
  }, 120_000);

  it('refuses to build an image without a picture', async () => {
    await expect(renderTemplate([], DEFAULT_TEMPLATE, path.join(tmp, 'none.jpg'))).rejects.toThrow(/at least one photo/);
  });
});

describe('the divider colour', () => {
  it('follows the logo when the website has no colour of its own', async () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    // A 2×2 PNG of pure green.
    const green = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNk+M/wn4GBgYGJAQkAACYCAwGfM6+9AAAAAElFTkSuQmCC', 'base64');
    const logo = path.join(dir, 'colour-test-logo.png');
    fs.writeFileSync(logo, green);
    const template = templateFor('Colour Test');
    expect(template.accentFromSettings).toBe(false);
    const out = path.join(tmp, 'colour.jpg');
    const { accent } = await renderTemplate([logo, logo], template, out);
    expect(fs.existsSync(out)).toBe(true);
    // The logo is green, so the divider is green too instead of the default blue.
    const [r, g, b] = (/rgb\((\d+), (\d+), (\d+)\)/.exec(accent) ?? []).slice(1).map(Number);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it('keeps the colour from the website settings file', () => {
    const dir = path.join(tmp, 'templates');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'fixed-colour.json'), JSON.stringify({ accent: '#00ff00' }));
    const template = templateFor('Fixed Colour');
    expect(template.accent).toBe('#00ff00');
    expect(template.accentFromSettings).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('planning the pictures', () => {
  it('asks for every picture in the shape of its place', () => {
    const split = templateFor({ name: 'Split Site', featuredStyle: 'split' });
    const places = picturesFor(split, 'featured');
    expect(places).toHaveLength(2);
    // Half of a banner is upright, so a square is asked for instead of a wide picture.
    expect(places[0].shape).toContain('square');
    expect(picturesFor(split, 'body')[0].shape).toContain('landscape');
    expect(shapeOf({ width: 1000, height: 1600 })).toContain('portrait');
  });

  it('reads a design that was saved by the editor and throws away broken layers', () => {
    const design = parseDesign({ layers: [{ type: 'slot', x: 0, y: 0, width: 100, height: 100 }, { type: 'nonsense' }, null] });
    expect(design?.layers).toHaveLength(1);
    expect(parseDesign({ layers: [] })).toBeNull();
    expect(parseDesign(null)).toBeNull();
  });
});
