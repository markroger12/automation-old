import { prisma } from '@/lib/db';
import { HttpError, parseBody, route } from '@/lib/api';
import { createBrowserProfile } from '@/lib/services/profiles';
import { profileSchema } from '@/lib/validation';

export const GET = route(async () => {
  // ChatGPT runs through the Chrome extension; only WordPress browser profiles are managed here.
  const profiles = await prisma.browserProfile.findMany({
    where: { kind: { not: 'CHATGPT' } },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      kind: true,
      sessionStatus: true,
      sessionDetail: true,
      lastCheckedAt: true,
      lastLoginAt: true,
      createdAt: true,
      websites: { select: { id: true, name: true } },
    },
  });
  return { profiles };
});

export const POST = route(async (req) => {
  const input = await parseBody(req, profileSchema);
  if (input.kind === 'CHATGPT') {
    throw new HttpError(400, 'ChatGPT runs through the Chrome extension and needs no browser profile');
  }
  const profile = await createBrowserProfile(input.name, input.kind);
  return { profile: { id: profile.id, name: profile.name, kind: profile.kind } };
});
