'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { useToast } from '@/components/ui/toast';

export type TaskActionBody =
  | { action: 'retry' | 'resume' | 'cancel' | 'approve-article' | 'seo-check' | 'send-to-wordpress' }
  | { action: 'approve-title'; title: string }
  | { action: 'regenerate'; stage: string };

export function useTaskAction(onDone?: () => void) {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (taskId: string, body: TaskActionBody): Promise<boolean> => {
    setPending(`${taskId}:${body.action}`);
    try {
      const res = await apiFetch<{ message: string; warning?: string | null }>(`/api/tasks/${taskId}/actions`, { method: 'POST', body });
      toast.success(res.message);
      if (res.warning) toast.warning('Queue notice', res.warning);
      return true;
    } catch (err) {
      toast.error('Action failed', (err as Error).message);
      return false;
    } finally {
      setPending(null);
      onDone?.();
    }
  };

  const remove = async (taskId: string, keyword: string): Promise<boolean> => {
    if (!window.confirm(`Delete the article task "${keyword}" and all its stages, responses and logs? The WordPress draft is not affected.`)) return false;
    setPending(`${taskId}:delete`);
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      toast.success('Task deleted');
      return true;
    } catch (err) {
      toast.error('Delete failed', (err as Error).message);
      return false;
    } finally {
      setPending(null);
      onDone?.();
    }
  };

  const isPending = (taskId: string, action: string) => pending === `${taskId}:${action}`;
  return { run, remove, isPending, pending };
}
