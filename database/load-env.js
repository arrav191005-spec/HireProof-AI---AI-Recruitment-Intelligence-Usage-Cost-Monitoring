// ---------------------------------------------------------------------------
// Minimal .env loader for the plain-`node` database scripts.
//
// Node does not read .env.local by itself, so every script in database/ starts
// with `await import('./load-env.js')` BEFORE dynamically importing any module
// that reads process.env (lib/config.js, lib/repo/postgres.js). Static imports
// are hoisted above that statement, which is exactly why env-dependent modules
// must be imported dynamically.
//
// Rules:
//   - KEY=VALUE lines; `#` comments and blank lines ignored; quotes stripped.
//   - .env.local wins over .env (matches Next.js precedence).
//   - Existing process.env values are never overridden.
//   - No dependencies — stdlib only.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function applyEnvFile(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// .env.local first so it takes precedence over .env; process.env wins over both.
applyEnvFile('.env.local');
applyEnvFile('.env');

export default { ROOT };
