// Edge-compatible session helpers (used by middleware and route handlers).
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'bas_session';
export const CSRF_COOKIE = 'bas_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  userId: string;
  email: string;
  role: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters long');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    return { userId: payload.sub, email: payload.email, role: String(payload.role ?? 'ADMIN') };
  } catch {
    return null;
  }
}

export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

/** Length-constant string comparison for tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
