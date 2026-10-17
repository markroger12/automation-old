import 'dotenv/config';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_SETTINGS } from '../src/lib/settings-schema';
import { prisma } from '../src/lib/db';
import { MODULES } from '../src/modules/registry';

async function main() {
  // WAL mode lets the dashboard read while the worker writes (stored in the database file).
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (email && password) {
    if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters');
    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`✓ Admin user ${email} already exists (password unchanged — use "npm run user:create" to reset it)`);
    } else {
      await prisma.user.create({ data: { email, passwordHash, name: 'Administrator', role: 'ADMIN' } });
      console.log(`✓ Created admin user ${email}`);
    }
  } else {
    console.log('✓ No ADMIN_EMAIL in .env — you will create the admin account on the first visit to the dashboard');
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: {} });
  }
  console.log('✓ Default settings ensured');

  let created = 0;
  for (const module of MODULES) {
    for (const prompt of module.prompts) {
      const exists = await prisma.promptTemplate.findUnique({ where: { moduleKey_key: { moduleKey: module.key, key: prompt.key } } });
      if (exists) continue;
      await prisma.promptTemplate.create({
        data: { moduleKey: module.key, key: prompt.key, name: prompt.name, description: prompt.description, content: prompt.defaultContent },
      });
      created++;
    }
  }
  console.log(`✓ Prompt templates ensured (${created} created)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
