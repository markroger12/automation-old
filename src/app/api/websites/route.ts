import { prisma } from '@/lib/db';
import { HttpError, parseBody, route } from '@/lib/api';
import { getInternalLinkLines, setInternalLinkLine } from '@/lib/services/internal-links';
import { enqueueControlJob } from '@/lib/queue';
import { createBrowserProfile } from '@/lib/services/profiles';
import { websiteSchema } from '@/lib/validation';
import { normalizeAdminUrl } from '@/lib/wp-url';

export const GET = route(async () => {
  const websites = await prisma.website.findMany({
    orderBy: { name: 'asc' },
    include: {
      categories: { orderBy: { name: 'asc' } },
      profile: { select: { id: true, name: true, kind: true, sessionStatus: true, sessionDetail: true, lastCheckedAt: true } },
      _count: { select: { tasks: true } },
    },
  });
  const lines = await getInternalLinkLines();
  return { websites: websites.map((w) => ({ ...w, internalLinkLine: lines[w.id] ?? '' })) };
});

export const POST = route(async (req) => {
  const input = await parseBody(req, websiteSchema);
  let adminUrl: string;
  try {
    adminUrl = normalizeAdminUrl(input.url, input.adminUrl || null);
  } catch {
    throw new HttpError(400, 'Invalid website or admin URL');
  }

  let profileId = input.profileId;
  if (profileId) {
    const profile = await prisma.browserProfile.findUnique({ where: { id: profileId } });
    if (!profile || profile.kind === 'CHATGPT') throw new HttpError(400, 'Choose a WordPress browser profile');
  } else if (input.createProfile) {
    profileId = (await createBrowserProfile(`${input.name} Profile`, 'WORDPRESS')).id;
  }

  const website = await prisma.website.create({
    data: {
      name: input.name,
      url: input.url.replace(/\/+$/, ''),
      adminUrl,
      profileId,
      defaultAuthor: input.defaultAuthor,
      editorType: input.editorType,
      isActive: input.isActive,
      celebrityImages: input.celebrityImages,
      tigramImages: input.tigramImages,
      canPublish: input.canPublish,
      siteTimezone: input.siteTimezone,
      searchConsoleProperty: input.searchConsoleProperty,
      accentColour: input.accentColour,
      logoPosition: input.logoPosition,
      featuredStyle: input.featuredStyle,
    },
  });
  if (input.internalLinkLine) await setInternalLinkLine(website.id, input.internalLinkLine);
  // The categories are read from WordPress: now if the profile is already logged in, otherwise after "Test Session".
  if (profileId) {
    const profile = await prisma.browserProfile.findUnique({ where: { id: profileId }, select: { sessionStatus: true } });
    if (profile?.sessionStatus === 'ACTIVE') await enqueueControlJob({ action: 'sync-categories', profileId, websiteId: website.id });
  }
  return { website };
});
