'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

export function Dropdown({ trigger, items, align = 'right' }: { trigger: ReactNode; items: DropdownItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-1 max-h-96 w-60 overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) =>
            item.divider ? (
              <div key={`d-${i}`} className="my-1 border-t border-slate-100" />
            ) : item.href ? (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                onClick={() => setOpen(false)}
                className={cn('flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50', item.danger ? 'text-red-600' : 'text-slate-700', item.disabled && 'pointer-events-none opacity-40')}
              >
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40', item.danger ? 'text-red-600' : 'text-slate-700')}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
