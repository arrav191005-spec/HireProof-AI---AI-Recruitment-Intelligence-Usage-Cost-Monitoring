// Supabase Auth middleware: refreshes the GoTrue session cookie on every
// page navigation and redirects unauthenticated users to /login. API routes
// are excluded here — they enforce auth themselves via requireUser() (401),
// which lets API clients see a machine-readable error instead of an HTML
// redirect. In AUTH_MODE=demo this middleware is a no-op.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  responseCacheVariant,
  responseCacheKey,
  cacheVersionFromCookies,
} from '@/lib/response-cache';

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

  // Read the session locally (no network), then try the response cache before
  // paying for GoTrue. A cached entry is keyed by a hash of the exact access
  // token, so it can only be hit by a token that was verified when the entry
  // was written. Nothing is rendered or served on a hit unless that holds.
  const { data: { session } } = await supabase.auth.getSession();
  const sessionUsable = Boolean(
    session?.user && session.access_token &&
    (!session.expires_at || session.expires_at * 1000 > Date.now())
  );
  const cacheVariant = sessionUsable
    ? responseCacheVariant(request.method, pathname, (name) => request.headers.get(name))
    : null;
  const cacheVersion = request.cookies.get('hp-v')?.value || '0';
  const buildId = request.headers.get('x-hp-build') || 'dev';
  let cacheKey = null;
  if (cacheVariant) {
    try {
      cacheKey = responseCacheKey({
        pathname,
        search: request.nextUrl.search,
        variant: cacheVariant,
        userId: session.user.id,
        accessToken: session.access_token,
        version: cacheVersion,
        build: buildId,
        stateTree: request.headers.get('next-router-state-tree'),
        nextUrl: request.headers.get('next-url'),
      });
      const hit = await caches.default.match(
        new Request(new URL(cacheKey, request.url).toString(), { method: 'GET' })
      );
      if (hit) {
        const cached = new Response(hit.body, {
          status: hit.status,
          headers: new Headers(hit.headers),
        });
        cached.headers.set('cache-control', 'private, no-store');
        // Re-apply any session cookies refreshed by getSession() above — the
        // cached copy deliberately never stores Set-Cookie.
        for (const cookie of response.headers.getSetCookie?.() ?? []) {
          cached.headers.append('set-cookie', cookie);
        }
        return cached;
      }
    } catch {
      // Cache API unavailable (e.g. local HTTP preview) — render normally.
      cacheKey = null;
    }
  }

  // getUser() round-trips to GoTrue — a forged cookie does not pass. This runs
  // on every cache miss and every non-cacheable page.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  if (user && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Edge-cache authenticated page renders. Every 80–200 ms SSR request drains
  // the Free plan's per-isolate CPU bank; serving repeat navigations from the
  // Cache API keeps the average far below the 10 ms budget.
  if (user && cacheVariant) {
    if (!cacheKey) {
      cacheKey = responseCacheKey({
        pathname,
        search: request.nextUrl.search,
        variant: cacheVariant,
        userId: user.id,
        accessToken: session?.access_token || '',
        version: cacheVersion,
        build: buildId,
        stateTree: request.headers.get('next-router-state-tree'),
        nextUrl: request.headers.get('next-url'),
      });
    }
    // Miss: let the page render, then worker.js stores the response.
    response.headers.set('x-hp-cache-key', cacheKey);
  }

  return response;
}

export const config = {
  // Everything except API routes, static assets and Next internals — API
  // handlers do their own requireUser() check.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
