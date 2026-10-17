import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/api';
import { hashPassword } from '@/lib/auth/password';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, cookieSecure, createSessionToken } from '@/lib/auth/session';
import { setupSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** First run: tells the login page whether an administrator account still has to be created. */
export async function GET() {
  try {
    return NextResponse.json({ needsSetup: (await prisma.user.count()) === 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Creates the first administrator. Only allowed while no user exists yet. */
export async function POST(req: NextRequest) {
  try {
    const input = setupSchema.parse(await req.json().catch(() => ({})));
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new HttpError(403, 'An administrator account already exists. Please sign in.');
      return tx.user.create({ data: { email: input.email, name: input.name ?? null, passwordHash, role: 'ADMIN', lastLoginAt: new Date() } });
    });

    const token = await createSessionToken({ userId: user.id, email: user.email, role: user.role });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure(), path: '/', maxAge: SESSION_TTL_SECONDS });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
