'use client';

import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  Image as ImageIcon,
  Maximize2,
  Minus,
  Plus,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import type { TemplateDesign, TemplateLayer } from '@/automation/images/design';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';

export const CANVAS = { width: 1920, height: 1080 };
/** Layers line up with each other and with the canvas within this many pixels (hold Shift to place freely). */
const SNAP = 10;
const MIN_SIZE = 8;

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function newLayer(type: TemplateLayer['type'], slots: number): TemplateLayer {
  const base = { id: newId(type), type, x: 660, y: 390, width: 600, height: 300 };
  if (type === 'slot') return { ...base, slot: slots, fit: 'cover', focus: 22 };
  if (type === 'logo') return { ...base, width: 244, height: 226, background: '#ffffff', padding: 0 };
  if (type === 'text') return { ...base, height: 120, text: 'Your text', colour: '#ffffff', fontSize: 72, fontWeight: 700, align: 'center' };
  if (type === 'image') return { ...base, fit: 'fill' };
  return { ...base, height: 1080, width: 28, x: 946, y: 0, colour: '#0179DE' };
}

const LAYER_NAMES: Record<TemplateLayer['type'], string> = {
  slot: 'Picture place',
  logo: 'Logo',
  rect: 'Colour box',
  text: 'Text',
  image: 'Fixed picture',
};

/** A colour the browser's colour picker can show; anything else (rgba from an imported file) keeps its text field. */
const hexOf = (colour: string | undefined, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(colour ?? '') ? (colour as string) : fallback);

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { handle: Handle; cursor: string; style: React.CSSProperties }[] = [
  { handle: 'nw', cursor: 'nwse-resize', style: { left: -5, top: -5 } },
  { handle: 'n', cursor: 'ns-resize', style: { left: 'calc(50% - 5px)', top: -5 } },
  { handle: 'ne', cursor: 'nesw-resize', style: { right: -5, top: -5 } },
  { handle: 'e', cursor: 'ew-resize', style: { right: -5, top: 'calc(50% - 5px)' } },
  { handle: 'se', cursor: 'nwse-resize', style: { right: -5, bottom: -5 } },
  { handle: 's', cursor: 'ns-resize', style: { left: 'calc(50% - 5px)', bottom: -5 } },
  { handle: 'sw', cursor: 'nesw-resize', style: { left: -5, bottom: -5 } },
  { handle: 'w', cursor: 'ew-resize', style: { left: -5, top: 'calc(50% - 5px)' } },
];

interface Guides {
  x: number[];
  y: number[];
}

/** The lines a layer can line up with: the canvas edges and middle, plus every other layer. */
function snapTargets(layers: TemplateLayer[], skipId: string): { x: number[]; y: number[] } {
  const x = [0, CANVAS.width / 2, CANVAS.width];
  const y = [0, CANVAS.height / 2, CANVAS.height];
  for (const layer of layers) {
    if (layer.id === skipId) continue;
    x.push(layer.x, layer.x + layer.width / 2, layer.x + layer.width);
    y.push(layer.y, layer.y + layer.height / 2, layer.y + layer.height);
  }
  return { x, y };
}

/** Moves `value` onto the nearest line when it is close enough. `edges` are the offsets that may line up. */
function snap(value: number, edges: number[], targets: number[], tolerance: number): { value: number; guide: number | null } {
  let best: { value: number; guide: number; distance: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const distance = Math.abs(value + edge - target);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { value: target - edge, guide: target, distance };
    }
  }
  return best ? { value: best.value, guide: best.guide } : { value, guide: null };
}

/** The canvas: layers sit where they will be on the image, and can be dragged, resized and lined up. */
export function DesignCanvas({
  design,
  logoUrl,
  selectedId,
  onSelect,
  onChange,
  onBeginChange,
}: {
  design: TemplateDesign;
  logoUrl: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (layers: TemplateLayer[]) => void;
  onBeginChange?: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.5);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const drag = useRef<{ id: string; handle: Handle | 'move'; startX: number; startY: number; layer: TemplateLayer } | null>(null);
  const scale = zoom === 'fit' ? fitScale : zoom;

  // The canvas takes the whole width it is given; that is what makes the editor big.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const fit = () => {
      const width = element.clientWidth - 24;
      if (width > 0) setFitScale(clamp(width / CANVAS.width, 0.1, 1));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const start = (event: ReactPointerEvent, layer: TemplateLayer, handle: Handle | 'move') => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    onSelect(layer.id);
    onBeginChange?.();
    drag.current = { id: layer.id, handle, startX: event.clientX, startY: event.clientY, layer };
  };

  const move = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const free = event.shiftKey;
    const tolerance = free ? 0 : SNAP / scale;
    const dx = (event.clientX - state.startX) / scale;
    const dy = (event.clientY - state.startY) / scale;
    const targets = snapTargets(design.layers, state.id);
    const next: Guides = { x: [], y: [] };
    const base = state.layer;

    let box = { x: base.x, y: base.y, width: base.width, height: base.height };
    if (state.handle === 'move') {
      const x = snap(base.x + dx, [0, base.width / 2, base.width], targets.x, tolerance);
      const y = snap(base.y + dy, [0, base.height / 2, base.height], targets.y, tolerance);
      box = { ...box, x: Math.round(x.value), y: Math.round(y.value) };
      if (x.guide !== null) next.x.push(x.guide);
      if (y.guide !== null) next.y.push(y.guide);
    } else {
      const handle = state.handle;
      if (handle.includes('w')) {
        const left = snap(base.x + dx, [0], targets.x, tolerance);
        const x = Math.min(left.value, base.x + base.width - MIN_SIZE);
        box.width = base.x + base.width - x;
        box.x = x;
        if (left.guide !== null) next.x.push(left.guide);
      }
      if (handle.includes('e')) {
        const right = snap(base.x + base.width + dx, [0], targets.x, tolerance);
        box.width = Math.max(MIN_SIZE, right.value - base.x);
        if (right.guide !== null) next.x.push(right.guide);
      }
      if (handle.includes('n')) {
        const top = snap(base.y + dy, [0], targets.y, tolerance);
        const y = Math.min(top.value, base.y + base.height - MIN_SIZE);
        box.height = base.y + base.height - y;
        box.y = y;
        if (top.guide !== null) next.y.push(top.guide);
      }
      if (handle.includes('s')) {
        const bottom = snap(base.y + base.height + dy, [0], targets.y, tolerance);
        box.height = Math.max(MIN_SIZE, bottom.value - base.y);
        if (bottom.guide !== null) next.y.push(bottom.guide);
      }
      box = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    }

    setGuides(next);
    onChange(design.layers.map((layer) => (layer.id === state.id ? { ...layer, ...box } : layer)));
  };

  const stop = () => {
    drag.current = null;
    setGuides({ x: [], y: [] });
  };

  const zoomBy = (step: number) => setZoom(clamp(Math.round((scale + step) * 100) / 100, 0.1, 1.5));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
          <Button type="button" variant="ghost" onClick={() => zoomBy(-0.1)} title="Zoom out">
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums text-slate-600">{Math.round(scale * 100)}%</span>
          <Button type="button" variant="ghost" onClick={() => zoomBy(0.1)} title="Zoom in">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Button type="button" variant={zoom === 'fit' ? 'secondary' : 'outline'} onClick={() => setZoom('fit')} title="Fit the width">
          <Maximize2 className="h-4 w-4" /> Fit
        </Button>
        <Button type="button" variant={zoom === 1 ? 'secondary' : 'outline'} onClick={() => setZoom(1)}>
          100%
        </Button>
        <p className="ml-auto text-xs text-slate-500">Drag to move, drag a handle to resize. Hold Shift to place freely, arrow keys nudge.</p>
      </div>

      <div ref={area} className="max-h-[70vh] overflow-auto rounded-xl border border-slate-300 bg-slate-100 p-3">
        <div
          onPointerMove={move}
          onPointerUp={stop}
          onPointerCancel={stop}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onSelect(null);
          }}
          className="relative overflow-hidden shadow-inner"
          style={{ width: CANVAS.width * scale, height: CANVAS.height * scale, background: design.background ?? '#0b1220' }}
        >
          {design.layers.map((layer) => {
            const selected = layer.id === selectedId;
            const style: React.CSSProperties = {
              left: layer.x * scale,
              top: layer.y * scale,
              width: layer.width * scale,
              height: layer.height * scale,
              opacity: layer.opacity ?? 1,
              borderRadius: layer.shape === 'circle' ? '50%' : (layer.radius ?? 0) * scale,
              transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
            };
            return (
              <div
                key={layer.id}
                onPointerDown={(event) => start(event, layer, 'move')}
                className={`absolute cursor-move ${selected ? 'outline outline-2 outline-indigo-400' : 'outline outline-1 outline-white/20'}`}
                style={style}
              >
                {layer.type === 'slot' && (
                  <div className="relative h-full w-full overflow-hidden bg-slate-500/40">
                    {layer.src && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={layer.src} alt="" className="h-full w-full object-cover opacity-40" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-white">
                      Picture {(layer.slot ?? 0) + 1}
                    </span>
                  </div>
                )}
                {layer.type === 'rect' && (
                  <div
                    className="h-full w-full"
                    style={{
                      background: layer.colour ?? '#0179DE',
                      borderRadius: 'inherit',
                      border: layer.strokeWidth ? `${layer.strokeWidth * scale}px solid ${layer.stroke ?? '#000'}` : undefined,
                    }}
                  />
                )}
                {layer.type === 'image' && layer.src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={layer.src} alt="" className="h-full w-full" style={{ objectFit: layer.fit === 'cover' ? 'cover' : layer.fit === 'contain' ? 'contain' : 'fill' }} />
                )}
                {layer.type === 'logo' && (
                  <div
                    className="flex h-full w-full items-center justify-center overflow-hidden"
                    style={{ background: layer.background === 'none' ? 'transparent' : (layer.background ?? '#fff'), padding: (layer.padding ?? 0) * scale }}
                  >
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-500">logo</span>
                    )}
                  </div>
                )}
                {layer.type === 'text' && (
                  <div
                    className="flex h-full w-full overflow-hidden whitespace-pre-wrap"
                    style={{
                      color: layer.colour ?? '#fff',
                      fontSize: (layer.fontSize ?? 64) * scale,
                      fontWeight: layer.fontWeight ?? 700,
                      fontFamily: layer.fontFamily,
                      fontStyle: layer.italic ? 'italic' : undefined,
                      lineHeight: layer.lineHeight ?? 1.15,
                      textAlign: layer.align ?? 'center',
                      justifyContent: layer.align === 'left' ? 'flex-start' : layer.align === 'right' ? 'flex-end' : 'center',
                      alignItems: layer.valign === 'top' ? 'flex-start' : layer.valign === 'bottom' ? 'flex-end' : 'center',
                    }}
                  >
                    {layer.text}
                  </div>
                )}
                {selected &&
                  HANDLES.map(({ handle, cursor, style: position }) => (
                    <span
                      key={handle}
                      onPointerDown={(event) => start(event, layer, handle)}
                      className="absolute h-2.5 w-2.5 rounded-sm border border-white bg-indigo-500"
                      style={{ ...position, cursor }}
                    />
                  ))}
              </div>
            );
          })}

          {guides.x.map((position) => (
            <span key={`x${position}`} className="pointer-events-none absolute top-0 h-full w-px bg-rose-400" style={{ left: position * scale }} />
          ))}
          {guides.y.map((position) => (
            <span key={`y${position}`} className="pointer-events-none absolute left-0 h-px w-full bg-rose-400" style={{ top: position * scale }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The list of layers plus the settings of the selected one. */
export function LayerPanel({
  design,
  selectedId,
  onSelect,
  onChange,
  onBeginChange,
}: {
  design: TemplateDesign;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (design: TemplateDesign) => void;
  onBeginChange?: () => void;
}) {
  const layers = design.layers;
  const selected = layers.find((layer) => layer.id === selectedId) ?? null;
  const slots = layers.filter((layer) => layer.type === 'slot').length;

  const setLayers = useCallback(
    (next: TemplateLayer[]) => {
      onBeginChange?.();
      onChange({ ...design, layers: next });
    },
    [design, onChange, onBeginChange],
  );
  const update = (patch: Partial<TemplateLayer>) => setLayers(layers.map((layer) => (layer.id === selectedId ? { ...layer, ...patch } : layer)));
  const add = (type: TemplateLayer['type']) => {
    const layer = newLayer(type, slots);
    setLayers([...layers, layer]);
    onSelect(layer.id);
  };
  const remove = () => {
    setLayers(layers.filter((layer) => layer.id !== selectedId));
    onSelect(null);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: newId(selected.type), x: selected.x + 40, y: selected.y + 40 };
    setLayers([...layers, copy]);
    onSelect(copy.id);
  };
  const shift = (direction: -1 | 1) => {
    const index = layers.findIndex((layer) => layer.id === selectedId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layers.length) return;
    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];
    setLayers(next);
  };
  const place = (where: 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom' | 'fill') => {
    if (!selected) return;
    if (where === 'fill') return update({ x: 0, y: 0, width: CANVAS.width, height: CANVAS.height });
    if (where === 'left') return update({ x: 0 });
    if (where === 'centre') return update({ x: Math.round((CANVAS.width - selected.width) / 2) });
    if (where === 'right') return update({ x: CANVAS.width - selected.width });
    if (where === 'top') return update({ y: 0 });
    if (where === 'middle') return update({ y: Math.round((CANVAS.height - selected.height) / 2) });
    return update({ y: CANVAS.height - selected.height });
  };

  const numberField = (
    label: string,
    key: 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'radius' | 'padding' | 'focus' | 'slot' | 'fontWeight' | 'rotation' | 'strokeWidth' | 'lineHeight',
    step?: number,
  ) => (
    <Field label={label} htmlFor={`f-${key}`}>
      <Input
        id={`f-${key}`}
        type="number"
        step={step}
        value={String(selected?.[key] ?? '')}
        onChange={(event) => update({ [key]: event.target.value === '' ? undefined : Number(event.target.value) } as Partial<TemplateLayer>)}
      />
    </Field>
  );

  const colourField = (label: string, key: 'colour' | 'stroke' | 'background', fallback: string) => (
    <Field label={label} htmlFor={`f-${key}`}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick the ${label.toLowerCase()}`}
          value={hexOf(selected?.[key], fallback)}
          onChange={(event) => update({ [key]: event.target.value } as Partial<TemplateLayer>)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
        />
        <Input id={`f-${key}`} value={selected?.[key] ?? ''} onChange={(event) => update({ [key]: event.target.value } as Partial<TemplateLayer>)} placeholder={fallback} />
      </div>
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => add('slot')}>
          <ImageIcon className="h-4 w-4" /> Picture
        </Button>
        <Button type="button" variant="outline" onClick={() => add('rect')}>
          <Square className="h-4 w-4" /> Box
        </Button>
        <Button type="button" variant="outline" onClick={() => add('text')}>
          <Type className="h-4 w-4" /> Text
        </Button>
        <Button type="button" variant="outline" onClick={() => add('logo')}>
          Logo
        </Button>
      </div>

      <Field label="Background" htmlFor="f-canvas-bg">
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick the background"
            value={hexOf(design.background, '#0b1220')}
            onChange={(event) => {
              onBeginChange?.();
              onChange({ ...design, background: event.target.value });
            }}
            className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
          />
          <Input
            id="f-canvas-bg"
            value={design.background ?? ''}
            onChange={(event) => {
              onBeginChange?.();
              onChange({ ...design, background: event.target.value });
            }}
            placeholder="#0b1220"
          />
        </div>
      </Field>

      <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-200 p-1">
        {[...layers].reverse().map((layer) => (
          <li key={layer.id}>
            <button
              type="button"
              onClick={() => onSelect(layer.id)}
              className={`w-full truncate rounded px-2 py-1 text-left text-sm ${layer.id === selectedId ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
            >
              {LAYER_NAMES[layer.type]}
              {layer.type === 'slot' ? ` ${(layer.slot ?? 0) + 1}` : ''}
              {layer.type === 'text' ? `: ${layer.text ?? ''}` : ''}
            </button>
          </li>
        ))}
        {!layers.length && <li className="px-2 py-1 text-sm text-slate-500">No layers yet — add a picture place.</li>}
      </ul>

      {selected && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">{LAYER_NAMES[selected.type]}</p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" onClick={() => shift(1)} title="Bring forward">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={() => shift(-1)} title="Send backward">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={duplicate} title="Duplicate">
                <Copy className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={remove} title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                ['left', 'Left edge', 'L'],
                ['centre', 'Middle across', <AlignCenterVertical key="c" className="h-4 w-4" />],
                ['right', 'Right edge', 'R'],
                ['top', 'Top edge', 'T'],
                ['middle', 'Middle down', <AlignCenterHorizontal key="m" className="h-4 w-4" />],
                ['bottom', 'Bottom edge', 'B'],
                ['fill', 'Fill the whole image', 'Fill'],
              ] as const
            ).map(([where, title, label]) => (
              <Button key={where} type="button" variant="outline" onClick={() => place(where)} title={title}>
                {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {numberField('X', 'x')}
            {numberField('Y', 'y')}
            {numberField('Width', 'width')}
            {numberField('Height', 'height')}
          </div>

          <Field label="Kind" htmlFor="f-type" hint="A picture place is filled by ChatGPT; a fixed picture always stays the same.">
            <Select
              id="f-type"
              value={selected.type}
              onChange={(event) => {
                const type = event.target.value as TemplateLayer['type'];
                if (type === 'image' && !selected.src) return;
                update({ type, ...(type === 'slot' && selected.slot === undefined ? { slot: slots } : {}) });
              }}
            >
              <option value="slot">Picture place</option>
              <option value="image" disabled={!selected.src}>
                Fixed picture {selected.src ? '' : '(only for imported pictures)'}
              </option>
              <option value="rect">Colour box</option>
              <option value="text">Text</option>
              <option value="logo">Logo</option>
            </Select>
          </Field>

          {selected.type === 'slot' && (
            <div className="grid grid-cols-2 gap-3">
              {numberField('Picture number', 'slot')}
              <Field label="Fit" htmlFor="f-fit">
                <Select id="f-fit" value={selected.fit ?? 'cover'} onChange={(event) => update({ fit: event.target.value as TemplateLayer['fit'] })}>
                  <option value="cover">Fill the place</option>
                  <option value="contain">Show the whole picture</option>
                  <option value="fill">Stretch to the place</option>
                </Select>
              </Field>
              {numberField('Focus (0 top – 100 bottom)', 'focus')}
            </div>
          )}

          {selected.type === 'image' && (
            <Field label="Fit" htmlFor="f-imgfit">
              <Select id="f-imgfit" value={selected.fit ?? 'fill'} onChange={(event) => update({ fit: event.target.value as TemplateLayer['fit'] })}>
                <option value="fill">Stretch to the place</option>
                <option value="contain">Show the whole picture</option>
                <option value="cover">Fill the place</option>
              </Select>
            </Field>
          )}

          {selected.type === 'rect' && (
            <>
              {colourField('Colour', 'colour', '#0179de')}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Shape" htmlFor="f-shape">
                  <Select id="f-shape" value={selected.shape ?? 'rect'} onChange={(event) => update({ shape: event.target.value as 'rect' | 'circle' })}>
                    <option value="rect">Rectangle</option>
                    <option value="circle">Circle</option>
                  </Select>
                </Field>
                {numberField('Outline width', 'strokeWidth')}
              </div>
              {Boolean(selected.strokeWidth) && colourField('Outline colour', 'stroke', '#000000')}
            </>
          )}

          {selected.type === 'text' && (
            <>
              {colourField('Colour', 'colour', '#ffffff')}
              <Field label="Text" htmlFor="f-text">
                <Input id="f-text" value={selected.text ?? ''} onChange={(event) => update({ text: event.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                {numberField('Font size', 'fontSize')}
                {numberField('Weight (400–900)', 'fontWeight')}
                <Field label="Align" htmlFor="f-align">
                  <Select id="f-align" value={selected.align ?? 'center'} onChange={(event) => update({ align: event.target.value as 'left' | 'center' | 'right' })}>
                    <option value="left">Left</option>
                    <option value="center">Middle</option>
                    <option value="right">Right</option>
                  </Select>
                </Field>
                <Field label="Up and down" htmlFor="f-valign">
                  <Select id="f-valign" value={selected.valign ?? 'middle'} onChange={(event) => update({ valign: event.target.value as 'top' | 'middle' | 'bottom' })}>
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </Select>
                </Field>
              </div>
            </>
          )}

          {selected.type === 'logo' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plate behind the logo" htmlFor="f-bg">
                <Select
                  id="f-bg"
                  value={selected.background === 'none' ? 'none' : 'white'}
                  onChange={(event) => update({ background: event.target.value === 'none' ? 'none' : '#ffffff' })}
                >
                  <option value="white">White</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              {numberField('Padding', 'padding')}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {numberField('Corner radius', 'radius')}
            {numberField('Turn (degrees)', 'rotation')}
            <Field label="See-through" htmlFor="f-opacity" hint="1 = solid">
              <Input
                id="f-opacity"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={String(selected.opacity ?? 1)}
                onChange={(event) => update({ opacity: clamp(Number(event.target.value), 0, 1) })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
