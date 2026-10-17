import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from './auth/session';
import { HttpError } from './http-error';

export { HttpError };

type RouteContext = { params: Promise<Record<string, string | string[]>> };

type Handler = (req: NextRequest, ctx: RouteContext, session: SessionPayload) => Promise<unknown>;

/**
 * Wraps a route handler with authentication (defence in depth — middleware also checks),
 * consistent JSON error responses and safe error messages.
 */
export function route(handler: Handler) {
  return async (req: NextRequest, ctx: RouteContext): Promise<Response> => {
    try {
      const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      const result = await handler(req, ctx, session);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: err.issues[0]?.message ?? 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (err.code === 'P2002') return NextResponse.json({ error: 'A record with these values already exists' }, { status: 409 });
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error('[api] database unavailable:', err.message);
    return NextResponse.json({ error: 'The database file could not be opened. Run "npm run setup" and restart the app.' }, { status: 503 });
  }
  const message = (err as Error)?.message ?? 'Unknown error';
  console.error('[api] unhandled error:', err);
  if (/database is locked|SQLITE_BUSY/i.test(message)) {
    return NextResponse.json({ error: 'The database is busy. Please try again in a moment.' }, { status: 503 });
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  return schema.parse(json);
}

export async function param(ctx: RouteContext, name: string): Promise<string> {
  const params = await ctx.params;
  const value = params[name];
  const str = Array.isArray(value) ? value.join('/') : value;
  if (!str || str.length > 200) throw new HttpError(400, `Invalid parameter: ${name}`);
  return str;
}

export function notFound(what = 'Record'): never {
  throw new HttpError(404, `${what} not found`);
}
