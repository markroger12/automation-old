import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, cookieSecure, safeEqual, verifySessionToken } from '@/lib/auth/session';

// Same as EXTENSION_AGENT_PATH in src/lib/chatgpt-extension.ts (not imported to keep zod out of the edge bundle).
const EXTENSION_AGENT_PATH = '/api/extension/agent';
// '/automation-chrome' is the setup page shown in the automation Chrome (no dashboard login there).
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/setup', '/api/health', '/automation-chrome']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // The ChatGPT Chrome extension has no dashboard cookies; the route checks its connection key instead.
  if (pathname === EXTENSION_AGENT_PATH) return NextResponse.next();

  // CSRF: same-origin check + double-submit token for every state-changing API request.
  if (isApi && !SAFE_METHODS.has(req.method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (origin) {
      try {
        if (new URL(origin).host !== host) return forbidden('Cross-origin request blocked');
      } catch {
        return forbidden('Invalid origin');
      }
    }
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value ?? '';
    const headerToken = req.headers.get(CSRF_HEADER) ?? '';
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return forbidden('Invalid or missing CSRF token. Reload the page and try again.');
    }
  }

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.has(pathname);

  let response: NextResponse;
  if (!session && !isPublic) {
    if (isApi) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    response = NextResponse.redirect(url);
  } else if (session && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next();
  }

  if (!req.cookies.get(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      httpOnly: false, // must be readable by the dashboard's fetch helper
      sameSite: 'strict',
      secure: cookieSecure(),
      path: '/',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
