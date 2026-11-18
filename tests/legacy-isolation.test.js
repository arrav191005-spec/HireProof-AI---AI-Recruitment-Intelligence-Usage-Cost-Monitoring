import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('legacy repository fails closed when PostgreSQL is configured', () => {
  const result = spawnSync(process.execPath, [
    '--import', './tests/helpers/register-alias.mjs',
    '--input-type=module', '-e',
    `import getRepo from '@/lib/repo';
     try { await getRepo(); process.exit(2); }
     catch (error) { if (!error.message.includes('Legacy PostgreSQL access is disabled')) process.exit(3); }`,
  ], { env: { ...process.env, DATABASE_URL: 'postgresql://localhost/isolated-test' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
