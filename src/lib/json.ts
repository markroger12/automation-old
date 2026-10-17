import type { Prisma } from '@prisma/client';

/** Reads a JSON column that stores a list of strings (tags, review reasons, title options…). */
export function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
