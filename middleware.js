// Supabase Auth middleware: refreshes the GoTrue session cookie on every
// page navigation and redirects unauthenticated users to /login. API routes
// are excluded here — they enforce auth themselves via requireUser() (401),
// which lets API clients see a machine-readable error instead of an HTML
// redirect. In AUTH_MODE=demo this middleware is a no-op.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PROTECTED_PREFIXES = ['/', '/jobs', '/search', '/candidates', '/assessments', '/analytics', '/settings'];

export async function middleware(request) {
  const authMode = process.env.AUTH_MODE === 'supabase';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) =>
    p === '/' ? pathname === '/' : pathname.startsWith(p)
  );

  if (!authMode || !url || !key) {
    // Demo mode: nothing to verify. If someone hits /login anyway, send them home.
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  // No Supabase session cookie → there is nothing for GoTrue to validate, so
  // skip the getUser() network round-trip entirely. This makes anonymous
  // /login, /signup and blocked-page hits as cheap as possible on the Workers
  // CPU budget. With a cookie present the full check below runs unchanged
  // (it is also what refreshes an expired access token via the refresh token).
  const hasSessionCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-'));

  if (!hasSessionCookie) {
    if (isProtected) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() round-trips to GoTrue — a forged cookie does not pass.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  // Everything except API routes, static assets and Next internals — API
  // handlers do their own requireUser() check.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
