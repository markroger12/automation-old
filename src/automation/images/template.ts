// The website's own image template: the photos are laid out in a page and a browser takes a 1920×1080 picture of it.
// Each website can have its own logo and colour in data/templates (see templateFor).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { findBrowserExecutable } from '@/automation/browser/system-browser';
import { templatesRoot } from '@/lib/paths';
import { slugify } from '@/lib/utils';
import { IMAGE_SIZE } from './store';
import { defaultDesign, designHtml, parseDesign, shapeOf, slotCount, slotSizes, type TemplateDesign, type WebsiteDesigns } from './design';
import { faceFocus, type FaceBox } from './faces';

export interface WebsiteTemplate {
  /** The website's own designs from the Image Template editor (empty = the default look below). */
  designs?: WebsiteDesigns;
  /** True when the accent colour comes from the website's own settings file instead of the logo. */
  accentFromSettings?: boolean;
  /** PNG or JPEG with the website's logo; nothing is drawn when the file is missing. */
  logo: string | null;
  /** Divider and logo colour. */
  accent: string;
  /** Where the logo sits when a single photo fills the image. */
  logoPosition: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
  /** "split" = the featured image is built from two pictures. */
  featuredStyle?: 'split' | 'single';
}

export const DEFAULT_TEMPLATE: WebsiteTemplate = { logo: null, accent: '#1f7ae0', logoPosition: 'bottom-right' };

/** The line between the two halves of a split featured image, measured from the websites' own templates. */
export const DIVIDER_WIDTH = 28;

/** How tall the logo sits on an image. */
export const LOGO_HEIGHT = 226;

/** One half of a split featured image — pictures for it are created in this shape, so nothing is cropped away. */
export const HALF_SIZE = { width: (IMAGE_SIZE.width - DIVIDER_WIDTH) / 2, height: IMAGE_SIZE.height } as const;

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    for (const extension of ['png', 'jpg', 'jpeg', 'webp', 'svg']) {
      const file = path.join(dir, `${name}.${extension}`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** What the template needs to know about a website (the fields come from the Websites page). */
export interface TemplateWebsite {
  id?: string | null;
  name?: string | null;
  logoFile?: string | null;
  accentColour?: string | null;
  logoPosition?: string | null;
  featuredStyle?: string | null;
  /** What the editor saved: { featured, body }. */
  imageTemplate?: unknown;
}

const POSITIONS = ['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'top-left'] as const;
const isPosition = (value: unknown): value is WebsiteTemplate['logoPosition'] => POSITIONS.includes(value as never);

/**
 * The template of one website: the logo uploaded on the Websites page, otherwise a file put into data/templates by
 * hand (<website>-logo.png with an optional <website>.json holding { "accent", "logoPosition" }). "default" is used
 * when a website has neither.
 */
export function templateFor(website: TemplateWebsite | string | null | undefined): WebsiteTemplate {
  const site: TemplateWebsite = typeof website === 'string' ? { name: website } : (website ?? {});
  const dir = templatesRoot();
  const slug = slugify(site.name ?? '', 60) || 'default';
  const uploaded = site.logoFile ? path.join(dir, site.logoFile) : null;
  const logo = uploaded && fs.existsSync(uploaded) ? uploaded : firstExisting(dir, [`${slug}-logo`, slug, 'default-logo', 'default']);
  let settings: Partial<WebsiteTemplate> = {};
  for (const name of [slug, 'default']) {
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WebsiteTemplate>;
      break;
    } catch {
      /* a broken file falls back to the defaults below */
    }
  }
  // What the Websites page holds wins over the files.
  const accent = site.accentColour ?? (typeof settings.accent === 'string' ? settings.accent : null);
  const position = isPosition(site.logoPosition) ? site.logoPosition : isPosition(settings.logoPosition) ? settings.logoPosition : DEFAULT_TEMPLATE.logoPosition;
  const saved = (site.imageTemplate ?? null) as { featured?: unknown; body?: unknown } | null;
  const designs: WebsiteDesigns = {
    featured: parseDesign(saved?.featured) ?? undefined,
    body: parseDesign(saved?.body) ?? undefined,
  };
  return {
    ...DEFAULT_TEMPLATE,
    ...settings,
    accent: accent ?? DEFAULT_TEMPLATE.accent,
    logoPosition: position,
    logo,
    accentFromSettings: Boolean(accent),
    designs,
    featuredStyle: site.featuredStyle === 'split' ? 'split' : 'single',
  };
}

/** The design used for one kind of image: the website's own, otherwise the default look. */
export function designFor(template: WebsiteTemplate, kind: 'featured' | 'body'): TemplateDesign {
  const saved = template.designs?.[kind];
  if (saved) return saved;
  return defaultDesign(kind, {
    split: template.featuredStyle === 'split',
    accent: template.accent,
    logoPosition: template.logoPosition,
    dividerWidth: DIVIDER_WIDTH,
    logoHeight: LOGO_HEIGHT,
  });
}

/** How many created pictures one kind of image needs, and the shape each of them should have. */
export function picturesFor(template: WebsiteTemplate, kind: 'featured' | 'body'): { width: number; height: number; shape: string }[] {
  const design = designFor(template, kind);
  return slotSizes(design)
    .slice(0, slotCount(design))
    .map((size) => ({ ...size, shape: shapeOf(size) }));
}

const escapeAttribute = (value: string) => value.replace(/"/g, '&quot;');

/** The strongest colour of the logo, read from the rendered logo image in the page. */
async function logoColour(view: Page): Promise<string | null> {
  return view.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('.logo img');
    if (!image?.naturalWidth) return null;
    const canvas = document.createElement('canvas');
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    let best: { score: number; colour: string } | null = null;
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Skip white, black and grey — a logo's colour is the one with some saturation.
      if (max - min < 40 || max < 40) continue;
      const key = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}|${r},${g},${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      const [r, g, b] = key.split('|')[1].split(',').map(Number);
      const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const score = count * (0.5 + saturation);
      if (!best || score > best.score) best = { score, colour: `rgb(${r}, ${g}, ${b})` };
    }
    return best?.colour ?? null;
  });
}

/**
 * Runs in the rendered page. A picture that fills its place by cropping (a real photo of a person, usually upright)
 * but is much taller than the place would lose the face: it is shown whole instead, on a blurred copy of itself.
 * Pictures created in the shape of their place are never touched.
 */
function showWholeTallPictures(): void {
  for (const image of document.querySelectorAll<HTMLImageElement>('img[data-slot="1"]')) {
    const box = image.parentElement?.getBoundingClientRect();
    if (!box?.height || !image.naturalHeight || getComputedStyle(image).objectFit !== 'cover') continue;
    if (image.naturalWidth / image.naturalHeight >= (box.width / box.height) * 0.8) continue;
    image.style.objectFit = 'contain';
    const backdrop = image.previousElementSibling as HTMLElement | null;
    if (backdrop?.dataset.backdrop === '1') backdrop.style.display = 'block';
  }
}

/**
 * Runs in the rendered page. A photo that still fills its place by cropping is moved so its faces stay inside
 * (object-position from faceFocus, per photo — the file name says which photo an image shows).
 */
function focusOnFaces(focus: ({ x: number; y: number } | null)[]): void {
  for (const image of document.querySelectorAll<HTMLImageElement>('img[data-slot="1"]')) {
    if (getComputedStyle(image).objectFit !== 'cover') continue;
    const at = focus[Number((image.getAttribute('src') ?? '').match(/photo-(\d+)/)?.[1] ?? -1)];
    if (at) image.style.objectPosition = `${at.x}% ${at.y}%`;
  }
}

/**
 * Renders the template into a JPEG (or WebP, by the file name) of exactly 1920×1080. The photos and the logo are copied next to the page first,
 * because a browser only loads local images that sit beside the page it opened.
 */
export async function renderTemplate(
  photos: string[],
  template: WebsiteTemplate,
  outFile: string,
  kind: 'featured' | 'body' = photos.length > 1 ? 'featured' : 'body',
  /** The faces found in each photo: a photo cropped to fill its place is then cropped around them. */
  faces: (FaceBox[] | undefined)[] = [],
): Promise<{ accent: string }> {
  // A design can be pure drawing (no picture place), and that one renders without any photo.
  if (!photos.length && slotCount(designFor(template, kind)) > 0) throw new Error('The image template needs at least one photo');
  const work = await fsp.mkdtemp(path.join(path.dirname(outFile), 'template-'));
  try {
    const copies: string[] = [];
    for (const [index, photo] of photos.entries()) {
      const copy = path.join(work, `photo-${index}${path.extname(photo) || '.jpg'}`);
      await fsp.copyFile(photo, copy);
      copies.push(copy);
    }
    let logo = template.logo;
    if (logo && fs.existsSync(logo)) {
      const copy = path.join(work, `logo${path.extname(logo) || '.png'}`);
      await fsp.copyFile(logo, copy);
      logo = copy;
    } else {
      logo = null;
    }
    const executablePath = findBrowserExecutable('chrome') ?? findBrowserExecutable('chromium') ?? undefined;
    // Reading the logo's colour from a page needs the local files to count as one origin.
    const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'], ...(executablePath ? { executablePath } : {}) });
    try {
      // Without a colour of its own the design takes the logo's own colour, so the image matches the website.
      let accent = template.accent;
      if (logo && !template.accentFromSettings) {
        const probeFile = path.join(work, 'logo.html');
        await fsp.writeFile(probeFile, `<html><body><div class="logo"><img src="${path.basename(logo)}" alt="" /></div></body></html>`, 'utf8');
        const probe = await browser.newPage();
        await probe.goto(`file://${probeFile.split(path.sep).join('/')}`, { waitUntil: 'load' });
        accent = (await logoColour(probe)) ?? accent;
        await probe.close();
      }

      const page = path.join(work, 'template.html');
      const design = designFor({ ...template, accent }, kind);
      await fsp.writeFile(page, designHtml(design, copies, logo), 'utf8');

      const view = await browser.newPage({ viewport: { ...IMAGE_SIZE } });
      await view.goto(`file://${page.split(path.sep).join('/')}`, { waitUntil: 'load' });
      // Only the created pictures and the logo have to be there; a drawing of the design itself may have no size of its own.
      const broken = await view.evaluate(() => [...document.images].filter((image) => image.dataset.required === '1' && !image.naturalWidth).length);
      if (broken) throw new Error(`${broken} picture(s) could not be loaded into the template`);
      await view.evaluate(showWholeTallPictures);
      const places = slotSizes(design);
      const focus = await Promise.all(
        copies.map(async (copy, index) => {
          if (!faces[index]?.length || !places[index]) return null;
          // From memory, not the path: on Windows sharp keeps a file it opened, and the work folder must be removable.
          const meta = await sharp(await fsp.readFile(copy)).metadata();
          return meta.width && meta.height ? faceFocus({ width: meta.width, height: meta.height }, places[index], faces[index]!) : null;
        }),
      );
      if (focus.some(Boolean)) await view.evaluate(focusOnFaces, focus);
      if (/\.webp$/i.test(outFile)) {
        // WebP is about a third smaller than the JPEG at the same look, so the article loads faster.
        await sharp(await view.screenshot({ type: 'png' })).webp({ quality: 90 }).toFile(outFile);
      } else {
        // High quality: WordPress compresses the picture again when it is uploaded, so this must not start out soft.
        await view.screenshot({ path: outFile, type: 'jpeg', quality: 96 });
      }
      return { accent };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
