// A website's own image design: a 1920×1080 canvas with layers the user arranges in the Image Template editor.
// A layer is a place for a created picture, the logo, a coloured box (the line between two pictures is one) or text.
import { escapeHtml } from '@/lib/utils';

export type LayerType = 'slot' | 'logo' | 'rect' | 'text' | 'image';

/** A drop shadow, the way an imported design describes it. */
export interface LayerShadow {
  blur?: number;
  x?: number;
  y?: number;
  colour?: string;
  opacity?: number;
}

export interface TemplateLayer {
  id: string;
  type: LayerType;
  /** Position and size in pixels on the 1920×1080 canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** slot: which of the created pictures goes here (0 = the first one). */
  slot?: number;
  /** slot and image: fill the whole place (cover), show the whole picture (contain) or stretch it (fill). */
  fit?: 'cover' | 'contain' | 'fill';
  /** slot: which part of the picture stays visible when it is cropped, 0 = top, 100 = bottom. */
  focus?: number;
  /** image: a picture that belongs to the design itself (a data: address from an imported file, or https). */
  src?: string;
  /** rect and text: the colour. */
  colour?: string;
  /** rect: a circle instead of a rectangle. */
  shape?: 'rect' | 'circle';
  /** rect and image: the outline. */
  stroke?: string;
  strokeWidth?: number;
  /** Turned clockwise around its own middle. */
  rotation?: number;
  shadow?: LayerShadow;
  /** logo: the plate behind the logo ("none" leaves it transparent). */
  background?: string;
  padding?: number;
  radius?: number;
  opacity?: number;
  /** text layers. */
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  italic?: boolean;
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
  /** text: where the text sits inside its box. */
  valign?: 'top' | 'middle' | 'bottom';
}

export interface TemplateDesign {
  background?: string;
  layers: TemplateLayer[];
}

export interface WebsiteDesigns {
  featured?: TemplateDesign;
  body?: TemplateDesign;
}

/** Every article image is this size. The editor runs in the browser, so this must not come from a server module. */
export const CANVAS = { width: 1920, height: 1080 } as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/**
 * A picture that a design may carry itself. Only a picture built into the file (data:) or one from a secure address
 * is kept, so an imported file can never make the renderer read something else off this computer.
 */
export function safeSource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const src = value.trim();
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(src)) return src.replace(/\s+/g, '');
  if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
  return undefined;
}

function parseShadow(value: unknown): LayerShadow | undefined {
  const raw = value as Partial<LayerShadow> | null | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const shadow: LayerShadow = {
    blur: clamp(number(raw.blur, 0), 0, 400),
    x: clamp(number(raw.x, 0), -400, 400),
    y: clamp(number(raw.y, 0), -400, 400),
    opacity: clamp(number(raw.opacity, 1), 0, 1),
    colour: typeof raw.colour === 'string' ? raw.colour : '#000000',
  };
  return shadow.blur || shadow.x || shadow.y ? shadow : undefined;
}

/** Reads a design that came from the database, the editor or an imported file, dropping anything that is not usable. */
export function parseDesign(value: unknown): TemplateDesign | null {
  const raw = value as Partial<TemplateDesign> | null | undefined;
  if (!raw || !Array.isArray(raw.layers)) return null;
  const layers: TemplateLayer[] = [];
  for (const [index, entry] of raw.layers.entries()) {
    const layer = entry as Partial<TemplateLayer>;
    if (!layer || !['slot', 'logo', 'rect', 'text', 'image'].includes(layer.type as string)) continue;
    const src = safeSource(layer.src);
    // A picture place that has nothing to show is not worth keeping.
    if (layer.type === 'image' && !src) continue;
    layers.push({
      ...layer,
      id: typeof layer.id === 'string' && layer.id ? layer.id : `layer-${index}`,
      type: layer.type as LayerType,
      x: clamp(number(layer.x, 0), -CANVAS.width, CANVAS.width * 2),
      y: clamp(number(layer.y, 0), -CANVAS.height, CANVAS.height * 2),
      width: clamp(number(layer.width, 200), 1, CANVAS.width * 2),
      height: clamp(number(layer.height, 200), 1, CANVAS.height * 2),
      rotation: layer.rotation === undefined ? undefined : clamp(number(layer.rotation, 0), -360, 360),
      ...(src ? { src } : { src: undefined }),
      shadow: parseShadow(layer.shadow),
    });
  }
  return layers.length ? { background: typeof raw.background === 'string' ? raw.background : undefined, layers } : null;
}

/** How many created pictures this design needs. */
export function slotCount(design: TemplateDesign | null | undefined): number {
  if (!design) return 1;
  const slots = design.layers.filter((layer) => layer.type === 'slot');
  if (!slots.length) return 0;
  return Math.max(...slots.map((layer) => number(layer.slot, 0) + 1));
}

/** The size of each picture place, so every picture can be created in the shape it will sit in. */
export function slotSizes(design: TemplateDesign | null | undefined): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = [];
  for (const layer of design?.layers ?? []) {
    if (layer.type !== 'slot') continue;
    const index = number(layer.slot, 0);
    const size = { width: Math.max(16, Math.round(layer.width)), height: Math.max(16, Math.round(layer.height)) };
    // Two places showing the same picture: the bigger one decides its shape.
    const known = sizes[index];
    if (!known || known.width * known.height < size.width * size.height) sizes[index] = size;
  }
  for (let index = 0; index < sizes.length; index++) sizes[index] ??= { width: CANVAS.width, height: CANVAS.height };
  return sizes;
}

/** How a picture of this shape is asked for. */
export function shapeOf(size: { width: number; height: number }): string {
  const ratio = size.width / size.height;
  if (ratio > 1.3) return 'in a wide landscape format (16:9)';
  if (ratio < 0.8) return 'in a tall portrait format';
  return 'in a square format (1:1)';
}

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export interface DesignDefaults {
  /** Two pictures with the line between them, or a single picture. */
  split: boolean;
  accent: string;
  logoPosition: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
  /** The line between two pictures. */
  dividerWidth: number;
  logoHeight: number;
}

/** The design a website starts from — the same look the templates had before the editor existed. */
export function defaultDesign(kind: 'featured' | 'body', defaults: DesignDefaults): TemplateDesign {
  const split = kind === 'featured' && defaults.split;
  const layers: TemplateLayer[] = [];
  if (split) {
    const half = (CANVAS.width - defaults.dividerWidth) / 2;
    layers.push(
      { id: id('slot'), type: 'slot', slot: 0, fit: 'cover', focus: 22, x: 0, y: 0, width: half, height: CANVAS.height },
      { id: id('slot'), type: 'slot', slot: 1, fit: 'cover', focus: 22, x: half + defaults.dividerWidth, y: 0, width: half, height: CANVAS.height },
      { id: id('rect'), type: 'rect', colour: defaults.accent, x: half, y: 0, width: defaults.dividerWidth, height: CANVAS.height },
      {
        id: id('logo'),
        type: 'logo',
        background: '#ffffff',
        padding: 0,
        x: (CANVAS.width - defaults.logoHeight * 1.08) / 2,
        y: (CANVAS.height - defaults.logoHeight) / 2,
        width: defaults.logoHeight * 1.08,
        height: defaults.logoHeight,
      },
    );
  } else {
    const [vertical, horizontal] = defaults.logoPosition.split('-');
    const width = defaults.logoHeight * 1.08;
    const x = horizontal === 'center' ? (CANVAS.width - width) / 2 : horizontal === 'left' ? 60 : CANVAS.width - width - 60;
    const y = vertical === 'top' ? 52 : CANVAS.height - defaults.logoHeight - 52;
    layers.push(
      { id: id('slot'), type: 'slot', slot: 0, fit: 'cover', focus: 22, x: 0, y: 0, width: CANVAS.width, height: CANVAS.height },
      { id: id('logo'), type: 'logo', background: '#ffffff', padding: 0, x, y, width, height: defaults.logoHeight },
    );
  }
  return { background: '#0b1220', layers };
}

/** Just the file name — the pictures sit next to the page the browser opens. (No node:path: the editor runs in the browser too.) */
const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file;

const css = (value: string | number | undefined, fallback: string | number) => (value === undefined || value === '' ? fallback : value);

/** A colour as CSS, with the opacity an imported shadow can carry. */
function shadowCss(shadow: LayerShadow | undefined, kind: 'box' | 'drop'): string {
  if (!shadow) return '';
  const colour = escapeHtml(shadow.colour ?? '#000000');
  const [x, y, blur] = [number(shadow.x, 0), number(shadow.y, 0), number(shadow.blur, 0)];
  const opacity = number(shadow.opacity, 1);
  if (kind === 'drop') return `filter:drop-shadow(${x}px ${y}px ${blur}px ${colour});opacity:${opacity};`;
  return `box-shadow:${x}px ${y}px ${blur}px ${colour};`;
}

/** Everything that is the same for every layer: where it sits, how it is turned and how see-through it is. */
function boxCss(layer: TemplateLayer): string {
  const rotation = number(layer.rotation, 0);
  const radius = layer.shape === 'circle' ? '50%' : `${css(layer.radius, 0)}px`;
  return (
    `position:absolute;left:${layer.x}px;top:${layer.y}px;width:${layer.width}px;height:${layer.height}px;` +
    `opacity:${css(layer.opacity, 1)};border-radius:${radius};` +
    (rotation ? `transform:rotate(${rotation}deg);transform-origin:center center;` : '')
  );
}

const justify = (align: TemplateLayer['align']) => (align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center');
const alignItems = (valign: TemplateLayer['valign']) => (valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center');

function layerHtml(layer: TemplateLayer, pictures: string[], logo: string | null): string {
  const box = boxCss(layer);
  switch (layer.type) {
    case 'slot': {
      const picture = pictures[number(layer.slot, 0)];
      if (!picture) return '';
      const fit = layer.fit === 'contain' ? 'contain' : layer.fit === 'fill' ? 'fill' : 'cover';
      const src = escapeHtml(fileName(picture));
      // The hidden blurred copy behind it is shown when the picture turns out much taller than its place (see
      // showWholeTallPictures): the photo is then shown whole on it instead of losing the face to the crop.
      return (
        `<div style="${box}overflow:hidden;${shadowCss(layer.shadow, 'box')}">` +
        `<img src="${src}" alt="" data-backdrop="1" style="position:absolute;left:-60px;top:-60px;width:calc(100% + 120px);height:calc(100% + 120px);object-fit:cover;filter:blur(40px) brightness(0.72);display:none" />` +
        `<img src="${src}" alt="" data-required="1" data-slot="1" ` +
        `style="position:relative;width:100%;height:100%;object-fit:${fit};object-position:center ${css(layer.focus, 22)}%;display:block" /></div>`
      );
    }
    case 'logo': {
      if (!logo) return '';
      const background = layer.background && layer.background !== 'none' ? layer.background : 'transparent';
      return (
        `<div style="${box}overflow:hidden;background:${escapeHtml(background)};padding:${css(layer.padding, 0)}px;display:flex;align-items:center;justify-content:center;${shadowCss(layer.shadow, 'box')}">` +
        `<img src="${escapeHtml(fileName(logo))}" alt="" data-required="1" style="max-width:100%;max-height:100%;object-fit:contain;display:block" /></div>`
      );
    }
    case 'image': {
      if (!layer.src) return '';
      const fit = layer.fit === 'cover' ? 'cover' : layer.fit === 'contain' ? 'contain' : 'fill';
      return (
        `<img src="${escapeHtml(layer.src)}" alt="" style="${box}object-fit:${fit};display:block;${shadowCss(layer.shadow, 'drop')}` +
        `${layer.strokeWidth ? `border:${number(layer.strokeWidth, 0)}px solid ${escapeHtml(layer.stroke ?? '#000000')};` : ''}" />`
      );
    }
    case 'rect':
      return (
        `<div style="${box}background:${escapeHtml(String(css(layer.colour, '#0179DE')))};${shadowCss(layer.shadow, 'box')}` +
        `${layer.strokeWidth ? `border:${number(layer.strokeWidth, 0)}px solid ${escapeHtml(layer.stroke ?? '#000000')};` : ''}"></div>`
      );
    case 'text':
      return (
        `<div style="${box}display:flex;align-items:${alignItems(layer.valign)};justify-content:${justify(layer.align)};` +
        `color:${escapeHtml(String(css(layer.colour, '#ffffff')))};font-size:${css(layer.fontSize, 64)}px;font-weight:${css(layer.fontWeight, 700)};` +
        `font-family:${escapeHtml(String(css(layer.fontFamily, 'Inter,Arial,sans-serif')))};${layer.italic ? 'font-style:italic;' : ''}` +
        `line-height:${css(layer.lineHeight, 1.15)};text-align:${css(layer.align, 'center')};white-space:pre-wrap;word-break:break-word;overflow:hidden">` +
        `${escapeHtml(layer.text ?? '')}</div>`
      );
    default:
      return '';
  }
}

/** The whole design as a page the browser takes a picture of. Layers are drawn in the order they are listed. */
export function designHtml(design: TemplateDesign, pictures: string[], logo: string | null): string {
  const body = design.layers.map((layer) => layerHtml(layer, pictures, logo)).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${CANVAS.width}px; height: ${CANVAS.height}px; overflow: hidden; }
  .frame { position: relative; width: ${CANVAS.width}px; height: ${CANVAS.height}px; background: ${escapeHtml(design.background ?? '#0b1220')}; }
</style></head><body><div class="frame">${body}</div></body></html>`;
}
