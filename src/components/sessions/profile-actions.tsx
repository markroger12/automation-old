'use client';

import { useState } from 'react';
import { ExternalLink, LogIn, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch, waitForControlJob } from '@/lib/client/api';
import type { ProfileKind } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export type ProfileAction = 'open-login' | 'open-browser' | 'test-session' | 'refresh-session' | 'reset-session' | 'close-browser' | 'sync-categories';

/** Sends a session-management command to the worker and reports the result as a toast. */
export function useProfileAction(onDone?: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (profileId: string, action: ProfileAction, websiteId?: string | null) => {
    if (action === 'reset-session' && !window.confirm('Delete all saved cookies and login data for this browser profile? You will need to log in again.')) {
      return;
    }
    setBusy(`${profileId}:${action}`);
    try {
      const { jobId } = await apiFetch<{ jobId: string }>(`/api/profiles/${profileId}/actions`, {
        method: 'POST',
        body: { action, websiteId: websiteId ?? null },
      });
      if (action === 'open-login' || action === 'open-browser') toast.info('Opening browser…', 'The window opens on the computer running the worker.');
      const status = await waitForControlJob(jobId);
      if (status.state === 'completed' && status.result) {
        if (status.result.ok) {
          toast.success(
            action === 'test-session' || action === 'refresh-session' ? 'Session active' : action === 'sync-categories' ? 'Categories updated' : 'Done',
            status.result.message,
          );
        } else {
          toast.warning('Action finished', status.result.message);
        }
      } else {
        toast.error('Browser action failed', status.error ?? 'Unknown error');
      }
    } catch (err) {
      toast.error('Browser action failed', (err as Error).message);
    } finally {
      setBusy(null);
      onDone?.();
    }
  };

  return { run, busy };
}

export function ProfileActionButtons({
  profileId,
  kind,
  websiteId,
  onDone,
  compact,
}: {
  profileId: string;
  kind: ProfileKind;
  websiteId?: string | null;
  onDone?: () => void;
  compact?: boolean;
}) {
  const { run, busy } = useProfileAction(onDone);
  const is = (a: ProfileAction) => busy === `${profileId}:${a}`;
  const service = 'WordPress';
  const size = compact ? 'xs' : 'sm';

  return (
    <div className="flex flex-wrap gap-2">
      <Button size={size} variant="primary" icon={<LogIn className="h-3.5 w-3.5" />} loading={is('open-login')} onClick={() => run(profileId, 'open-login', websiteId)}>
        {compact ? 'Login' : `Open ${service} Login Browser`}
      </Button>
      <Button size={size} variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />} loading={is('test-session')} onClick={() => run(profileId, 'test-session', websiteId)}>
        {compact ? 'Test Session' : `Test ${service} Session`}
      </Button>
      <Button size={size} variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={is('refresh-session')} onClick={() => run(profileId, 'refresh-session', websiteId)}>
        Refresh Session
      </Button>
      <Button size={size} variant="outline" icon={<ExternalLink className="h-3.5 w-3.5" />} loading={is('open-browser')} onClick={() => run(profileId, 'open-browser', websiteId)}>
        Open Browser
      </Button>
      <Button
        size={size}
        variant="ghost"
        className="text-red-600 hover:bg-red-50 hover:text-red-700"
        icon={compact ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
        loading={is('reset-session')}
        onClick={() => run(profileId, 'reset-session', websiteId)}
      >
        {compact ? 'Delete Session' : 'Reset Browser Session'}
      </Button>
    </div>
  );
}
