import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/api';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, cookieSecure, createSessionToken } from '@/lib/auth/session';
import { loginSchema } from '@/lib/validation';

// Simple in-memory brute-force protection (per server instance).
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

function clientKey(req: NextRequest, email: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  return `${ip}:${email}`;
}

// A real bcrypt hash compared against when the user does not exist, keeping response timing similar.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

export async function POST(req: NextRequest) {
  try {
    const body = loginSchema.parse(await req.json().catch(() => ({})));
    const key = clientKey(req, body.email);
    const now = Date.now();
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
      throw new HttpError(429, 'Too many login attempts. Try again in 15 minutes.');
    }

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !valid) {
      const next = entry && entry.resetAt > now ? { count: entry.count + 1, resetAt: entry.resetAt } : { count: 1, resetAt: now + WINDOW_MS };
      attempts.set(key, next);
      throw new HttpError(401, 'Invalid email or password');
    }
    attempts.delete(key);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await createSessionToken({ userId: user.id, email: user.email, role: user.role });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure(),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
