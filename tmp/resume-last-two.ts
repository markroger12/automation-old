import 'dotenv/config';
import { performTaskAction } from '../src/lib/services/tasks';
import { prisma } from '../src/lib/db';

async function main() {
  for (const id of ['cmug4i71t001yuagw8cn4jaq1', 'cmug56nnj002kuagwzs3hl7dn']) {
    console.log(JSON.stringify({ id, ...await performTaskAction(id, { action: 'resume' }) }));
  }
}
main().finally(() => prisma.$disconnect()).catch((err) => { console.error(err.message); process.exitCode = 1; });
