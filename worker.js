// Worker entry that wraps the OpenNext-generated handler.
//
// Why this exists: Cloudflare Workers Free gives each isolate a "rollover
// bank" of CPU time (10 ms per request, with leftover accumulating). Next.js
// SSR costs 60–800 ms per page, so a handful of navigations empties the bank
// and every following request is terminated with Error 1102 until a fresh
// isolate appears. The fix without upgrading is to stop re-rendering pages the
// user has already loaded.
//
// Two cache layers, both keyed by the verified session:
//   - This wrapper checks the Workers Cache API *before* entering OpenNext, so
//     a hit costs a local session read plus one cache lookup (no Next render,
//     no middleware, no GoTrue round-trip).
//   - middleware.js repeats the lookup after GoTrue verifies the session (for
//     requests the wrapper could not decide) and tags misses with
//     `x-hp-cache-key`; this wrapper stores the rendered response.
//
// Entries are keyed by a hash of the access token, so a hit can only come from
// a token that was verified when the entry was written. Set-Cookie is stripped
// from cached copies and re-applied from the live session. A successful write
// bumps a per-browser version cookie so the next navigation misses the cache
// and sees fresh data; entries also expire after RESPONSE_CACHE_TTL_SECONDS.

import openNextWorker from './.open-next/worker.js';
import { createServerClient } from '@supabase/ssr';
import {
  RESPONSE_CACHE_TTL_SECONDS,
  responseCacheVariant,
  responseCacheKey,
  responseCacheUrl,
  parseCookieList,
  cacheVersionFromCookies,
} from './lib/response-cache.js';

export * from './.open-next/worker.js';

const CACHE_VERSION_COOKIE = 'hp-v';

// Search and analytics POSTs are read-only; invalidating every page after
// running a search would force expensive re-renders for no data change.
function shouldInvalidate(method, pathname) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  if (pathname === '/api/search') return false;
  if (pathname.startsWith('/api/analytics/')) return false;
  return true;
}

function serializeCookie({ name, value, options = {} }) {
  let out = `${name}=${value}`;
  if (options.maxAge != null) out += `; Max-Age=${options.maxAge}`;
  if (options.path) out += `; Path=${options.path}`;
  if (options.domain) out += `; Domain=${options.domain}`;
  if (options.expires) {
    const d = options.expires instanceof Date ? options.expires : new Date(options.expires);
    out += `; Expires=${d.toUTCString()}`;
  }
  if (options.sameSite) {
    const s = String(options.sameSite);
    out += `; SameSite=${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()}`;
  }
  if (options.secure) out += '; Secure';
  if (options.httpOnly) out += '; HttpOnly';
  return out;
}

function withVersionCookie(response) {
  const out = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  out.headers.append(
    'set-cookie',
    `${CACHE_VERSION_COOKIE}=${Date.now().toString(36)}; Path=/; SameSite=Lax; Max-Age=3600`
  );
  return out;
}

// The hit path deliberately avoids OpenNext entirely. `getSession()` reads the
// cookie locally (no GoTrue call); the cache key includes a hash of the exact
// access token, so only a token verified at write time can produce a hit.
async function tryCacheHit(request, env, buildId) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const variant = responseCacheVariant(request.method, url.pathname, (name) =>
    request.headers.get(name)
  );
  if (!variant) return null;

  const cookieHeader = request.headers.get('cookie') || '';
  if (!cookieHeader.includes('sb-')) return null;
  const cookies = parseCookieList(cookieHeader);
  if (!cookies.some((c) => c.name.startsWith('sb-'))) return null;

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const refreshed = [];
  let session = null;
  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => cookies,
        setAll: (toSet) => {
          refreshed.push(...toSet);
        },
      },
    });
    const { data } = await supabase.auth.getSession();
    session = data.session;
  } catch {
    return null;
  }

  if (!session?.user?.id || !session.access_token) return null;
  if (session.expires_at && session.expires_at * 1000 <= Date.now()) return null;

  const key = responseCacheKey({
    pathname: url.pathname,
    search: url.search,
    variant,
    userId: session.user.id,
    accessToken: session.access_token,
    version: cacheVersionFromCookies(cookies),
    build: buildId,
    stateTree: request.headers.get('next-router-state-tree'),
    nextUrl: request.headers.get('next-url'),
  });

  let hit = null;
  try {
    hit = await caches.default.match(new Request(responseCacheUrl(key, url.origin)));
  } catch {
    return null;
  }
  if (!hit) return null;

  const out = new Response(hit.body, {
    status: hit.status,
    headers: new Headers(hit.headers),
  });
  out.headers.set('cache-control', 'private, no-store');
  for (const cookie of refreshed) {
    out.headers.append('set-cookie', serializeCookie(cookie));
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    // The deployment id is part of every cache key so a release can never be
    // mixed with cached HTML from an earlier build. Locally there is no
    // version metadata, hence the stable `dev` fallback.
    const buildId = env.CF_VERSION_METADATA?.id || 'dev';

    if (request.method === 'GET') {
      const hit = await tryCacheHit(request, env, buildId);
      if (hit) return hit;
    }

    // Middleware cannot read the binding directly, so pass the build id in a
    // header it uses to compute the same cache key when tagging a miss.
    let openNextRequest = request;
    if (request.method === 'GET') {
      const headers = new Headers(request.headers);
      headers.set('x-hp-build', buildId);
      openNextRequest = new Request(request, { headers });
    }

    const response = await openNextWorker.fetch(openNextRequest, env, ctx);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (shouldInvalidate(request.method, new URL(request.url).pathname) && response.status < 400) {
        return withVersionCookie(response);
      }
      return response;
    }

    const cacheKeyPath = response.headers.get('x-hp-cache-key');
    if (!cacheKeyPath) return response;

    // Clone before touching response.body: clone() tees the stream, but a
    // Response constructed from `.body` locks it.
    const cacheCopy = response.clone();
    const clientResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    clientResponse.headers.delete('x-hp-cache-key');
    // No browser caching: a mutation bumps the server cache version, which a
    // browser copy would not know about. Every navigation still hits the
    // worker cache, but a hit is typically 1–4 ms.
    clientResponse.headers.set('cache-control', 'private, no-store');

    ctx.waitUntil(
      (async () => {
        // Only successful renders are cacheable. Caching a 404/500 would both
        // hide the error behind a 200 and persist it for the whole TTL.
        if (cacheCopy.status !== 200) return;
        const body = await cacheCopy.arrayBuffer();
        const headers = new Headers(cacheCopy.headers);
        // Never store cookies: the live session re-applies refreshed cookies.
        headers.delete('set-cookie');
        headers.delete('x-hp-cache-key');
        headers.set('cache-control', `public, max-age=${RESPONSE_CACHE_TTL_SECONDS}`);
        await caches.default.put(
          new Request(new URL(cacheKeyPath, request.url)),
          new Response(body, { status: cacheCopy.status, headers })
        );
      })().catch((err) => {
        // Caching is an optimization; a failed put must never fail the request.
        console.warn('[hireproof] response cache put failed:', err?.message ?? err);
      })
    );

    return clientResponse;
  },
};
