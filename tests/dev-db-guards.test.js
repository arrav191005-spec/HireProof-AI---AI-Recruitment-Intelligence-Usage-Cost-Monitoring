import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDevDatabaseName,
  assertDevDatabaseUrl,
  assertLocalPostgresUrl,
  envFileValues,
  quoteIdent,
  quoteLiteral,
  redactSecrets,
} from '../database/dev/guards.js';

test('dev database names are restricted to the isolated namespace', () => {
  assert.equal(assertDevDatabaseName('hireproof_dev'), 'hireproof_dev');
  assert.equal(assertDevDatabaseName('hireproof_dev_alice'), 'hireproof_dev_alice');
  assert.equal(assertDevDatabaseName('hireproof_dev_restorecheck_ab12cd34'), 'hireproof_dev_restorecheck_ab12cd34');
  for (const name of ['hireproof', 'postgres', 'template0', 'Hireproof_Dev', 'hireproof_rls_x',
    'hireproof_dev; drop database postgres', 'hireproof_dev-extra', '']) {
    assert.throws(() => assertDevDatabaseName(name), /Refusing database name/);
  }
});

test('development provisioning only accepts loopback PostgreSQL URLs', () => {
  assert.doesNotThrow(() => assertLocalPostgresUrl('postgresql://arrav@127.0.0.1:5432/postgres'));
  assert.doesNotThrow(() => assertLocalPostgresUrl('postgres://arrav@localhost:5432/postgres'));
  assert.doesNotThrow(() => assertLocalPostgresUrl('postgresql://arrav@[::1]:5432/postgres'));
  assert.throws(() => assertLocalPostgresUrl('postgresql://arrav@db.example.com:5432/postgres'), /non-loopback/);
  assert.throws(() => assertLocalPostgresUrl('postgresql://arrav@10.0.0.2:5432/postgres'), /non-loopback/);
  assert.throws(() => assertLocalPostgresUrl('https://127.0.0.1/postgres'), /postgres/);
  assert.throws(() => assertLocalPostgresUrl('postgresql://arrav@127.0.0.1:5432'), /must name a database/);
});

test('dev database URLs must target the reviewed database', () => {
  assert.doesNotThrow(() =>
    assertDevDatabaseUrl('postgresql://arrav@127.0.0.1:5432/hireproof_dev?sslmode=disable', 'hireproof_dev'));
  assert.throws(() =>
    assertDevDatabaseUrl('postgresql://arrav@127.0.0.1:5432/hireproof?sslmode=disable', 'hireproof_dev'),
    /targets/);
  assert.throws(() =>
    assertDevDatabaseUrl('postgresql://arrav@db.example.com:5432/hireproof_dev', 'hireproof_dev'),
    /non-loopback/);
});

test('SQL quoting helpers escape identifiers and literals', () => {
  assert.equal(quoteIdent('hireproof_dev'), '"hireproof_dev"');
  assert.equal(quoteIdent('bad"name'), '"bad""name"');
  assert.equal(quoteLiteral("p'ass"), "'p''ass'");
});

test('connection strings and bearer tokens are redacted', () => {
  const text = 'connect postgresql://api:sup3r-secret@127.0.0.1:5432/hireproof_dev failed; password=abc123; Bearer eyJhbGciOi.payload.sig';
  const safe = redactSecrets(text);
  assert.ok(!safe.includes('sup3r-secret'));
  assert.ok(!safe.includes('abc123'));
  assert.ok(!safe.includes('eyJhbGciOi.payload.sig'));
  assert.ok(safe.includes('postgresql://api:***@'));
});

test('dev env file parsing ignores comments and respects quotes', () => {
  const values = envFileValues(`
    # comment
    V2_DATABASE_URL=postgresql://api:secret@127.0.0.1:5432/hireproof_dev
    QUOTED="value with spaces"
    SINGLE='another'
    NOT_A_LINE
  `);
  assert.equal(values.V2_DATABASE_URL, 'postgresql://api:secret@127.0.0.1:5432/hireproof_dev');
  assert.equal(values.QUOTED, 'value with spaces');
  assert.equal(values.SINGLE, 'another');
  assert.equal(values.NOT_A_LINE, undefined);
});
