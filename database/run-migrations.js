#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HireProof AI — migration runner.
//
//   node database/run-migrations.js           apply pending migrations
//   node database/run-migrations.js --status  list applied / pending / failed
//
// Behaviour:
//   - loads .env.local/.env itself (plain `node` has no dotenv), then
//     dynamically imports env-dependent modules;
//   - creates schema_migrations(version, applied_at, checksum, status);
//   - applies database/migrations/*.sql in lexical order, one TRANSACTION per
//     file (the SQL text is trusted repo content, never user input);
//   - records a sha256 checksum; already-applied files are skipped (a warning
//     is printed if the file changed since);
//   - a failing file whose name matches *optional*.sql is a WARNING: rolled
//     back, recorded with status 'failed', run continues. Any other failure
//     aborts with a non-zero exit code;
//   - always closes the pool.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 1) env first — everything that reads process.env is imported after this.
await import('./load-env.js');

// 2) plain-stdlib / env-independent modules (pg itself reads no env at import).
const { default: pg } = await import('pg');
const { buildSslConfig } = await import('./tls.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, 'migrations');

const isOptional = (name) => /optional/i.test(name);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const when = (d) => (d ? new Date(d).toISOString() : '—');

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL is not set — add it to .env.local first.');
    return 1;
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: buildSslConfig(),
    max: 2,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[hireproof] idle client error:', err.message));

  try {
    await pool.query(`create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz,
      checksum   text not null default '',
      status     text not null default 'applied'  -- 'applied' | 'failed' (optional files only)
    )`);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    if (files.length === 0) {
      console.log('no *.sql files found in database/migrations — nothing to do.');
      return 0;
    }

    const { rows } = await pool.query(
      'select version, applied_at, checksum, status from schema_migrations'
    );
    const applied = new Map(rows.map((r) => [r.version, r]));

    if (statusOnly) {
      console.log(`schema status — ${files.length} file(s) in database/migrations:`);
      for (const file of files) {
        const row = applied.get(file);
        if (!row) {
          console.log(`  · ${file.padEnd(34)} pending`);
        } else if (row.status === 'failed') {
          console.log(`  ! ${file.padEnd(34)} failed (optional — retried on next run)`);
        } else {
          const sum = String(row.checksum ?? '').slice(0, 12);
          console.log(`  ✓ ${file.padEnd(34)} applied ${when(row.applied_at)}  sha256:${sum}…`);
        }
      }
      return 0;
    }

    let pending = 0;
    let done = 0;
    for (const file of files) {
      const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sqlText);
      const row = applied.get(file);

      if (row && row.status === 'applied') {
        if (row.checksum && row.checksum !== checksum) {
          console.warn(`⚠ ${file}: checksum changed since it was applied — file edited; NOT re-running.`);
        }
        console.log(`✓ ${file} — already applied (${when(row.applied_at)})`);
        continue;
      }
      if (row && row.status === 'failed') {
        console.log(`↻ ${file} — previously failed (optional), retrying…`);
      }
      pending += 1;

      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sqlText);
        await client.query(
          `insert into schema_migrations (version, applied_at, checksum, status)
           values ($1, now(), $2, 'applied')
           on conflict (version) do update set applied_at = now(), checksum = excluded.checksum, status = 'applied'`,
          [file, checksum]
        );
        await client.query('commit');
        console.log(`✓ ${file} — applied (sha256 ${checksum.slice(0, 12)}…)`);
        done += 1;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          /* connection may already be aborted */
        }
        if (isOptional(file)) {
          console.warn(`⚠ ${file} — FAILED (optional, continuing): ${err.message}`);
          await pool.query(
            `insert into schema_migrations (version, applied_at, checksum, status)
             values ($1, null, $2, 'failed')
             on conflict (version) do update set checksum = excluded.checksum, status = 'failed'`,
            [file, checksum]
          );
        } else {
          throw new Error(`migration ${file} failed: ${err.message}`);
        }
      } finally {
        client.release();
      }
    }

    if (pending === 0) {
      console.log(`nothing to migrate — all ${files.length} migration file(s) are already applied.`);
    } else {
      console.log(`done — applied ${done} of ${pending} pending migration file(s).`);
    }
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
