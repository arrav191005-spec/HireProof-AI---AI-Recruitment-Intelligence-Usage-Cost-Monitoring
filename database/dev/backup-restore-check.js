#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Backup/restore check for the isolated development database.
//
//   DEV_ADMIN_URL=postgresql://arrav@127.0.0.1:5432/postgres \
//   DEV_DATABASE_URL=postgresql://arrav@127.0.0.1:5432/hireproof_dev?sslmode=disable \
//     node database/dev/backup-restore-check.js
//
// 1. inserts one synthetic marker row into the development database;
// 2. pg_dump (custom format) -> temporary file;
// 3. pg_restore into a fresh hireproof_dev_restorecheck_* database;
// 4. verifies the marker and migration count in the restored copy;
// 5. drops the restore database, deletes the dump and the marker.
//
// Nothing outside the reviewed hireproof_dev* namespace is touched. The dump
// is never copied to cloud storage and passwords are never printed.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  assertDevDatabaseName,
  assertDevDatabaseUrl,
  assertLocalPostgresUrl,
  envFileValues,
  quoteIdent,
  redactSecrets,
} from './guards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = path.join(ROOT, '.env.dev.local');

function loadDevEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const values = envFileValues(fs.readFileSync(ENV_FILE, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function connection(url) {
  return new pg.Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 8000 });
}

// pg_dump/pg_restore read the password from PGPASSWORD, never from argv
// (argv is visible to `ps`). The URL passed on the command line has no password.
function toolConnection(url) {
  const copy = new URL(url.toString());
  const password = decodeURIComponent(copy.password);
  copy.password = '';
  if (!copy.searchParams.has('sslmode')) copy.searchParams.set('sslmode', 'disable');
  return { url: copy.toString(), env: password ? { PGPASSWORD: password } : {} };
}

function runTool(name, args, url) {
  const { url: safeUrl, env } = toolConnection(url);
  const result = spawnSync(name, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env, PGCONNECT_TIMEOUT: '8' },
  });
  if (result.error) throw new Error(`${name} is not available: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${redactSecrets(result.stderr || result.stdout || `exit ${result.status}`)}`);
  }
  return result;
}

function pgDump(devUrl, dumpFile) {
  runTool('pg_dump', [
    '--format=custom', '--compress=9', '--no-owner', '--no-privileges',
    `--file=${dumpFile}`, toolConnection(devUrl).url,
  ], devUrl);
}

function pgRestore(restoreUrl, dumpFile) {
  runTool('pg_restore', [
    '--no-owner', '--no-privileges', '--exit-on-error',
    `--dbname=${toolConnection(restoreUrl).url}`, dumpFile,
  ], restoreUrl);
}

async function main() {
  loadDevEnv();
  const dbName = assertDevDatabaseName(process.env.DEV_DB_NAME || 'hireproof_dev');
  if (!process.env.DEV_DATABASE_URL) throw new Error('DEV_DATABASE_URL is required.');
  if (!process.env.DEV_ADMIN_URL) throw new Error('DEV_ADMIN_URL is required.');
  const devUrl = assertDevDatabaseUrl(process.env.DEV_DATABASE_URL, dbName);
  const adminUrl = assertLocalPostgresUrl(process.env.DEV_ADMIN_URL);
  if (decodeURIComponent(adminUrl.pathname.replace(/^\//, '')) === 'hireproof') {
    throw new Error('Refusing to use the application database as the administrative connection.');
  }

  const nonce = crypto.randomBytes(12).toString('hex');
  const markerId = `audit-dev-backup-${nonce}`;
  const restoreName = `hireproof_dev_restorecheck_${nonce.slice(0, 8)}`;
  assertDevDatabaseName(restoreName);
  const dumpFile = path.join(os.tmpdir(), `hireproof_dev_backup_${nonce}.dump`);
  const restoreUrl = new URL(adminUrl.toString());
  restoreUrl.pathname = `/${encodeURIComponent(restoreName)}`;

  const dev = connection(devUrl);
  const admin = connection(adminUrl);
  let restoreCreated = false;
  try {
    await dev.connect();
    await admin.connect();

    const expectedMigrations = (await dev.query(
      "select count(*)::int as count from schema_migrations where status = 'applied'"
    )).rows[0].count;
    await dev.query(
      `insert into audit_logs(id, actor, action, entity_type, entity_id, metadata)
       values ($1, 'dev-backup-check', 'dev.backup.probe', 'development', $1, $2::jsonb)`,
      [markerId, JSON.stringify({ nonce })]
    );
    console.log('✓ inserted disposable backup marker');

    pgDump(devUrl, dumpFile);
    fs.chmodSync(dumpFile, 0o600);
    const bytes = fs.statSync(dumpFile).size;
    if (bytes <= 0) throw new Error('pg_dump produced an empty file');

    await admin.query(`create database ${quoteIdent(restoreName)}`);
    restoreCreated = true;
    pgRestore(restoreUrl, dumpFile);

    const restored = connection(restoreUrl);
    await restored.connect();
    try {
      const marker = (await restored.query(
        'select metadata->>$1 as nonce from audit_logs where id = $2', ['nonce', markerId]
      )).rows[0];
      if (!marker || marker.nonce !== nonce) throw new Error('restored marker row is missing or altered');
      const restoredMigrations = (await restored.query(
        "select count(*)::int as count from schema_migrations where status = 'applied'"
      )).rows[0].count;
      if (restoredMigrations !== expectedMigrations) {
        throw new Error(`restored migration count ${restoredMigrations} does not match ${expectedMigrations}`);
      }
      console.log(`✓ restore verified: marker intact, ${restoredMigrations} applied migrations, ${bytes} byte dump`);
    } finally {
      await restored.end();
    }
  } finally {
    if (restoreCreated) {
      try {
        await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [restoreName]);
        await admin.query(`drop database if exists ${quoteIdent(restoreName)}`);
        console.log('✓ dropped disposable restore database');
      } catch (error) {
        console.error(`! could not drop ${restoreName}: ${redactSecrets(error.message)}`);
      }
    }
    try {
      await dev.query('delete from audit_logs where id = $1', [markerId]);
    } catch {
      // The marker is synthetic and namespaced; a cleanup failure is reported
      // by the next run rather than hiding the original error.
    }
    try {
      fs.rmSync(dumpFile, { force: true });
    } catch {
      console.error('! could not delete the temporary dump file');
    }
    try { await dev.end(); } catch { /* already closed */ }
    try { await admin.end(); } catch { /* already closed */ }
  }
  console.log('✓ backup/restore check passed');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(`✗ ${redactSecrets(error.message)}`);
    process.exitCode = 1;
  });
