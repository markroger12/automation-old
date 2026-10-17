import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { setInternalLinkLine } from '@/lib/services/internal-links';
import { websiteUpdateSchema } from '@/lib/validation';
import { normalizeAdminUrl } from '@/lib/wp-url';
import { parseDesign } from '@/automation/images/design';

/** The most a saved design may weigh — an imported file can carry its drawings inside it. */
const MAX_DESIGN = 8 * 1024 * 1024;

/**
 * The design from the Image Template editor is read the same way the renderer reads it, so only layers this app can
 * draw — and only pictures that are built into the design or come from a secure address — are ever stored.
 */
function cleanDesigns(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const raw = (value ?? null) as { featured?: unknown; body?: unknown } | null;
  if (!raw || typeof raw !== 'object') return Prisma.DbNull;
  const featured = parseDesign(raw.featured);
  const body = parseDesign(raw.body);
  if (!featured && !body) return Prisma.DbNull;
  const cleaned = { featured, body };
  if (JSON.stringify(cleaned).length > MAX_DESIGN) throw new HttpError(400, 'This design is too large to save — use fewer or smaller drawings in it.');
  return cleaned as unknown as Prisma.InputJsonValue;
}

export const PATCH = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const input = await parseBody(req, websiteUpdateSchema);
  const existing = await prisma.website.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Website not found');

  const data: Prisma.WebsiteUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.url !== undefined) data.url = input.url.replace(/\/+$/, '');
  if (input.url !== undefined || input.adminUrl !== undefined) {
    try {
      data.adminUrl = normalizeAdminUrl(input.url ?? existing.url, input.adminUrl || null);
    } catch {
      throw new HttpError(400, 'Invalid website or admin URL');
    }
  }
  if (input.profileId !== undefined) {
    if (input.profileId) {
      const profile = await prisma.browserProfile.findUnique({ where: { id: input.profileId } });
      if (!profile || profile.kind === 'CHATGPT') throw new HttpError(400, 'Choose a WordPress browser profile');
      data.profile = { connect: { id: profile.id } };
    } else {
      data.profile = { disconnect: true };
    }
  }
  if (input.defaultCategoryId !== undefined) {
    if (input.defaultCategoryId) {
      const category = await prisma.category.findUnique({ where: { id: input.defaultCategoryId } });
      if (!category || category.websiteId !== id) throw new HttpError(400, 'Default category must belong to this website');
    }
    data.defaultCategoryId = input.defaultCategoryId;
  }
  if (input.defaultAuthor !== undefined) data.defaultAuthor = input.defaultAuthor;
  if (input.editorType !== undefined) data.editorType = input.editorType;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.celebrityImages !== undefined) data.celebrityImages = input.celebrityImages;
  if (input.tigramImages !== undefined) data.tigramImages = input.tigramImages;
  if (input.canPublish !== undefined) data.canPublish = input.canPublish;
  if (input.siteTimezone !== undefined) data.siteTimezone = input.siteTimezone;
  if (input.searchConsoleProperty !== undefined) data.searchConsoleProperty = input.searchConsoleProperty;
  if (input.accentColour !== undefined) data.accentColour = input.accentColour;
  if (input.logoPosition !== undefined) data.logoPosition = input.logoPosition;
  if (input.featuredStyle !== undefined) data.featuredStyle = input.featuredStyle;
  if (input.imageTemplate !== undefined) data.imageTemplate = cleanDesigns(input.imageTemplate);

  const website = await prisma.website.update({ where: { id }, data });
  if (input.internalLinkLine !== undefined) await setInternalLinkLine(id, input.internalLinkLine);
  return { website };
});

export const DELETE = route(async (_req, ctx) => {
  const id = await param(ctx, 'id');
  await prisma.website.delete({ where: { id } });
  await setInternalLinkLine(id, null);
  return { ok: true };
});
