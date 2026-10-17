import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { ensureDefaultPrompts } from '@/lib/services/prompts';
import { MODULES } from '@/modules/registry';

export const GET = route(async () => {
  await ensureDefaultPrompts();
  const rows = await prisma.promptTemplate.findMany({ orderBy: [{ moduleKey: 'asc' }, { createdAt: 'asc' }] });
  const modules = MODULES.filter((m) => m.prompts.length).map((m) => ({
    key: m.key,
    name: m.name,
    variables: m.variables,
    prompts: m.prompts
      .map((def) => {
        const row = rows.find((r) => r.moduleKey === m.key && r.key === def.key);
        return row
          ? {
              id: row.id,
              key: def.key,
              name: def.name,
              description: def.description,
              content: row.content,
              isDefault: row.content === def.defaultContent,
              updatedAt: row.updatedAt,
            }
          : null;
      })
      .filter(Boolean),
  }));
  return { modules };
});
