// ---------------------------------------------------------------------------
// TLS helper shared by lib/repo/postgres.js and the database/* scripts.
//
// Supabase poolers (ports 6543/5432) require TLS. For the local demo the CA
// of the pooler certificate is not in the project's trust store, so the
// default is `rejectUnauthorized: false` (encryption on, certificate pinning
// off) — the same trade-off Supabase's own docs suggest for quickstarts.
//
// For production, drop the project's CA bundle at `database/supabase-ca.pem`
// and this helper switches to full verification (`rejectUnauthorized: true`
// with the file as the CA list).
//
// NOTE: this module is bundled by Next.js — it must stay free of `import.meta`
// and resolve paths from process.cwd() (project root, like the rest of the
// code base does, e.g. lib/search/evaluation.js).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

// Cloudflare Workers (OpenNext) exposes a `node:tls` shim, but it throws on
// the `rejectUnauthorized` option that the `pg` driver always sets:
//   "The options.rejectUnauthorized option is not implemented"
// so any TLS attempt to the pooler fails there and the app would silently fall
// back to the in-memory demo store. The pooler DOES accept a plain TCP
// connection on port 6543, so on Workers we connect without TLS (see README
// known limitations). Everywhere else keeps the normal TLS path below.
export function isWorkersRuntime() {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers'
  );
}

export function buildSslConfig() {
  // Plain TCP is a documented trade-off forced by the Workers node:tls shim,
  // not a choice — every other runtime still uses TLS below.
  if (isWorkersRuntime()) {
    return false;
  }
  // On Cloudflare Workers (OpenNext) `node:fs` exists but most methods throw,
  // and the PEM would not be in the bundle anyway — fall back to encryption
  // without pinning there, exactly like the no-PEM path below.
  try {
    const pemPath = path.join(process.cwd(), 'database', 'supabase-ca.pem');
    if (fs.existsSync(pemPath)) {
      return { ca: fs.readFileSync(pemPath), rejectUnauthorized: true };
    }
  } catch {
    // Runtime without a usable filesystem (Workers) or unreadable PEM.
  }
  return { rejectUnauthorized: false };
}

export default buildSslConfig;
