// Reads a design exported from Polotno (the editor behind Canva-like tools such as the one the templates were drawn
// in) and turns one of its pages into a design this app can render. Nothing here touches the disk: the Image Template
// editor runs this in the browser, and the same code checks the file again on the server.
import { CANVAS, safeSource, type TemplateDesign, type TemplateLayer } from './design';

/** One page of an imported file, ready to be used as a design. */
export interface PolotnoPage {
  /** 1, 2, 3 … as the file lists them. */
  number: number;
  design: TemplateDesign;
  /** How many picture places the page has. */
  slots: number;
  /** Anything that could not be brought over, in plain words. */
  notes: string[];
}

export interface PolotnoFile {
  width: number;
  height: number;
  pages: PolotnoPage[];
}

interface RawElement {
  id?: unknown;
  type?: unknown;
  subType?: unknown;
  children?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  opacity?: unknown;
  visible?: unknown;
  showInExport?: unknown;
  fill?: unknown;
  stroke?: unknown;
  strokeWidth?: unknown;
  cornerRadius?: unknown;
  src?: unknown;
  text?: unknown;
  fontSize?: unknown;
  fontFamily?: unknown;
  fontWeight?: unknown;
  fontStyle?: unknown;
  lineHeight?: unknown;
  align?: unknown;
  verticalAlign?: unknown;
  shadowEnabled?: unknown;
  shadowBlur?: unknown;
  shadowOffsetX?: unknown;
  shadowOffsetY?: unknown;
  shadowColor?: unknown;
  shadowOpacity?: unknown;
}

const number = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/** Polotno writes weights as "normal"/"bold" or as a number. */
function weightOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  return undefined;
}

function shadowOf(element: RawElement): TemplateLayer['shadow'] {
  if (element.shadowEnabled !== true) return undefined;
  const blur = number(element.shadowBlur, 0);
  const x = number(element.shadowOffsetX, 0);
  const y = number(element.shadowOffsetY, 0);
  if (!blur && !x && !y) return undefined;
  return { blur, x, y, colour: text(element.shadowColor) ?? '#000000', opacity: number(element.shadowOpacity, 1) };
}

/** Everything sits on a 1920×1080 canvas, so a page of another size is scaled and centred on it. */
interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function layersOf(elements: unknown, fit: Fit, state: { slots: number; notes: Set<string> }): TemplateLayer[] {
  if (!Array.isArray(elements)) return [];
  const layers: TemplateLayer[] = [];
  for (const entry of elements) {
    const element = (entry ?? {}) as RawElement;
    if (element.visible === false || element.showInExport === false) continue;
    // A group only holds other elements, and its children already carry their real place on the page.
    if (element.type === 'group') {
      layers.push(...layersOf(element.children, fit, state));
      continue;
    }
    const base = {
      id: typeof element.id === 'string' && element.id ? `p-${element.id}` : id('layer'),
      x: number(element.x) * fit.scale + fit.offsetX,
      y: number(element.y) * fit.scale + fit.offsetY,
      width: Math.max(1, number(element.width, 100) * fit.scale),
      height: Math.max(1, number(element.height, 100) * fit.scale),
      rotation: number(element.rotation) || undefined,
      opacity: element.opacity === undefined ? undefined : number(element.opacity, 1),
      shadow: shadowOf(element),
      radius: number(element.cornerRadius) ? number(element.cornerRadius) * fit.scale : undefined,
    };

    switch (element.type) {
      case 'image': {
        // A picture in a template is where a created picture goes; the original stays with the layer, so it can be
        // turned back into a fixed picture in the editor.
        const src = safeSource(element.src);
        layers.push({ ...base, type: 'slot', slot: state.slots, fit: 'cover', focus: 50, ...(src ? { src } : {}) });
        state.slots++;
        break;
      }
      case 'svg': {
        const src = safeSource(element.src);
        if (!src) {
          state.notes.add('A drawing could not be brought over because its address is not a picture built into the file.');
          break;
        }
        layers.push({ ...base, type: 'image', src, fit: 'fill' });
        break;
      }
      case 'figure': {
        if (element.subType && element.subType !== 'rect' && element.subType !== 'circle') {
          state.notes.add(`A "${String(element.subType)}" shape became a rectangle — this app draws rectangles and circles.`);
        }
        layers.push({
          ...base,
          type: 'rect',
          shape: element.subType === 'circle' ? 'circle' : 'rect',
          colour: text(element.fill) ?? '#0179DE',
          stroke: text(element.stroke),
          strokeWidth: number(element.strokeWidth) || undefined,
        });
        break;
      }
      case 'text': {
        layers.push({
          ...base,
          type: 'text',
          text: text(element.text) ?? '',
          colour: text(element.fill) ?? '#ffffff',
          fontSize: Math.max(4, Math.round(number(element.fontSize, 64) * fit.scale)),
          fontFamily: text(element.fontFamily),
          fontWeight: weightOf(element.fontWeight),
          italic: element.fontStyle === 'italic' || undefined,
          lineHeight: number(element.lineHeight) || undefined,
          align: element.align === 'left' || element.align === 'right' ? element.align : 'center',
          valign: element.verticalAlign === 'top' || element.verticalAlign === 'bottom' ? element.verticalAlign : 'middle',
        });
        break;
      }
      case 'line': {
        layers.push({ ...base, type: 'rect', height: Math.max(1, number(element.strokeWidth, 2) * fit.scale), colour: text(element.stroke) ?? '#0179DE' });
        break;
      }
      default:
        state.notes.add(`A "${String(element.type ?? 'unknown')}" element was left out — it cannot be part of an article image.`);
    }
  }
  return layers;
}

/** True for anything that looks like a file from Polotno, so the editor can say so before it tries. */
export function isPolotnoFile(value: unknown): boolean {
  const raw = value as { pages?: unknown } | null | undefined;
  return Boolean(raw && typeof raw === 'object' && Array.isArray(raw.pages));
}

/**
 * Every page of the file as a design. Pages keep their look: a page of another shape is scaled to fit the
 * 1920×1080 article image and centred on it, so nothing is cut off.
 */
export function readPolotno(value: unknown): PolotnoFile {
  const raw = (value ?? {}) as { width?: unknown; height?: unknown; pages?: unknown };
  if (!Array.isArray(raw.pages) || !raw.pages.length) throw new Error('This file has no pages — is it exported from Polotno?');
  const width = Math.max(1, number(raw.width, CANVAS.width));
  const height = Math.max(1, number(raw.height, CANVAS.height));
  const scale = Math.min(CANVAS.width / width, CANVAS.height / height);
  const fit: Fit = { scale, offsetX: (CANVAS.width - width * scale) / 2, offsetY: (CANVAS.height - height * scale) / 2 };

  const pages: PolotnoPage[] = raw.pages.map((entry, index) => {
    const page = (entry ?? {}) as { children?: unknown; background?: unknown };
    const state = { slots: 0, notes: new Set<string>() };
    const layers = layersOf(page.children, fit, state);
    if (!layers.length) state.notes.add('This page has nothing on it.');
    if (!state.slots) state.notes.add('No picture place was found — add one in the editor, otherwise the image stays as it is drawn here.');
    return {
      number: index + 1,
      design: { background: text(page.background) ?? '#ffffff', layers },
      slots: state.slots,
      notes: [...state.notes],
    };
  });
  return { width, height, pages };
}
