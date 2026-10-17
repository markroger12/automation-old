'use client';

import { LogIn, Puzzle } from 'lucide-react';
import type { ProfileItem } from '@/lib/client/types';
import { Button, LinkButton } from '@/components/ui/button';
import { useProfileAction } from '@/components/sessions/profile-actions';

/** "Reconnect ChatGPT" / "Reconnect WordPress" for tasks waiting on an expired session. */
export function ReconnectButton({
  service,
  websiteId,
  profiles,
  size = 'xs',
}: {
  service: string | null;
  websiteId: string | null;
  profiles: ProfileItem[];
  size?: 'xs' | 'sm';
}) {
  const { run, busy } = useProfileAction();
  if (service === 'chatgpt') {
    // ChatGPT runs in the user's Chrome through the extension: log in there; waiting tasks resume by themselves.
    return (
      <LinkButton href="/settings" size={size} icon={<Puzzle className="h-3.5 w-3.5" />}>
        ChatGPT extension
      </LinkButton>
    );
  }
  const profile = profiles.find((p) => p.websites.some((w) => w.id === websiteId));
  if (!profile) return null;
  const label = 'Reconnect WordPress';
  return (
    <Button
      size={size}
      variant="primary"
      icon={<LogIn className="h-3.5 w-3.5" />}
      loading={busy === `${profile.id}:open-login`}
      onClick={() => run(profile.id, 'open-login', websiteId)}
      title="Opens a Chrome window for the WordPress profile. Log in, close it, then click Test Session (waiting tasks resume automatically)."
    >
      {label}
    </Button>
  );
}
