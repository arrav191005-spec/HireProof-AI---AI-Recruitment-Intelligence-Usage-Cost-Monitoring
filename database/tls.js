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

export function buildSslConfig() {
  const pemPath = path.join(process.cwd(), 'database', 'supabase-ca.pem');
  if (fs.existsSync(pemPath)) {
    return { ca: fs.readFileSync(pemPath), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

export default buildSslConfig;
