// Shared response-cache helpers used by both middleware.js (Next bundle) and
// worker.js (Wrangler bundle). Keep this module free of Next/Cloudflare
// imports so both bundlers can use it.

export const RESPONSE_CACHE_TTL_SECONDS = 900;

export function fnv1a(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// Only whole-page documents and RSC payloads for authenticated app routes.
// API calls, auth pages and assets are never cached.
export function responseCacheVariant(method, pathname, getHeader) {
  if (method !== 'GET') return null;
  if (pathname.startsWith('/api') || pathname.startsWith('/_next')) return null;
  if (pathname === '/login' || pathname === '/signup') return null;
  if (pathname.startsWith('/__hp-cache')) return null;
  const isRsc = getHeader('rsc') === '1';
  const accept = getHeader('accept') || '';
  const dest = getHeader('sec-fetch-dest') || '';
  if (!isRsc && !(dest === 'document' || accept.includes('text/html'))) return null;
  return isRsc ? 'r' : 'd';
}

// The access-token hash binds an entry to the exact token that was verified
// when it was written. A forged token cannot hit an entry, because it does not
// know the hash (or the token) of a verified session.
export function responseCacheKey({
  pathname, search, variant, userId, accessToken, version, build, stateTree, nextUrl,
}) {
  const token = fnv1a(accessToken || '');
  const fingerprint = [pathname + (search || ''), stateTree || '', nextUrl || ''].map(fnv1a).join('-');
  const ver = (version || '0').slice(0, 24);
  // Including the deployment version means a new release can never serve HTML
  // that references assets from the previous one. Old entries simply expire.
  const release = encodeURIComponent((build || 'dev').slice(0, 64));
  return `/__hp-cache/${variant}/b/${release}/${encodeURIComponent(userId)}/${ver}/${token}/${fingerprint}`;
}

export function responseCacheUrl(key, origin) {
  return new URL(key, origin).toString();
}

export function parseCookieList(cookieHeader) {
  if (!cookieHeader) return [];
  const out = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    try {
      out.push({
        name: decodeURIComponent(trimmed.slice(0, eq)),
        value: decodeURIComponent(trimmed.slice(eq + 1)),
      });
    } catch {
      // Ignore malformed cookies rather than failing the whole request.
    }
  }
  return out;
}

export function cacheVersionFromCookies(cookies) {
  return cookies.find((c) => c.name === 'hp-v')?.value || '0';
}
