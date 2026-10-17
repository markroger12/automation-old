'use client';

import { useState } from 'react';
import { Copy, ExternalLink, KeyRound } from 'lucide-react';
import { apiFetch, useApi, waitForControlJob } from '@/lib/client/api';
import type { AppSettings } from '@/lib/settings-schema';
import type { ExtensionStatus } from '@/lib/services/chatgpt-extension';
import { timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

/** Settings card: connection key and live status of the ChatGPT Worker Chrome extension. */
export function ExtensionConnectionCard() {
  const toast = useToast();
  const { data, setData } = useApi<{ status: ExtensionStatus }>('/api/extension', { refreshInterval: 5000 });
  const [key, setKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const settings = useApi<{ settings: AppSettings }>('/api/settings');
  const separate = (settings.data?.settings.chatgptChromeMode ?? 'separate') === 'separate';
  const status = data?.status;

  const openChrome = async () => {
    setOpening(true);
    try {
      const { jobId } = await apiFetch<{ jobId: string }>('/api/extension/chrome', { method: 'POST' });
      const result = await waitForControlJob(jobId);
      if (result.state === 'completed' && result.result?.ok) toast.success('Automation Chrome opened', result.result.message);
      else toast.error('Could not open the automation Chrome', result.result?.message ?? result.error ?? 'Is the worker running?');
    } catch (err) {
      toast.error('Could not open the automation Chrome', (err as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const createKey = async () => {
    if (status?.keyCreatedAt && !window.confirm('Create a new key? The extension stops working until you paste the new key into it.')) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ key: string; status: ExtensionStatus }>('/api/extension', { method: 'POST' });
      setKey(res.key);
      setData({ status: res.status });
    } catch (err) {
      toast.error('Could not create a key', (err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      toast.success('Key copied', 'Paste it into the extension and click "Save & test".');
    } catch {
      toast.error('Could not copy', 'Select the key and copy it with Ctrl+C.');
    }
  };

  const onlineTabs = status?.tabs.filter((t) => t.online) ?? [];
  const needsYou = onlineTabs.filter((t) => t.attention);

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="ChatGPT Chrome extension"
        description={
          separate
            ? 'Runs in a Chrome of its own that keeps working behind other windows: it sends each article prompt to ChatGPT and returns the answer to this app.'
            : 'Runs in your own Chrome profile: it sends each article prompt to ChatGPT and returns the answer to this app.'
        }
      />
      <CardBody className="space-y-4">
        {!!status?.versions?.length && <p className="text-sm text-slate-600">Connected extension version: {status.versions.join(', ')}. Image search requires 1.6.3 or newer.</p>}
        {status && separate && status.online && !status.automationConnected && status.normalChromeConnected && (
          <Alert tone="warning" title="The extension is running in your normal Chrome">
            Articles would make that window jump to the front. Click <b>Open automation Chrome</b> below and follow the steps on the page that opens
            there; once the extension runs in the Automation Chrome, the one in your normal Chrome stays idle (remove it there).
          </Alert>
        )}
        {status && separate && status.automationConnected && (
          <Alert tone="success" title="Running in the Automation Chrome">
            ChatGPT keeps working while that window is behind other windows — it will not jump to the front.
            {status.normalChromeConnected ? ' The extension in your normal Chrome is idle; you can remove it there.' : ''}
          </Alert>
        )}
        {status &&
          (status.online ? (
            <Alert tone={needsYou.length ? 'warning' : 'success'} title={`Connected — ${onlineTabs.length} ChatGPT tab(s)`}>
              {needsYou.length
                ? needsYou.map((t) => <p key={t.id}>{t.attention}</p>)
                : `Last contact ${timeAgo(status.lastSeenAt)}. Prompts waiting: ${status.waitingPrompts}, being answered: ${status.activePrompts}.`}
            </Alert>
          ) : (
            <Alert tone="info" title="Extension not connected">
              {status.lastSeenAt ? `Last contact ${timeAgo(status.lastSeenAt)}. ` : ''}
              {status.waitingPrompts ? `${status.waitingPrompts} prompt(s) are waiting for it. ` : ''}
              It connects by itself when Chrome with the extension is open — the app opens {separate ? 'the automation Chrome' : 'that Chrome profile'} when
              articles are waiting.
            </Alert>
          ))}

        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          {separate ? (
            <li>
              Click <b>Open automation Chrome</b> below. A separate Chrome opens with ChatGPT and <code>chrome://extensions</code>. There, turn on{' '}
              <b>Developer mode</b>, click <b>Load unpacked</b> and choose the <code>extension</code> folder inside this project.
            </li>
          ) : (
            <li>
              In Chrome (for example a profile named “automation”) open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click{' '}
              <b>Load unpacked</b> and choose the <code>extension</code> folder inside this project.
            </li>
          )}
          <li>Log in to ChatGPT in {separate ? 'the automation Chrome' : 'that Chrome profile'} yourself.</li>
          <li>Create a connection key below, open the extension (puzzle icon → Blog Automation Studio), paste the key and click “Save &amp; test”.</li>
          <li>
            That&apos;s it: when articles are queued, the extension opens one ChatGPT tab per article (up to <b>Task Concurrency</b>, Workflow
            above), writes them at the same time and closes each tab once its article&apos;s ChatGPT part is done. No Start button needed.
          </li>
          {separate && (
            <li>
              The automation Chrome can stay behind other windows while it works. Do not minimize it, and keep the computer unlocked. If the extension is
              still installed in your normal Chrome, remove it there — the new connection key switches the old one off anyway.
            </li>
          )}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          {separate && (
            <Button variant="outline" icon={<ExternalLink className="h-4 w-4" />} loading={opening} onClick={openChrome}>
              Open automation Chrome
            </Button>
          )}
          <Button variant="outline" icon={<KeyRound className="h-4 w-4" />} loading={creating} onClick={createKey}>
            {status?.keyCreatedAt ? 'Create new connection key' : 'Create connection key'}
          </Button>
          {status?.keyCreatedAt && !key && <span className="text-xs text-slate-500">Current key created {timeAgo(status.keyCreatedAt)}</span>}
        </div>

        {key && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={key} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={copyKey}>
                Copy
              </Button>
            </div>
            <p className="text-xs text-amber-700">Shown only once — only a fingerprint of the key is stored. Anyone with this key can use your ChatGPT windows through the app.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
