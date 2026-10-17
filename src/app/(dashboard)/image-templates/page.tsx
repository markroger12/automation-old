'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileJson, Image as ImageIcon, RefreshCw, Redo2, Trash2, Undo2, Upload } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import type { WebsiteItem } from '@/lib/client/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Toggle } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { CANVAS, DesignCanvas, LayerPanel } from './editor';
import { defaultDesign, type TemplateDesign, type TemplateLayer } from '@/automation/images/design';
import { readPolotno, type PolotnoPage } from '@/automation/images/polotno';

type Designs = { featured: TemplateDesign | null; body: TemplateDesign | null };

type FeaturedStyle = 'split' | 'single';
type LogoPosition = 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';

interface Settings {
  celebrityImages: boolean;
  tigramImages: boolean;
  featuredStyle: FeaturedStyle;
  accentColour: string;
  logoPosition: LogoPosition;
}

interface Preview {
  featured: string;
  body: string;
  accent: string;
  logo: boolean;
}

const settingsOf = (website: WebsiteItem): Settings => ({
  celebrityImages: website.celebrityImages,
  tigramImages: website.tigramImages,
  featuredStyle: website.featuredStyle ?? 'single',
  accentColour: website.accentColour ?? '',
  logoPosition: website.logoPosition ?? 'bottom-right',
});

const savedDesigns = (website: WebsiteItem): Designs => ({
  featured: (website.imageTemplate?.featured as TemplateDesign | undefined) ?? null,
  body: (website.imageTemplate?.body as TemplateDesign | undefined) ?? null,
});

const same = (a: Settings, b: Settings) =>
  a.celebrityImages === b.celebrityImages &&
  a.tigramImages === b.tigramImages &&
  a.featuredStyle === b.featuredStyle && a.accentColour === b.accentColour && a.logoPosition === b.logoPosition;

function TemplateEditor({ website, onSaved }: { website: WebsiteItem; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Settings>(settingsOf(website));
  const [saving, setSaving] = useState(false);
  const [busyLogo, setBusyLogo] = useState(false);
  const [kind, setKind] = useState<'featured' | 'body'>('featured');
  const [designs, setDesigns] = useState<Designs>({ featured: null, body: null });
  const [imported, setImported] = useState<{ name: string; pages: PolotnoPage[] } | null>(null);
  const [designChanged, setDesignChanged] = useState(false);
  // Undo and redo: every change puts the design it replaces on the stack.
  const history = useRef<{ past: Designs[]; future: Designs[]; at: number }>({ past: [], future: [], at: 0 });
  /** What is on the canvas right now, readable outside React's own updates (the history and the preview use it). */
  const current = useRef<Designs>({ featured: null, body: null });
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    setForm(settingsOf(website));
    setDesigns(savedDesigns(website));
    setSelectedLayer(null);
    setImported(null);
    setDesignChanged(false);
    history.current = { past: [], future: [], at: 0 };
  }, [website]);

  /**
   * Remembers the design as it is now, so it can be brought back. Changes that follow each other quickly (typing in a
   * field, dragging a layer) count as one step.
   */
  const remember = useCallback(() => {
    const now = Date.now();
    const state = history.current;
    if (now - state.at < 500) {
      state.at = now;
      return;
    }
    state.past = [...state.past.slice(-49), current.current];
    state.future = [];
    state.at = now;
  }, []);

  const step = (direction: 'undo' | 'redo') => {
    const state = history.current;
    const from = direction === 'undo' ? state.past : state.future;
    if (!from.length) return;
    const previous = from[from.length - 1];
    if (direction === 'undo') {
      state.past = state.past.slice(0, -1);
      state.future = [...state.future, current.current];
    } else {
      state.future = state.future.slice(0, -1);
      state.past = [...state.past, current.current];
    }
    state.at = 0;
    setDesignChanged(true);
    setDesigns(previous);
    setSelectedLayer(null);
  };

  /** A change made in the editor: the design is kept for undo and the preview is marked as out of date. */
  const changeDesign = useCallback((next: (current: Designs) => Designs) => {
    setDesignChanged(true);
    setDesigns(next);
  }, []);

  // A change in the editor counts as much as a change of the settings on the left.
  const unchanged = same(form, settingsOf(website)) && JSON.stringify(designs) === JSON.stringify(savedDesigns(website));

  current.current = designs;
  const design = designs[kind];
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;

  const refreshPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    setDesignChanged(false);
    const { featured, body } = current.current;
    try {
      const data = await apiFetch<{ preview: Preview }>(`/api/websites/${website.id}/template-preview`, {
        method: 'POST',
        body: {
          accentColour: form.accentColour || null,
          logoPosition: form.logoPosition,
          featuredStyle: form.featuredStyle,
          design: featured || body ? { featured, body } : null,
        },
      });
      setPreview(data.preview);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }, [website.id, form.accentColour, form.logoPosition, form.featuredStyle]);

  // A preview is rendered by the same browser that builds the real images, so it takes seconds. It follows the
  // settings on its own; a change in the editor waits for the Preview button, or dragging a layer would start one
  // render after another.
  useEffect(() => {
    const timer = setTimeout(() => void refreshPreview(), 400);
    return () => clearTimeout(timer);
  }, [refreshPreview]);

  /** Reads a design file exported from Polotno and keeps its pages ready to be used. */
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('The file is larger than 12 MB — export it with fewer built-in pictures.');
      const parsed = readPolotno(JSON.parse(await file.text()));
      setImported({ name: file.name, pages: parsed.pages });
      // One page goes straight in; with several the user picks.
      if (parsed.pages.length === 1) usePage(parsed.pages[0]);
      else toast.success('File read', `${parsed.pages.length} pages — choose which one to use.`);
    } catch (err) {
      toast.error('This file could not be used', (err as Error).message);
    }
  };

  /** Puts a place for a created picture under everything else, which is what an imported frame usually needs. */
  const addPictureBehind = () => {
    remember();
    changeDesign((old) => {
      const open = old[kind];
      if (!open) return old;
      const slot = open.layers.filter((layer) => layer.type === 'slot').length;
      const layer: TemplateLayer = { id: `slot-${Math.random().toString(36).slice(2, 8)}`, type: 'slot', slot, fit: 'cover', focus: 50, x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
      return { ...old, [kind]: { ...open, layers: [layer, ...open.layers] } };
    });
  };

  const usePage = (page: PolotnoPage) => {
    remember();
    changeDesign((old) => ({ ...old, [kind]: page.design }));
    setSelectedLayer(null);
    toast.success(
      `Page ${page.number} is now the ${kind === 'featured' ? 'featured image' : 'picture in the text'}`,
      page.slots ? `${page.slots} picture place(s) found.` : 'No picture place in it — add one so ChatGPT has somewhere to put a picture.',
    );
  };

  // Keyboard: arrows nudge the selected layer, Delete removes it, Ctrl+Z and Ctrl+Y step through the changes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        step(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        step('redo');
        return;
      }
      if (!selectedLayer || !current.current[kind]) return;
      if (event.key === 'Escape') return setSelectedLayer(null);
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = nudge[event.key];
      if (move) {
        event.preventDefault();
        const size = event.shiftKey ? 10 : 1;
        remember();
        changeDesign((old) => {
          const open = old[kind];
          if (!open) return old;
          return {
            ...old,
            [kind]: { ...open, layers: open.layers.map((layer) => (layer.id === selectedLayer ? { ...layer, x: layer.x + move[0] * size, y: layer.y + move[1] * size } : layer)) },
          };
        });
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remember();
        changeDesign((old) => {
          const open = old[kind];
          if (!open) return old;
          return { ...old, [kind]: { ...open, layers: open.layers.filter((layer) => layer.id !== selectedLayer) } };
        });
        setSelectedLayer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/websites/${website.id}`, {
        method: 'PATCH',
        body: {
          celebrityImages: form.celebrityImages,
          tigramImages: form.tigramImages,
          featuredStyle: form.featuredStyle,
          accentColour: form.accentColour.trim() || null,
          logoPosition: form.logoPosition,
          imageTemplate: designs.featured || designs.body ? { featured: designs.featured, body: designs.body } : null,
        },
      });
      toast.success('Template saved', `New articles of ${website.name} use it.`);
      onSaved();
    } catch (err) {
      toast.error('Could not save the template', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setBusyLogo(true);
    try {
      const body = new FormData();
      body.append('logo', file);
      await apiFetch(`/api/websites/${website.id}/logo`, { method: 'POST', formData: body });
      toast.success('Logo saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save the logo', (err as Error).message);
    } finally {
      setBusyLogo(false);
    }
  };

  const removeLogo = async () => {
    setBusyLogo(true);
    try {
      await apiFetch(`/api/websites/${website.id}/logo`, { method: 'DELETE' });
      toast.success('Logo removed');
      onSaved();
    } catch (err) {
      toast.error('Could not remove the logo', (err as Error).message);
    } finally {
      setBusyLogo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <Toggle
            checked={form.celebrityImages}
            onChange={(value) => set('celebrityImages', value)}
            label="Create images for celebrity articles"
            description="Off: its celebrity articles are written without any images."
          />
          <Toggle
            checked={form.tigramImages}
            onChange={(value) => set('tigramImages', value)}
            label="Create images for Tigram articles"
            description="Off: its Tigram articles are written without any images."
          />
        </div>
        <Field label="Featured image" htmlFor="t-style" hint="Two pictures: the line and the logo sit between them.">
          <Select id="t-style" value={form.featuredStyle} onChange={(e) => set('featuredStyle', e.target.value as FeaturedStyle)}>
            <option value="single">One picture, logo in a corner</option>
            <option value="split">Two pictures with the line between them</option>
          </Select>
        </Field>
        <Field label="Logo" htmlFor="t-logo" hint="PNG with a transparent background works best. It sits on the images, 226 px high.">
          <div className="space-y-3">
            {website.logoFile ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/websites/${website.id}/logo/file?v=${encodeURIComponent(website.logoFile)}`}
                alt=""
                className="h-14 w-auto rounded border border-slate-200 bg-white p-1"
              />
            ) : (
              <p className="text-sm text-slate-500">No logo yet — the images stay without one.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
                <Upload className="h-4 w-4" />
                {website.logoFile ? 'Replace logo' : 'Upload logo'}
                <input
                  id="t-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  disabled={busyLogo}
                  onChange={(e) => void uploadLogo(e.target.files?.[0])}
                />
              </label>
              {website.logoFile && (
                <Button type="button" variant="outline" onClick={() => void removeLogo()} loading={busyLogo}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              )}
            </div>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Line colour" htmlFor="t-accent" hint="Empty: taken from the logo.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick the line colour"
                value={/^#[0-9a-fA-F]{6}$/.test(form.accentColour) ? form.accentColour : (preview?.accent.startsWith('#') ? preview.accent : '#0179de')}
                onChange={(e) => set('accentColour', e.target.value)}
                className="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              />
              <Input id="t-accent" value={form.accentColour} onChange={(e) => set('accentColour', e.target.value)} placeholder="#0179DE" />
            </div>
          </Field>
          <Field label="Logo place" htmlFor="t-place" hint="Used when one picture fills the image.">
            <Select id="t-place" value={form.logoPosition} onChange={(e) => set('logoPosition', e.target.value as LogoPosition)}>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-center">Bottom middle</option>
              <option value="top-right">Top right</option>
              <option value="top-left">Top left</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} loading={saving} disabled={unchanged}>
            Save template
          </Button>
          <Button variant={designChanged ? 'primary' : 'outline'} onClick={() => void refreshPreview()} loading={previewing}>
            <RefreshCw className="h-4 w-4" /> {designChanged ? 'Preview the new design' : 'Preview'}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Featured image <span className="font-normal text-slate-500">1920 × 1080</span>
            </p>
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {previewing && !preview && (
                <div className="flex h-48 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.featured} alt="How the featured image will look" className={previewing ? 'w-full opacity-60' : 'w-full'} />
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Picture in the text <span className="font-normal text-slate-500">1920 × 1080</span>
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.body} alt="How a picture inside the article will look" className={previewing ? 'w-full opacity-60' : 'w-full'} />
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          The pictures above are stand-ins. Real articles use what ChatGPT creates, in exactly this template.
          {preview && !preview.logo && ' Upload a logo to see it on the images.'}
        </p>
      </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
              {(['featured', 'body'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setKind(value);
                    setSelectedLayer(null);
                  }}
                  className={`rounded-md px-3 py-1 text-sm ${kind === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {value === 'featured' ? 'Featured image' : 'Picture in the text'}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => step('undo')} disabled={!canUndo} title="Undo (Ctrl+Z)">
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" onClick={() => step('redo')} disabled={!canRedo} title="Redo (Ctrl+Y)">
                <Redo2 className="h-4 w-4" />
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
                <FileJson className="h-4 w-4" />
                Import design file
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  remember();
                  changeDesign((old) => ({
                    ...old,
                    [kind]: defaultDesign(kind, {
                      split: form.featuredStyle === 'split',
                      accent: /^#[0-9a-fA-F]{6}$/.test(form.accentColour) ? form.accentColour : '#0179DE',
                      logoPosition: form.logoPosition,
                      dividerWidth: 28,
                      logoHeight: 226,
                    }),
                  }));
                }}
              >
                Start from the standard look
              </Button>
              {design && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    remember();
                    changeDesign((old) => ({ ...old, [kind]: null }));
                    setSelectedLayer(null);
                  }}
                >
                  Back to automatic
                </Button>
              )}
            </div>
          </div>

          {imported && imported.pages.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
              <p className="text-sm text-slate-700">
                <span className="font-medium">{imported.name}</span> — which page goes into the{' '}
                {kind === 'featured' ? 'featured image' : 'picture in the text'}?
              </p>
              {imported.pages.map((page) => (
                <Button key={page.number} type="button" variant="outline" onClick={() => usePage(page)}>
                  Page {page.number}
                  {page.slots ? ` · ${page.slots} picture${page.slots > 1 ? 's' : ''}` : ''}
                </Button>
              ))}
              <Button type="button" variant="ghost" onClick={() => setImported(null)}>
                Close
              </Button>
            </div>
          )}
          {design && !design.layers.some((layer) => layer.type === 'slot') && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span>This design has no place for a created picture, so every article would get the same image.</span>
              <Button type="button" variant="outline" onClick={addPictureBehind}>
                Add a picture place behind the drawing
              </Button>
            </div>
          )}
          {imported?.pages.some((page) => page.notes.length) && (
            <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-slate-500">
              {[...new Set(imported.pages.flatMap((page) => page.notes))].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {design ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
              <div className="min-w-0">
                <DesignCanvas
                  design={design}
                  logoUrl={website.logoFile ? `/api/websites/${website.id}/logo/file?v=${encodeURIComponent(website.logoFile)}` : null}
                  selectedId={selectedLayer}
                  onSelect={setSelectedLayer}
                  onBeginChange={remember}
                  onChange={(layers) => changeDesign((old) => ({ ...old, [kind]: { ...design, layers } }))}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Canvas {CANVAS.width} × {CANVAS.height}. Arrow keys move by one pixel (with Shift by ten), Delete removes a layer, Ctrl+Z undoes.
                </p>
              </div>
              <LayerPanel
                design={design}
                selectedId={selectedLayer}
                onSelect={setSelectedLayer}
                onBeginChange={remember}
                onChange={(next) => changeDesign((old) => ({ ...old, [kind]: next }))}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              This website uses the automatic look from the settings on the left. Press <em>Start from the standard look</em> to open it in the
              editor and change anything you want.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

export default function ImageTemplatesPage() {
  const { data, loading, error, reload } = useApi<{ websites: WebsiteItem[] }>('/api/websites');
  const websites = data?.websites ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = websites.find((website) => website.id === selectedId) ?? websites[0] ?? null;

  useEffect(() => {
    if (!selectedId && websites.length) setSelectedId(websites[0].id);
  }, [selectedId, websites]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Image Template"
        description="How the article images of each website look: the logo, the line between two pictures and the shape of the featured image."
      />
      {loading && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}
      {!loading && !websites.length && (
        <EmptyState icon={<ImageIcon className="h-6 w-6" />} title="No websites yet" description="Add a website first, then its image template can be set up here." />
      )}
      {websites.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <nav className="space-y-1">
            {websites.map((website) => (
              <button
                key={website.id}
                type="button"
                onClick={() => setSelectedId(website.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  selected?.id === website.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">{website.name}</span>
                {!website.celebrityImages && !website.tigramImages ? (
                  <Badge tone="gray">off</Badge>
                ) : !website.celebrityImages ? (
                  <Badge tone="gray">Tigram only</Badge>
                ) : !website.tigramImages ? (
                  <Badge tone="gray">celebrity only</Badge>
                ) : null}
              </button>
            ))}
          </nav>
          {selected && (
            <Card>
              <CardHeader title={selected.name} description={selected.url} />
              <CardBody>
                <TemplateEditor website={selected} onSaved={() => void reload()} />
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
