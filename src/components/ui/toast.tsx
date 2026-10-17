'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastApi {
  success(title: string, message?: string): void;
  error(title: string, message?: string): void;
  info(title: string, message?: string): void;
  warning(title: string, message?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((tone: ToastTone, title: string, message?: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-4), { id, tone, title, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === 'error' ? 9000 : 5500);
  }, []);

  const api: ToastApi = {
    success: (t, m) => push('success', t, m),
    error: (t, m) => push('error', t, m),
    info: (t, m) => push('info', t, m),
    warning: (t, m) => push('warning', t, m),
  };

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <XCircle className="h-5 w-5 text-red-500" />,
    info: <Info className="h-5 w-5 text-sky-500" />,
    warning: <TriangleAlert className="h-5 w-5 text-amber-500" />,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200')}>
            <div className="shrink-0">{icons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              {t.message && <p className="mt-0.5 text-sm break-words text-slate-600">{t.message}</p>}
            </div>
            <button type="button" className="shrink-0 text-slate-400 hover:text-slate-600" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
