import { prisma } from '../db';
import { MODULES, getModule } from '@/modules/registry';

/** Creates any prompt templates that do not exist yet (never overwrites user edits). */
export async function ensureDefaultPrompts(): Promise<void> {
  const existing = await prisma.promptTemplate.findMany({ select: { moduleKey: true, key: true } });
  const have = new Set(existing.map((p) => `${p.moduleKey}:${p.key}`));
  const missing = MODULES.flatMap((m) =>
    m.prompts
      .filter((p) => !have.has(`${m.key}:${p.key}`))
      .map((p) => ({ moduleKey: m.key, key: p.key, name: p.name, description: p.description, content: p.defaultContent })),
  );
  if (missing.length) await prisma.promptTemplate.createMany({ data: missing });
}

export async function getPromptContent(moduleKey: string, key: string): Promise<string> {
  const row = await prisma.promptTemplate.findUnique({ where: { moduleKey_key: { moduleKey, key } } });
  if (row) return row.content;
  const def = getModule(moduleKey)?.prompts.find((p) => p.key === key);
  if (!def) throw new Error(`Prompt template ${moduleKey}/${key} is not defined`);
  await prisma.promptTemplate
    .create({ data: { moduleKey, key, name: def.name, description: def.description, content: def.defaultContent } })
    .catch(() => undefined);
  return def.defaultContent;
}

export function defaultPromptContent(moduleKey: string, key: string): string | null {
  return getModule(moduleKey)?.prompts.find((p) => p.key === key)?.defaultContent ?? null;
}
