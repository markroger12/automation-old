import { prisma } from '@/lib/db';
import { performTaskAction } from '@/lib/services/tasks';
(async () => {
  for (const id of process.argv.slice(2)) console.log(id, JSON.stringify(await performTaskAction(id, { action: 'retry' } as never)));
  await prisma.$disconnect();
})();
