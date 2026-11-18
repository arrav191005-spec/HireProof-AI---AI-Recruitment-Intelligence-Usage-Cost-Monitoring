#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Isolated development PostgreSQL provisioning.
//
//   DEV_ADMIN_URL=postgresql://arrav@127.0.0.1:5432/postgres \
//     node database/dev/provision-dev-database.js
//
// What it does, in order:
//   1. refuses every database name except hireproof_dev[_<suffix>];
//   2. refuses every non-loopback host (this is a developer workstation tool,
//      never a production/shared provisioning tool);
//   3. creates the reviewed NOLOGIN group roles and three separate LOGIN roles
//      (API, verification worker, bootstrap operator);
//   4. runs the repository migration runner (001..latest) against the isolated
//      database and preserves its sha256 checksums;
//   5. verifies RLS, role separation and migration state;
//   6. writes connection URLs to the gitignored `.env.dev.local` (mode 0600).
//
// It never connects to the existing `hireproof` application database and never
// prints a password. Production credentials must live elsewhere.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  assertDevDatabaseName,
  assertLocalPostgresUrl,
  envFileValues,
  quoteIdent,
  quoteLiteral,
  redactSecrets,
} from './guards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_FILE = path.join(ROOT, '.env.dev.local');
const GROUP_ROLES = [
  'hireproof_v2_access',
  'hireproof_verification_worker',
  'hireproof_bootstrap_operator',
];
const LOGIN_ROLES = [
  { name: 'hireproof_dev_api', group: 'hireproof_v2_access', passwordKey: 'DEV_API_PASSWORD', urlKey: 'V2_DATABASE_URL', timeout: '30s' },
  { name: 'hireproof_dev_worker', group: 'hireproof_verification_worker', passwordKey: 'DEV_WORKER_PASSWORD', urlKey: 'VERIFICATION_WORKER_DATABASE_URL', timeout: '120s' },
  { name: 'hireproof_dev_operator', group: 'hireproof_bootstrap_operator', passwordKey: 'DEV_OPERATOR_PASSWORD', urlKey: 'BOOTSTRAP_DATABASE_URL', timeout: '60s' },
];

function parseArgs(argv) {
  const args = { database: 'hireproof_dev', migrate: true, enableVerification: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--database') args.database = argv[++i];
    else if (argv[i] === '--no-migrate') args.migrate = false;
    else if (argv[i] === '--enable-verification') args.enableVerification = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function loadDevEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const values = envFileValues(fs.readFileSync(ENV_FILE, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

function existingPassword(values, urlKey) {
  try {
    const url = new URL(values[urlKey] || '');
    return url.password ? decodeURIComponent(url.password) : '';
  } catch {
    return '';
  }
}

function choosePassword(values, role) {
  if (process.env.DEV_ROTATE_PASSWORDS === '1') {
    return crypto.randomBytes(24).toString('base64url');
  }
  return (
    process.env[role.passwordKey] ||
    existingPassword(values, role.urlKey) ||
    crypto.randomBytes(24).toString('base64url')
  );
}

function databaseUrl(base, database, username, password) {
  const url = new URL(base);
  url.pathname = `/${encodeURIComponent(database)}`;
  if (username !== undefined) url.username = username;
  if (password !== undefined) url.password = password;
  if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'disable');
  return url;
}

function connection(url) {
  return new pg.Client({ connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 8000 });
}

async function run(client, sql, params) {
  return client.query(sql, params);
}

async function createGroupRoles(admin) {
  for (const role of GROUP_ROLES) {
    await run(admin, `do $$ begin
      if not exists (select 1 from pg_roles where rolname = ${quoteLiteral(role)}) then
        create role ${quoteIdent(role)} nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      else
        alter role ${quoteIdent(role)} nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
      end if;
    end $$;`);
  }
}

async function createLoginRoles(admin, passwords) {
  for (const role of LOGIN_ROLES) {
    const password = passwords[role.name];
    await run(admin, `do $$ begin
      if not exists (select 1 from pg_roles where rolname = ${quoteLiteral(role.name)}) then
        create role ${quoteIdent(role.name)} login password ${quoteLiteral(password)}
          nosuperuser nobypassrls nocreatedb nocreaterole inherit;
      else
        alter role ${quoteIdent(role.name)} login password ${quoteLiteral(password)}
          nosuperuser nobypassrls nocreatedb nocreaterole inherit;
      end if;
    end $$;`);
    await run(admin, `alter role ${quoteIdent(role.name)} set statement_timeout = ${quoteLiteral(role.timeout)}`);
    await run(admin, `alter role ${quoteIdent(role.name)} set idle_in_transaction_session_timeout = '30s'`);
  }
  // Role separation is enforced here, not just by convention.
  for (const role of LOGIN_ROLES) {
    for (const group of GROUP_ROLES) {
      await run(admin, `revoke ${quoteIdent(group)} from ${quoteIdent(role.name)}`);
    }
    await run(admin, `grant ${quoteIdent(role.group)} to ${quoteIdent(role.name)}`);
  }
}

async function ensureDatabase(admin, name) {
  const exists = await run(admin, 'select 1 from pg_database where datname = $1', [name]);
  if (exists.rowCount === 0) {
    const owner = (await run(admin, 'select current_user as name')).rows[0].name;
    await run(admin, `create database ${quoteIdent(name)} owner ${quoteIdent(owner)}`);
    return true;
  }
  return false;
}

function runMigrations(databaseUrlString) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'database', 'run-migrations.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrlString,
      DATABASE_SSL: 'disable',
    },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  if (result.status !== 0) {
    process.stderr.write(redactSecrets(result.stderr || ''));
    throw new Error('the migration sequence failed; the development database was left inspectable');
  }
}

function writeEnvFile({ adminUrl, devUrl, urls, enabled }) {
  const lines = [
    '# Generated by database/dev/provision-dev-database.js.',
    '# LOCAL DEVELOPMENT ONLY. Never commit this file or copy these credentials',
    '# to staging, production or any shared deployment. Re-run the provisioning',
    '# script with DEV_ROTATE_PASSWORDS=1 to rotate the development passwords.',
    `# Generated: ${new Date().toISOString()}`,
    `DEV_ADMIN_URL=${adminUrl}`,
    `DEV_DATABASE_URL=${devUrl}`,
    `V2_DATABASE_URL=${urls.api}`,
    `VERIFICATION_WORKER_DATABASE_URL=${urls.worker}`,
    `VERIFICATION_MONITOR_DATABASE_URL=${urls.worker}`,
    `BOOTSTRAP_DATABASE_URL=${urls.operator}`,
    `VERIFICATION_ENABLED=${enabled ? 'true' : 'false'}`,
    'API_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000',
    'NEXT_PUBLIC_VERIFICATION_API_URL=http://127.0.0.1:8000',
    '',
    '# GitHub token is optional and server-side only. Never add it to a',
    '# NEXT_PUBLIC_* variable or the frontend bundle.',
    '# GITHUB_TOKEN=',
    '',
  ];
  fs.writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}

async function checkRoleAttributes(client) {
  const rows = (await run(client, `
    select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit
    from pg_roles where rolname = any($1::text[]) order by rolname
  `, [[...GROUP_ROLES, ...LOGIN_ROLES.map((r) => r.name)]])).rows;
  const byName = new Map(rows.map((row) => [row.rolname, row]));
  for (const group of GROUP_ROLES) {
    const row = byName.get(group);
    if (!row || row.rolcanlogin || row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb) {
      throw new Error(`group role ${group} is not a restricted NOLOGIN role`);
    }
  }
  for (const role of LOGIN_ROLES) {
    const row = byName.get(role.name);
    if (!row || !row.rolcanlogin || row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb || !row.rolinherit) {
      throw new Error(`login role ${role.name} is not a restricted LOGIN role`);
    }
  }
  return true;
}

async function expectOk(client, sql, params) {
  const result = await run(client, sql, params);
  return result.rows[0]?.ok === true;
}

async function expectDenied(client, sql, params) {
  try {
    await run(client, sql, params);
    return false;
  } catch {
    return true;
  }
}

async function inspect(adminUrl, urls) {
  const checks = [];
  const record = async (label, fn) => {
    try {
      const ok = await fn();
      checks.push({ label, ok: ok === true });
    } catch (error) {
      checks.push({ label, ok: false, detail: redactSecrets(error.message) });
    }
  };

  const admin = connection(adminUrl);
  await admin.connect();
  try {
    const migrations = (await run(admin, 'select version, checksum, status from schema_migrations order by version')).rows;
    console.log('\nMigration history:');
    for (const row of migrations) {
      const sum = String(row.checksum || '').slice(0, 12);
      console.log(`  ${row.status === 'applied' ? '✓' : '!'} ${row.version.padEnd(34)} sha256:${sum}…`);
    }

    await record('all public tables have row level security enabled', async () => {
      const row = (await run(admin, `
        select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      `)).rows[0];
      return row.count === 0;
    });
    await record('RLS policies are installed', async () => {
      const row = (await run(admin, 'select count(*)::int as count from pg_policies where schemaname = $1', ['public'])).rows[0];
      return row.count > 20;
    });
    await record('group roles are restricted NOLOGIN roles', () => checkRoleAttributes(admin));
    await record('runtime roles cannot create in the public schema', async () => {
      const row = (await run(admin, `
        select bool_and(not has_schema_privilege(rolname, 'public', 'CREATE')) as ok
        from pg_roles where rolname = any($1::text[])
      `, [[...LOGIN_ROLES.map((r) => r.name), ...GROUP_ROLES]])).rows[0];
      return row.ok === true;
    });

    await record('API role can enqueue verification', () =>
      expectOk(admin, `select has_function_privilege('hireproof_dev_api', 'hp_enqueue_verification(bigint,text,text[])', 'EXECUTE') as ok`));
    await record('API role cannot claim or finalize verification', async () => {
      const row = (await run(admin, `
        select has_function_privilege('hireproof_dev_api', 'hp_claim_verification_job()', 'EXECUTE') as claim,
               has_function_privilege('hireproof_dev_api', 'hp_finish_verification_job(text,text,text,jsonb,jsonb,text)', 'EXECUTE') as finish
      `)).rows[0];
      return row.claim === false && row.finish === false;
    });
    await record('worker role can claim and finalize verification', async () => {
      const row = (await run(admin, `
        select has_function_privilege('hireproof_dev_worker', 'hp_claim_verification_job()', 'EXECUTE') as claim,
               has_function_privilege('hireproof_dev_worker', 'hp_finish_verification_job(text,text,text,jsonb,jsonb,text)', 'EXECUTE') as finish
      `)).rows[0];
      return row.claim === true && row.finish === true;
    });
    await record('worker role cannot enqueue verification', () =>
      expectOk(admin, `select not has_function_privilege('hireproof_dev_worker', 'hp_enqueue_verification(bigint,text,text[])'::regprocedure, 'EXECUTE') as ok`));
    await record('worker role is not a member of the API group', async () => {
      const row = (await run(admin, `select pg_has_role('hireproof_dev_worker', 'hireproof_v2_access', 'member') as member`)).rows[0];
      return row.member === false;
    });
    await record('worker role cannot read verification_jobs directly', async () => {
      const row = (await run(admin, `select has_table_privilege('hireproof_dev_worker', 'verification_jobs', 'SELECT') as can_read`)).rows[0];
      return row.can_read === false;
    });
  } finally {
    await admin.end();
  }

  const api = connection(urls.api);
  await api.connect();
  try {
    await record('API login sees no rows without a verified subject (RLS default deny)', async () => {
      const row = (await run(api, 'select count(*)::int as count from candidates')).rows[0];
      return row.count === 0;
    });
    await record('API login cannot read the verification queue', () =>
      expectDenied(api, 'select count(*) from verification_jobs'));
    await record('API login cannot execute the worker claim function', () =>
      expectDenied(api, 'select * from hp_claim_verification_job()'));
  } finally {
    await api.end();
  }

  const worker = connection(urls.worker);
  await worker.connect();
  try {
    const metricsExist = (await run(worker, `select to_regprocedure('hp_verification_metrics()') is not null as ok`)).rows[0].ok;
    if (metricsExist) {
      await record('worker login can read sanitized queue metrics', async () => {
        const value = (await run(worker, 'select hp_verification_metrics() as metrics')).rows[0].metrics;
        return value && typeof value === 'object' && !('repository_url' in value);
      });
    }
    await record('worker login cannot read verification tables directly', () =>
      expectDenied(worker, 'select count(*) from project_verification_runs'));
    await record('worker login cannot read candidate records', () =>
      expectDenied(worker, 'select count(*) from candidates'));
  } finally {
    await worker.end();
  }

  console.log('\nReadiness checks:');
  for (const check of checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.label}${check.ok || !check.detail ? '' : ` — ${check.detail}`}`);
  }
  return checks.every((check) => check.ok);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: DEV_ADMIN_URL=postgresql://USER@127.0.0.1:5432/postgres node database/dev/provision-dev-database.js [--database hireproof_dev] [--no-migrate] [--enable-verification]');
    return 0;
  }
  const dbName = assertDevDatabaseName(args.database);
  const values = loadDevEnv();
  const adminRaw = process.env.DEV_ADMIN_URL;
  if (!adminRaw) {
    console.error('✗ DEV_ADMIN_URL is required, e.g. postgresql://arrav@127.0.0.1:5432/postgres');
    return 1;
  }
  const adminUrl = assertLocalPostgresUrl(adminRaw);
  const adminDatabase = decodeURIComponent(adminUrl.pathname.replace(/^\//, ''));
  if (adminDatabase === 'hireproof') {
    throw new Error('Refusing to use the existing application database as the administrative connection.');
  }

  const passwords = Object.fromEntries(
    LOGIN_ROLES.map((role) => [role.name, choosePassword(values, role)])
  );

  const admin = connection(adminUrl);
  await admin.connect();
  try {
    const created = await ensureDatabase(admin, dbName);
    await createGroupRoles(admin);
    await createLoginRoles(admin, passwords);
    console.log(`${created ? '✓ created' : '✓ reused'} isolated database ${dbName}`);
  } finally {
    await admin.end();
  }

  const devUrl = databaseUrl(adminUrl, dbName);
  if (args.migrate) {
    console.log(`\nApplying migrations to ${dbName}…`);
    runMigrations(devUrl.toString());
  } else {
    console.log('\nSkipping migrations (--no-migrate).');
  }

  const urls = {
    api: databaseUrl(adminUrl, dbName, 'hireproof_dev_api', passwords['hireproof_dev_api']).toString(),
    worker: databaseUrl(adminUrl, dbName, 'hireproof_dev_worker', passwords['hireproof_dev_worker']).toString(),
    operator: databaseUrl(adminUrl, dbName, 'hireproof_dev_operator', passwords['hireproof_dev_operator']).toString(),
  };

  // Narrow schema ACLs after migrations. Table creation belongs to the
  // migration administrator; runtime logins never get CREATE.
  const devAdmin = connection(devUrl);
  await devAdmin.connect();
  try {
    await run(devAdmin, 'revoke create on schema public from public');
    await run(devAdmin, `revoke create on schema public from ${LOGIN_ROLES.map((r) => quoteIdent(r.name)).join(', ')}`);
  } finally {
    await devAdmin.end();
  }

  writeEnvFile({
    adminUrl: adminUrl.toString(),
    devUrl: devUrl.toString(),
    urls,
    enabled: args.enableVerification ?? values.VERIFICATION_ENABLED === 'true',
  });
  console.log(`✓ wrote gitignored development environment file ${path.relative(ROOT, ENV_FILE)} (mode 0600)`);

  const ready = await inspect(devUrl, urls);
  if (!ready) {
    console.error('\n✗ development database readiness checks failed');
    return 1;
  }
  console.log('\n✓ isolated development database is ready');
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`✗ ${redactSecrets(error.message)}`);
  process.exitCode = 1;
}
