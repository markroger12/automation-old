import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { DEFAULT_SETTINGS, settingsSchema, type AppSettings } from './settings-schema';

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) raw[row.key] = row.value;
  const parsed = settingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A stored value became invalid (e.g. after an upgrade) — fall back per key.
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    const candidate = { ...merged, [row.key]: row.value };
    if (settingsSchema.safeParse(candidate).success) merged[row.key] = row.value;
  }
  return settingsSchema.parse(merged);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch });
  const keys = Object.keys(patch) as (keyof AppSettings)[];
  await prisma.$transaction(
    keys.map((key) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: next[key] as Prisma.InputJsonValue },
        update: { value: next[key] as Prisma.InputJsonValue },
      }),
    ),
  );
  return next;
}
