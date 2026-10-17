import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * SQLite paths in DATABASE_URL are written relative to the prisma/ folder (the Prisma CLI convention,
 * e.g. "file:../data/app.db"). Resolve them the same way at runtime so the web app, the worker and
 * the CLI always open the same database file.
 */
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('file:')) return url;
  const [filePart, query] = url.slice('file:'.length).split('?');
  if (path.isAbsolute(filePart) || /^[A-Za-z]:[\\/]/.test(filePart)) return url;
  const absolute = path.resolve(process.cwd(), 'prisma', filePart).replace(/\\/g, '/');
  return `file:${absolute}${query ? `?${query}` : ''}`;
}

// Reuse a single PrismaClient across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: resolveDatabaseUrl(),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
