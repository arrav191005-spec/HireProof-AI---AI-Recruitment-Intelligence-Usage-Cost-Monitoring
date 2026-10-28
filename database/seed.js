#!/usr/bin/env node
// ---------------------------------------------------------------------------
// HireProof AI — idempotent demo seed.
//
//   node database/seed.js           seed when the database is empty; skip
//                                   (keeping current rows) when jobs already
//                                   has rows; always prints row counts
//   node database/seed.js --force   re-upsert the full demo dataset
//
// Rules:
//   - data comes from ../lib/demo-data.js with EXACT ids preserved
//     (cand-ava-thompson, job-junior-fullstack, ev-ava-1 …) so
//     tests/search-eval.json keeps working;
//   - INSERT … ON CONFLICT (…) DO UPDATE everywhere → re-running never
//     duplicates rows and never deletes anything a user created;
//   - FK order is respected (parents before children); one transaction for
//     the whole dataset; plain-`node` compatible (loads .env.local itself).
// ---------------------------------------------------------------------------
import seed from '../lib/demo-data.js'; // static: demo-data reads no env

// 1) env before any module that reads process.env.
await import('./load-env.js');

const { default: pg } = await import('pg');
const { buildSslConfig } = await import('./tls.js');

// --- row builders (camelCase demo data → snake_case columns) ---------------

function perCandidateOrdinal(rows) {
  const counter = new Map();
  return rows.map((r) => {
    const n = counter.get(r.candidateId) ?? 0;
    counter.set(r.candidateId, n + 1);
    return { ...r, ord: n };
  });
}

const userRows = [
  { id: 'user-demo', auth_user_id: null, email: 'recruiter@demo.local', name: 'Demo Recruiter', role: 'recruiter' },
];

const jobRows = seed.jobs.map((j) => ({
  id: j.id,
  title: j.title,
  department: j.department,
  location: j.location,
  employment_type: j.employmentType,
  status: j.status,
  experience_min: j.experienceMin ?? null,
  experience_max: j.experienceMax ?? null,
  description: j.description ?? '',
  created_by: j.createdBy ?? null,
  created_at: j.createdAt,
  updated_at: j.updatedAt ?? j.createdAt,
}));

// required skills first per job so bigserial ids reproduce the demo order.
const jobRequirementRows = seed.jobs.flatMap((j) => [
  ...j.requiredSkills.map((r) => ({
    job_id: j.id,
    skill: r.skill,
    category: 'required',
    min_years: r.minYears ?? null,
    note: r.note ?? null,
  })),
  ...j.preferredSkills.map((r) => ({
    job_id: j.id,
    skill: r.skill,
    category: 'preferred',
    min_years: r.minYears ?? null,
    note: r.note ?? null,
  })),
]);

const candidateRows = seed.candidates.map((c, i) => ({
  id: c.id,
  full_name: c.fullName,
  headline: c.headline,
  email: c.email ?? null,
  location: c.location ?? null,
  years_experience: c.yearsExperience ?? null,
  current_company: c.currentCompany ?? null,
  status: c.status ?? 'active',
  source: c.source ?? null,
  summary: c.summary ?? '',
  links: c.links ?? {},
  created_at: c.createdAt,
  updated_at: c.createdAt,
  ord: i, // preserves the demo array order (search corpus tie-breaks)
}));

const resumeRows = seed.resumes.map((r) => ({
  id: r.id,
  candidate_id: r.candidateId,
  filename: r.filename,
  mime_type: r.mimeType,
  file_size: r.fileSize ?? null,
  page_count: r.pageCount ?? null,
  storage_path: r.storagePath ?? null,
  uploaded_at: r.uploadedAt,
  status: r.status ?? 'received',
  sections: r.sections ?? [],
  full_text: r.fullText ?? null,
}));

const candidateSkillRows = perCandidateOrdinal(seed.candidateSkills).map((s) => ({
  candidate_id: s.candidateId,
  skill: s.skill,
  years: s.years ?? null,
  level: s.level ?? null,
  source: s.source ?? null,
  ord: s.ord,
}));

const experienceRows = perCandidateOrdinal(seed.experiences).map((e) => ({
  candidate_id: e.candidateId,
  company: e.company,
  title: e.title,
  start: e.start ?? null,
  end: e.end ?? null,
  location: e.location ?? null,
  summary: e.summary ?? '',
  highlights: e.highlights ?? [],
  ord: e.ord,
}));

const educationRows = perCandidateOrdinal(seed.education).map((e) => ({
  candidate_id: e.candidateId,
  institution: e.institution ?? e.school ?? null, // `school` in JS, `institution` in SQL
  degree: e.degree ?? null,
  year: e.year ?? null,
  start: e.start ?? null,
  end: e.end ?? null,
  detail: e.detail ?? null,
  ord: e.ord,
}));

const projectRows = perCandidateOrdinal(seed.projects).map((p) => ({
  candidate_id: p.candidateId,
  name: p.name,
  summary: p.summary ?? '',
  tech: p.tech ?? [],
  url: p.url ?? p.link ?? null, // `link` in JS, `url` in SQL
  ord: p.ord,
}));

const evidenceRows = seed.evidence.map((e) => ({
  id: e.id,
  candidate_id: e.candidateId,
  skill: e.skill,
  source_type: e.sourceType ?? null,
  source_id: e.sourceId ?? null,
  source_name: e.sourceName ?? null,
  excerpt: e.excerpt ?? '',
  location: e.location ?? null,
  status: e.status,
  extractor: e.extractor ?? null,
  notes: e.notes ?? null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: e.createdAt,
}));

const assessmentRows = seed.assessments.map((a) => ({
  id: a.id,
  title: a.title,
  skill: a.skill,
  difficulty: a.difficulty ?? 'medium',
  description: a.description ?? '',
  instructions: a.instructions ?? '',
  time_limit_minutes: a.timeLimitMinutes ?? 45,
  status: a.status ?? 'draft',
  execution_mode: a.executionMode ?? 'manual_review',
  test_cases: a.testCases ?? [],
  created_at: a.createdAt,
}));

const submissionRows = seed.assessmentSubmissions.map((s) => ({
  id: s.id,
  assessment_id: s.assessmentId,
  candidate_id: s.candidateId,
  submitted_at: s.submittedAt,
  status: s.status,
  score: s.score ?? null,
  execution_mode: s.executionMode ?? null,
  result: s.result ?? {},
}));

const applicationRows = seed.applications.map((a) => ({
  id: a.id,
  candidate_id: a.candidateId,
  job_id: a.jobId,
  stage: a.stage,
  created_at: a.createdAt,
  updated_at: a.updatedAt ?? a.createdAt,
}));

const searchEventRows = seed.searchEvents.map((s) => ({
  id: s.id,
  query: s.query,
  mode: s.mode,
  result_count: s.resultCount ?? null,
  created_at: s.createdAt,
}));

const auditLogRows = seed.auditLogs.map((a) => ({
  id: a.id,
  actor: a.actor,
  action: a.action,
  entity_type: a.entityType,
  entity_id: a.entityId,
  metadata: a.metadata ?? {},
  created_at: a.createdAt,
}));

// FK-safe order (parents first).
const ENTITIES = [
  { table: 'users', rows: userRows, conflict: ['id'], jsonb: [] },
  { table: 'jobs', rows: jobRows, conflict: ['id'], jsonb: [] },
  { table: 'job_requirements', rows: jobRequirementRows, conflict: ['job_id', 'skill', 'category'], jsonb: [] },
  { table: 'candidates', rows: candidateRows, conflict: ['id'], jsonb: ['links'] },
  { table: 'resumes', rows: resumeRows, conflict: ['id'], jsonb: ['sections'] },
  { table: 'candidate_skills', rows: candidateSkillRows, conflict: ['candidate_id', 'skill'], jsonb: [] },
  { table: 'experiences', rows: experienceRows, conflict: ['candidate_id', 'ord'], jsonb: ['highlights'] },
  { table: 'education', rows: educationRows, conflict: ['candidate_id', 'ord'], jsonb: [] },
  { table: 'projects', rows: projectRows, conflict: ['candidate_id', 'ord'], jsonb: ['tech'] },
  { table: 'candidate_evidence', rows: evidenceRows, conflict: ['id'], jsonb: ['location'] },
  { table: 'assessments', rows: assessmentRows, conflict: ['id'], jsonb: ['test_cases'] },
  { table: 'assessment_submissions', rows: submissionRows, conflict: ['id'], jsonb: ['result'] },
  { table: 'applications', rows: applicationRows, conflict: ['id'], jsonb: [] },
  { table: 'search_events', rows: searchEventRows, conflict: ['id'], jsonb: [] },
  { table: 'audit_logs', rows: auditLogRows, conflict: ['id'], jsonb: ['metadata'] },
];

const COUNT_TABLES = [
  'users',
  'jobs',
  'job_requirements',
  'candidates',
  'resumes',
  'candidate_skills',
  'experiences',
  'education',
  'projects',
  'candidate_evidence',
  'assessments',
  'assessment_submissions',
  'applications',
  'search_events',
  'audit_logs',
  'evidence_embeddings', // optional migration (002) — skipped if absent
];

// --- upsert engine ----------------------------------------------------------

async function upsert(client, { table, rows, conflict, jsonb }) {
  if (!rows.length) return 0;
  const columns = Object.keys(rows[0]);
  const params = [];
  const tuples = rows.map(
    (r) =>
      `(${columns
        .map((c) => {
          const v = r[c];
          params.push(jsonb.includes(c) ? (v == null ? null : JSON.stringify(v)) : v ?? null);
          return `$${params.length}`;
        })
        .join(', ')})`
  );
  const q = (c) => `"${c}"`; // quote identifiers — `end` is a reserved word
  const updates = columns.filter((c) => !conflict.includes(c));
  const action = updates.length
    ? `do update set ${updates.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`
    : 'do nothing';
  const text = `insert into ${table} (${columns.map(q).join(', ')}) values ${tuples.join(
    ', '
  )} on conflict (${conflict.map(q).join(', ')}) ${action}`;
  const res = await client.query(text, params);
  return res.rowCount;
}

async function printCounts(pool) {
  console.log('row counts:');
  const { rows: regRows } = await pool.query(
    "select to_regclass('public.evidence_embeddings') as reg"
  );
  const reg = regRows[0]?.reg;
  for (const table of COUNT_TABLES) {
    if (table === 'evidence_embeddings' && !reg) {
      console.log(`  ${table.padEnd(24)} (not present — optional migration 002 not applied)`);
      continue;
    }
    const { rows } = await pool.query(`select count(*)::int as n from ${table}`);
    console.log(`  ${table.padEnd(24)} ${rows[0].n}`);
  }
}

async function main() {
  const force = process.argv.includes('--force');

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
    const { rows: probe } = await pool.query(
      "select to_regclass('public.jobs') as jobs, to_regclass('public.candidates') as candidates"
    );
    if (!probe[0].jobs || !probe[0].candidates) {
      console.error('✗ schema not migrated — run `node database/run-migrations.js` first.');
      return 1;
    }

    const { rows: jobCount } = await pool.query('select count(*)::int as n from jobs');
    const hasJobs = Number(jobCount[0].n) > 0;

    if (hasJobs && !force) {
      // Still ensure the demo user exists — fixed id, upsert-only, never deletes.
      const client = await pool.connect();
      try {
        await client.query('begin');
        await upsert(client, ENTITIES[0]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      console.log(
        `skipped — already seeded (jobs table has ${jobCount[0].n} row(s)); ` +
          'nothing was deleted. Run with --force to re-upsert the demo dataset.'
      );
    } else {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const entity of ENTITIES) {
          const n = await upsert(client, entity);
          console.log(`  upserted ${String(n).padStart(3)} row(s) → ${entity.table}`);
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      console.log('seeded — demo dataset upserted (ids preserved, no rows deleted).');
    }

    await printCounts(pool);
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(`✗ seed failed: ${err.message}`);
  process.exitCode = 1;
}
