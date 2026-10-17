'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bold, Code2, Eraser, Heading2, Heading3, Italic, Pilcrow, Redo2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RichTextEditorHandle {
  getHtml(): string;
  setHtml(html: string): void;
}

/**
 * Lightweight WYSIWYG editor (contentEditable) with an HTML source view.
 * Output is sanitized on the server when saved.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, { initialHtml: string; onChange?: (html: string) => void; minHeight?: number }>(
  function RichTextEditor({ initialHtml, onChange, minHeight = 420 }, ref) {
    const [mode, setMode] = useState<'visual' | 'html'>('visual');
    const htmlRef = useRef(initialHtml);
    const visualRef = useRef<HTMLDivElement>(null);
    const [source, setSource] = useState(initialHtml);

    useEffect(() => {
      if (visualRef.current) visualRef.current.innerHTML = initialHtml;
      // Only on mount — afterwards the DOM is the source of truth.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      getHtml: () => (mode === 'visual' && visualRef.current ? visualRef.current.innerHTML : htmlRef.current),
      setHtml: (html: string) => {
        htmlRef.current = html;
        setSource(html);
        if (visualRef.current) visualRef.current.innerHTML = html;
        onChange?.(html);
      },
    }));

    const exec = (command: string, value?: string) => {
      visualRef.current?.focus();
      document.execCommand(command, false, value);
      if (visualRef.current) {
        htmlRef.current = visualRef.current.innerHTML;
        onChange?.(htmlRef.current);
      }
    };

    const switchMode = (next: 'visual' | 'html') => {
      if (next === mode) return;
      if (next === 'html') {
        htmlRef.current = visualRef.current?.innerHTML ?? htmlRef.current;
        setSource(htmlRef.current);
      } else if (visualRef.current) {
        visualRef.current.innerHTML = htmlRef.current;
      }
      setMode(next);
    };

    const tool = (label: string, icon: React.ReactNode, onClick: () => void) => (
      <button
        type="button"
        title={label}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={mode !== 'visual'}
        className="rounded-md p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30"
      >
        {icon}
      </button>
    );

    return (
      <div className="overflow-hidden rounded-xl ring-1 ring-slate-300">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          {tool('Paragraph', <Pilcrow className="h-4 w-4" />, () => exec('formatBlock', 'p'))}
          {tool('Heading 2', <Heading2 className="h-4 w-4" />, () => exec('formatBlock', 'h2'))}
          {tool('Heading 3', <Heading3 className="h-4 w-4" />, () => exec('formatBlock', 'h3'))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {tool('Bold', <Bold className="h-4 w-4" />, () => exec('bold'))}
          {tool('Italic', <Italic className="h-4 w-4" />, () => exec('italic'))}
          {tool('Clear formatting', <Eraser className="h-4 w-4" />, () => exec('removeFormat'))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {tool('Undo', <Undo2 className="h-4 w-4" />, () => exec('undo'))}
          {tool('Redo', <Redo2 className="h-4 w-4" />, () => exec('redo'))}
          <div className="ml-auto flex rounded-lg bg-slate-200/70 p-0.5 text-xs font-medium">
            {(['visual', 'html'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={cn('flex items-center gap-1 rounded-md px-2.5 py-1', mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600')}
              >
                {m === 'html' && <Code2 className="h-3.5 w-3.5" />}
                {m === 'visual' ? 'Visual' : 'HTML'}
              </button>
            ))}
          </div>
        </div>
        <div
          ref={visualRef}
          contentEditable
          suppressContentEditableWarning
          className={cn('article-content scrollbar-thin overflow-y-auto bg-white px-6 py-4', mode !== 'visual' && 'hidden')}
          style={{ minHeight, maxHeight: 720 }}
          onInput={() => {
            htmlRef.current = visualRef.current?.innerHTML ?? '';
            onChange?.(htmlRef.current);
          }}
        />
        {mode === 'html' && (
          <textarea
            value={source}
            spellCheck={false}
            onChange={(e) => {
              setSource(e.target.value);
              htmlRef.current = e.target.value;
              onChange?.(e.target.value);
            }}
            className="block w-full resize-y border-0 bg-slate-900 p-4 font-mono text-xs leading-5 text-slate-100 focus:ring-0"
            style={{ minHeight }}
          />
        )}
      </div>
    );
  },
);
