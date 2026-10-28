#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HireProof AI — destructive database reset (development helper).
//
//   node database/reset.js          REFUSES to run (prints what it would drop)
//   node database/reset.js --yes    drops the allowlisted objects
//
// Hard rules:
//   - only objects created by database/migrations/*.sql (plus the
//     schema_migrations bookkeeping table) may be dropped — a hardcoded
//     allowlist, nothing derived from input;
//   - only inside schema public; auth / storage / realtime / extensions /
//     graphql_public are never touched;
//   - every run prints exactly which objects are affected and a clear warning
//     that application data will be lost.
// ---------------------------------------------------------------------------
await import('./load-env.js');

const { default: pg } = await import('pg');
const { buildSslConfig } = await import('./tls.js');

// Hardcoded allowlist — mirrors database/migrations/001 + 002.
const TABLES = [
  'applications',
  'assessment_submissions',
  'assessments',
  'audit_logs',
  'candidate_evidence',
  'candidate_skills',
  'candidates',
  'education',
  'evidence_embeddings',
  'experiences',
  'job_requirements',
  'jobs',
  'projects',
  'resumes',
  'schema_migrations',
  'search_events',
  'users',
].sort();

const SEQUENCES = [
  'education_id_seq',
  'evidence_embeddings_id_seq',
  'experiences_id_seq',
  'job_requirements_id_seq',
  'projects_id_seq',
].sort();

function printPlan() {
  console.log('⚠  database/reset.js — DESTRUCTIVE RESET');
  console.log('This permanently deletes ALL application data in schema public:');
  console.log('');
  console.log(`tables (${TABLES.length}):`);
  for (const t of TABLES) console.log(`  - public.${t}`);
  console.log(`sequences (${SEQUENCES.length}):`);
  for (const s of SEQUENCES) console.log(`  - public.${s}`);
  console.log('');
  console.log('Indexes and FK constraints drop automatically with their tables (CASCADE).');
  console.log('The pgvector extension itself is NOT dropped. Schemas auth, storage,');
  console.log('realtime, extensions and graphql_public are NEVER touched.');
  console.log('');
  console.log('✗ Deleting this data cannot be undone — re-run `node database/seed.js`');
  console.log('  afterwards to restore the demo dataset.');
}

async function main() {
  printPlan();

  if (!process.argv.includes('--yes')) {
    console.log('\nRefusing to run without confirmation. Re-run with:');
    console.log('  node database/reset.js --yes');
    return 1;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL is not set — add it to .env.local first.');
    return 1;
  }

  const pool = new pg.Pool({
    connectionString: url,
    ssl: buildSslConfig(),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[hireproof] idle client error:', err.message));

  try {
    const tableList = TABLES.map((t) => `public.${t}`).join(', ');
    const seqList = SEQUENCES.map((s) => `public.${s}`).join(', ');
    await pool.query(`drop table if exists ${tableList} cascade`);
    await pool.query(`drop sequence if exists ${seqList} cascade`);
    console.log(`\n✓ dropped ${TABLES.length} table(s) and ${SEQUENCES.length} sequence(s) (IF EXISTS … CASCADE).`);
    console.log('✓ reset complete — schema public is empty. Next: node database/seed.js');
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`✗ reset failed: ${err.message}`);
  process.exitCode = 1;
}
