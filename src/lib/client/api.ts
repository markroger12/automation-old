'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)bas_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function apiFetch<T>(
  url: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.formData ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  let body: BodyInit | undefined;
  if (options.formData) body = options.formData;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}

/** Fetches JSON and optionally re-fetches on an interval while the tab is visible (live progress). */
export function useApi<T>(url: string | null, options: { refreshInterval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const current = urlRef.current;
    if (!current) return;
    try {
      const result = await apiFetch<T>(current);
      if (urlRef.current === current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (urlRef.current === current) setError((err as Error).message);
    } finally {
      if (urlRef.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    void load();
    if (!options.refreshInterval) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, options.refreshInterval);
    return () => clearInterval(timer);
  }, [url, options.refreshInterval, load]);

  return { data, error, loading, reload: load, setData };
}

export interface ControlJobStatus {
  state: string;
  result: { ok: boolean; message: string; loggedIn?: boolean; resumedTasks?: number } | null;
  error: string | null;
}

/** Polls a browser-control job (login window, session test…) until it finishes. */
export async function waitForControlJob(jobId: string, timeoutMs = 240_000): Promise<ControlJobStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await apiFetch<ControlJobStatus>(`/api/control-jobs/${jobId}`);
    if (status.state === 'completed' || status.state === 'failed') return status;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return {
    state: 'timeout',
    result: null,
    error: 'The automation worker did not respond. Make sure the app was started with "npm run dev:all".',
  };
}
