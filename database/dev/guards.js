// Pure guards for the isolated development-database tooling. Kept free of
// database access so they can be unit-tested without a PostgreSQL server.

export const DEV_DATABASE_PATTERN = /^hireproof_dev(?:_[a-z0-9][a-z0-9_]{0,40})?$/;
export const DEV_RESTORE_PREFIX = 'hireproof_dev_restorecheck_';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const POSTGRES_SCHEMES = new Set(['postgres:', 'postgresql:']);

export function assertDevDatabaseName(name) {
  if (typeof name !== 'string' || !DEV_DATABASE_PATTERN.test(name)) {
    throw new Error(
      'Refusing database name: the isolated development database must be named ' +
        '"hireproof_dev" or "hireproof_dev_<suffix>" (never "hireproof", "postgres" or a shared database).'
    );
  }
  return name;
}

export function isLoopbackHost(hostname) {
  return LOOPBACK.has(String(hostname || '').toLowerCase());
}

export function assertLocalPostgresUrl(raw, { database } = {}) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new Error('A valid PostgreSQL URL is required.');
  }
  if (!POSTGRES_SCHEMES.has(url.protocol)) {
    throw new Error('Only postgres:// or postgresql:// URLs are accepted.');
  }
  if (!url.hostname || !isLoopbackHost(url.hostname)) {
    throw new Error(
      'Refusing non-loopback PostgreSQL host: isolated development provisioning only runs against 127.0.0.1, localhost or ::1.'
    );
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) throw new Error('The PostgreSQL URL must name a database.');
  if (database && dbName !== database) {
    throw new Error(`The PostgreSQL URL must target the reviewed development database "${database}".`);
  }
  return url;
}

export function assertDevDatabaseUrl(raw, name) {
  assertDevDatabaseName(name);
  const url = assertLocalPostgresUrl(raw);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (dbName !== name) {
    throw new Error(`The connection URL targets "${dbName}", not the reviewed development database "${name}".`);
  }
  return url;
}

export function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// Redact connection strings before printing an error. Development passwords
// must not leak into terminal output, logs, or issue reports.
export function redactSecrets(text) {
  return String(text || '')
    .replace(/(postgres(?:ql)?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, '$1$2:***@')
    .replace(/(password\s*=\s*)([^\s;]+)/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***');
}

// Minimal .env parser used only for the untracked `.env.dev.local` file.
// Existing process.env values always win.
export function envFileValues(text) {
  const values = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
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
    values[key] = value;
  }
  return values;
}
