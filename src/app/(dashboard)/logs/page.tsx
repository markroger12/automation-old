'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { LogItem } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select, Toggle } from '@/components/ui/form';
import { LogList } from '@/components/logs/log-list';

const CATEGORIES = ['SYSTEM', 'QUEUE', 'SESSION', 'BROWSER', 'CHATGPT', 'WORDPRESS', 'RANKMATH', 'SEO'];

export default function LogsPage() {
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [taskId, setTaskId] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ limit: '100', ...extra });
    if (level) p.set('level', level);
    if (category) p.set('category', category);
    if (taskId.trim()) p.set('taskId', taskId.trim());
    if (debouncedQ) p.set('q', debouncedQ);
    return `/api/logs?${p}`;
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch<{ logs: LogItem[]; nextCursor: string | null }>(query());
        if (cancelled) return;
        setLogs(res.logs);
        setCursor(res.nextCursor);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = live ? setInterval(() => document.visibilityState === 'visible' && void load(), 5000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, category, taskId, debouncedQ, live]);

  const loadMore = async () => {
    if (!cursor) return;
    const res = await apiFetch<{ logs: LogItem[]; nextCursor: string | null }>(query({ cursor }));
    setLogs((prev) => [...prev, ...res.logs]);
    setCursor(res.nextCursor);
    setLive(false);
  };

  return (
    <>
      <PageHeader title="Logs" description="Detailed task logs: stages, prompts, ChatGPT responses, browser actions, retries, errors, Rank Math scores and screenshots. Credentials are never logged." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <Input className="lg:max-w-xs" placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="lg:max-w-[150px]" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All levels</option>
            {['DEBUG', 'INFO', 'WARN', 'ERROR'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
          <Select className="lg:max-w-[170px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Input className="lg:max-w-[220px]" placeholder="Task ID" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
          <div className="lg:ml-auto">
            <Toggle checked={live} onChange={setLive} label="Live" />
          </div>
        </div>
        {loading && !logs.length ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner />
          </div>
        ) : (
          <LogList logs={logs} />
        )}
        {cursor && (
          <div className="flex justify-center border-t border-slate-100 p-3">
            <Button variant="outline" size="sm" onClick={loadMore}>
              Load older entries
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
