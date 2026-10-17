// Create a dashboard user or reset an existing user's password.
// Usage: npm run user:create -- you@example.com "a-strong-password"
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db';

async function main() {
  const [emailArg, password] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  if (!email || !password) {
    console.error('Usage: npm run user:create -- <email> <password>');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, role: 'ADMIN' },
    update: { passwordHash },
  });
  console.log(`✓ User ${user.email} is ready`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
