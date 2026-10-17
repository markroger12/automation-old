import { z } from 'zod';
import { prisma } from '@/lib/db';
import { HttpError, param, parseBody, route } from '@/lib/api';
import { templatePreview } from '@/lib/services/template-preview';

const previewSchema = z.object({
  accentColour: z
    .union([z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0179DE'), z.literal('')])
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  logoPosition: z.enum(['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'top-left']).optional().nullable(),
  featuredStyle: z.enum(['split', 'single']).optional().nullable(),
  /** The design being edited, straight from the editor. */
  design: z.unknown().optional().nullable(),
});

/** Renders how this website's article images look with the settings the user is trying out. */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const website = await prisma.website.findUnique({ where: { id } });
  if (!website) throw new HttpError(404, 'Website not found');
  const settings = await parseBody(req, previewSchema);
  return { preview: await templatePreview(website, { ...settings, design: (settings.design ?? null) as { featured?: unknown; body?: unknown } | null }) };
});
