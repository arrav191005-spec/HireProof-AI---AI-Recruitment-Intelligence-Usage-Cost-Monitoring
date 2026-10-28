// ---------------------------------------------------------------------------
// PostgreSQL repository backend.
//
// Implements the exact same contract as lib/repo/memory.js (the reference
// implementation): every method returns the same object shapes, key sets and
// list orders. lib/repo/index.js selects this backend when DATABASE_URL is
// set and the probe (getBackendInfo) succeeds; otherwise the app falls back
// to the in-memory demo store.
//
// Rules honoured here:
//   - relative imports with explicit `.js` (no `@/` alias) so the module also
//     loads under plain `node` (database/smoke-test.js, migration scripts);
//   - one shared Pool (max 3, idle 30s, connect 10s, TLS via database/tls.js);
//   - parameterised SQL only — no string-interpolated values;
//   - descriptive errors: if the schema is missing, every method throws
//     "... schema not migrated ..." so index.js falls back to memory;
//   - camelCase in JS over snake_case in SQL, mapped explicitly per row;
//   - `end` is a PostgreSQL reserved word → always quoted as "end";
//   - numeric/bigint columns arrive as strings from node-postgres → Number().
//
// Timing note: memory.js returns ISO strings built with new Date() (millis);
// this backend returns Date#toISOString() — identical format. The smoke test
// normalises timestamp VALUES (they can never match) but compares key sets.
// ---------------------------------------------------------------------------
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildSslConfig } from '../../database/tls.js';

const { Pool } = pg;

let pool = null;
let schemaChecked = false;

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — PostgreSQL backend unavailable');
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: buildSslConfig(),
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('[hireproof] idle client error:', err.message));
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    schemaChecked = false;
    await p.end();
  }
}

// Every public method funnels through this so a missing/misapplied schema is
// reported up front with the phrase lib/repo/index.js (and humans) look for.
async function ensureSchema() {
  if (schemaChecked) return;
  const { rows } = await getPool().query("select to_regclass('public.jobs') as jobs");
  if (!rows[0]?.jobs) {
    throw new Error(
      'schema not migrated — run `node database/run-migrations.js` (npm run db:migrate) first'
    );
  }
  schemaChecked = true;
}

const q = (text, params) => getPool().query(text, params);

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Runtime-created ids: `${prefix}-${8 hex chars}` (demo ids are preserved
// verbatim by the seed, so this never collides with them).
const shortId = (prefix) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const num = (v) => (v == null ? null : Number(v));
const str = (v) => (v == null ? null : JSON.stringify(v));

// ---------------------------------------------------------------------------
// Row mappers — return EXACTLY the key sets memory.js exposes.
// ---------------------------------------------------------------------------
function mapJobBase(r) {
  return {
    id: r.id,
    title: r.title,
    department: r.department,
    location: r.location,
    employmentType: r.employment_type,
    status: r.status,
    experienceMin: r.experience_min,
    experienceMax: r.experience_max,
    description: r.description,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const mapRequirement = (r) => ({
  skill: r.skill,
  minYears: num(r.min_years),
  note: r.note,
});

// requiredSkills/preferredSkills entries in memory have NO category key;
// getJobRequirements is the one place that adds it.
function attachRequirements(job, reqRows) {
  job.requiredSkills = reqRows
    .filter((r) => r.category === 'required')
    .map(mapRequirement);
  job.preferredSkills = reqRows
    .filter((r) => r.category === 'preferred')
    .map(mapRequirement);
  return job;
}

function mapCandidate(r) {
  // NOTE: no `updatedAt` — memory candidates (from demo data) never carry one.
  return {
    id: r.id,
    fullName: r.full_name,
    headline: r.headline,
    email: r.email,
    location: r.location,
    yearsExperience: num(r.years_experience),
    currentCompany: r.current_company,
    status: r.status,
    source: r.source,
    summary: r.summary,
    links: r.links ?? {},
    createdAt: iso(r.created_at),
  };
}

const mapSkill = (r) => ({
  candidateId: r.candidate_id,
  skill: r.skill,
  years: num(r.years),
  level: r.level,
  source: r.source,
});

const mapExperience = (r) => ({
  candidateId: r.candidate_id,
  company: r.company,
  title: r.title,
  start: r.start,
  end: r.end,
  location: r.location,
  summary: r.summary,
  highlights: r.highlights ?? [],
});

function mapEducation(r) {
  // demo data only has {candidateId, degree, school, year}; start/end/detail
  // exist for extracted resumes and are only returned when set.
  const out = {
    candidateId: r.candidate_id,
    degree: r.degree,
    school: r.institution, // `institution` in SQL, `school` in JS
    year: r.year,
  };
  if (r.start != null) out.start = r.start;
  if (r.end != null) out.end = r.end;
  if (r.detail != null) out.detail = r.detail;
  return out;
}

const mapProject = (r) => ({
  candidateId: r.candidate_id,
  name: r.name,
  summary: r.summary,
  tech: r.tech ?? [],
  link: r.url, // `url` in SQL, `link` in JS
});

function mapResume(r) {
  if (!r) return null;
  const out = {
    id: r.id,
    candidateId: r.candidate_id,
    filename: r.filename,
    mimeType: r.mime_type,
    fileSize: num(r.file_size),
    pageCount: r.page_count,
    uploadedAt: iso(r.uploaded_at),
    status: r.status,
    sections: r.sections ?? [],
  };
  // demo resumes carry neither key — only extracted uploads do.
  if (r.storage_path != null) out.storagePath = r.storage_path;
  if (r.full_text != null) out.fullText = r.full_text;
  return out;
}

function mapEvidence(r) {
  const out = {
    id: r.id,
    candidateId: r.candidate_id,
    skill: r.skill,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceName: r.source_name,
    excerpt: r.excerpt,
    location: r.location ?? null,
    status: r.status,
    extractor: r.extractor,
    notes: r.notes,
    createdAt: iso(r.created_at),
  };
  // Demo evidence has no review keys; they appear only once reviewed.
  if (r.reviewed_by != null) out.reviewedBy = r.reviewed_by;
  if (r.reviewed_at != null) out.reviewedAt = iso(r.reviewed_at);
  return out;
}

function mapAssessment(r) {
  // NOTE: no `updatedAt` — demo assessments never carry one.
  return {
    id: r.id,
    title: r.title,
    skill: r.skill,
    difficulty: r.difficulty,
    status: r.status,
    timeLimitMinutes: r.time_limit_minutes,
    description: r.description,
    instructions: r.instructions,
    testCases: r.test_cases ?? [],
    executionMode: r.execution_mode,
    createdAt: iso(r.created_at),
  };
}

const mapSubmission = (r) => ({
  id: r.id,
  assessmentId: r.assessment_id,
  candidateId: r.candidate_id,
  submittedAt: iso(r.submitted_at),
  status: r.status,
  score: num(r.score),
  executionMode: r.execution_mode,
  result: r.result ?? {},
});

const mapApplication = (r) => ({
  id: r.id,
  candidateId: r.candidate_id,
  jobId: r.job_id,
  stage: r.stage,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const mapSearchEvent = (r) => ({
  id: r.id,
  query: r.query,
  mode: r.mode,
  resultCount: r.result_count,
  createdAt: iso(r.created_at),
});

const mapAuditLog = (r) => ({
  id: r.id,
  actor: r.actor,
  action: r.action,
  entityType: r.entity_type,
  entityId: r.entity_id,
  metadata: r.metadata ?? {},
  createdAt: iso(r.created_at),
});

// ---------------------------------------------------------------------------
// Pagination — identical semantics to memory.js paginate().
// ---------------------------------------------------------------------------
function paginate(items, page, pageSize) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((p - 1) * pageSize, p * pageSize), total, page: p, pageCount };
}

function clampPage(total, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { p: Math.min(Math.max(1, page), pageCount), pageCount };
}

// Shared fragment: case-insensitive substring match, parameterised.
const matchesSql = (col, p) => `position(lower($${p}) in lower(coalesce(${col}, ''))) > 0`;

const REQ_ORDER = "case category when 'required' then 0 else 1 end, id";

async function requirementsFor(jobIds) {
  if (!jobIds.length) return new Map();
  const { rows } = await q(
    `select job_id, skill, min_years, note, category
       from job_requirements
      where job_id = any($1::text[])
      order by ${REQ_ORDER}`,
    [jobIds]
  );
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.job_id)) grouped.set(r.job_id, []);
    grouped.get(r.job_id).push(r);
  }
  return grouped;
}

async function fullJob(row) {
  const grouped = await requirementsFor([row.id]);
  return attachRequirements(mapJobBase(row), grouped.get(row.id) ?? []);
}

// ---------------------------------------------------------------------------
// Backend implementation
// ---------------------------------------------------------------------------
const postgres = {
  async getBackendInfo() {
    await ensureSchema();
    const { rows } = await q("select created_at from users where id = 'user-demo'");
    return {
      backend: 'postgres',
      label: 'PostgreSQL (Supabase)',
      persistent: true,
      seededAt: rows[0] ? iso(rows[0].created_at) : null,
    };
  },

  // -- Jobs ------------------------------------------------------------------
  async listJobs({ status, q: query, page = 1, pageSize = 20 } = {}) {
    await ensureSchema();
    const statusParam = status && status !== 'all' ? status : null;
    const qParam = query ? String(query) : null;
    const where = `($1::text is null or status = $1)
       and ($2::text is null
            or ${matchesSql('title', 2)}
            or ${matchesSql('department', 2)}
            or ${matchesSql('location', 2)}
            or ${matchesSql('description', 2)})`;
    const params = [statusParam, qParam];

    const { rows: countRows } = await q(`select count(*)::int as n from jobs where ${where}`, params);
    const total = countRows[0].n;
    const { p, pageCount } = clampPage(total, page, pageSize);
    const { rows } = await q(
      `select * from jobs where ${where}
        order by created_at desc, id desc
        limit $3 offset $4`,
      [...params, pageSize, (p - 1) * pageSize]
    );
    const grouped = await requirementsFor(rows.map((r) => r.id));
    const items = rows.map((r) => attachRequirements(mapJobBase(r), grouped.get(r.id) ?? []));
    return { items, total, page: p, pageCount };
  },

  async getJob(id) {
    await ensureSchema();
    const { rows } = await q('select * from jobs where id = $1', [id]);
    if (!rows[0]) return null;
    return fullJob(rows[0]);
  },

  async getJobRequirements(jobId) {
    await ensureSchema();
    const { rows: jobRows } = await q('select 1 from jobs where id = $1', [jobId]);
    if (!jobRows[0]) return null; // memory returns null for unknown jobs
    const { rows } = await q(
      `select skill, min_years, note, category
         from job_requirements where job_id = $1 order by ${REQ_ORDER}`,
      [jobId]
    );
    return rows.map((r) => ({ ...mapRequirement(r), category: r.category }));
  },

  async createJob(data) {
    await ensureSchema();
    const id = shortId('job');
    await withTransaction(async (client) => {
      await client.query(
        `insert into jobs (id, title, department, location, employment_type, status,
                           experience_min, experience_max, description, created_by,
                           created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())`,
        [
          id,
          data.title,
          data.department ?? 'Engineering',
          data.location ?? 'Remote',
          data.employmentType ?? 'Full-time',
          data.status ?? 'draft',
          data.experienceMin ?? null,
          data.experienceMax ?? null,
          data.description ?? '',
          'Demo Recruiter', // matches memory.js createJob
        ]
      );
      // required first so bigserial ids keep the natural order.
      const reqs = [
        ...(data.requiredSkills ?? []).map((r) => ['required', r]),
        ...(data.preferredSkills ?? []).map((r) => ['preferred', r]),
      ];
      for (const [category, r] of reqs) {
        await client.query(
          `insert into job_requirements (job_id, skill, category, min_years, note)
           values ($1, $2, $3, $4, $5)`,
          [id, r.skill, category, r.minYears ?? null, r.note ?? null]
        );
      }
    });
    return this.getJob(id);
  },

  async updateJob(id, patch) {
    await ensureSchema();
    const { rows } = await q('select * from jobs where id = $1', [id]);
    if (!rows[0]) return null;

    const COLUMN_OF = {
      title: 'title',
      department: 'department',
      location: 'location',
      employmentType: 'employment_type',
      status: 'status',
      experienceMin: 'experience_min',
      experienceMax: 'experience_max',
      description: 'description',
    };
    const sets = ['updated_at = now()'];
    const params = [];
    for (const [key, col] of Object.entries(COLUMN_OF)) {
      if (key in patch && patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }

    await withTransaction(async (client) => {
      params.push(id);
      await client.query(`update jobs set ${sets.join(', ')} where id = $${params.length}`, params);
      // Skills patches replace the whole category (arrays carry their own order).
      for (const [key, category] of [
        ['requiredSkills', 'required'],
        ['preferredSkills', 'preferred'],
      ]) {
        if (key in patch && patch[key] !== undefined) {
          await client.query('delete from job_requirements where job_id = $1 and category = $2', [
            id,
            category,
          ]);
          for (const r of patch[key]) {
            await client.query(
              `insert into job_requirements (job_id, skill, category, min_years, note)
               values ($1, $2, $3, $4, $5)`,
              [id, r.skill, category, r.minYears ?? null, r.note ?? null]
            );
          }
        }
      }
    });
    return this.getJob(id);
  },

  // -- Candidates ------------------------------------------------------------
  async listCandidates({
    q: query,
    skill,
    minYears,
    maxYears,
    evidenceStatus,
    page = 1,
    pageSize = 10,
    sort = 'recent',
  } = {}) {
    await ensureSchema();
    const qParam = query ? String(query) : null;
    const skillParam = skill ? String(skill) : null;
    const minParam = minYears != null && minYears !== '' ? Number(minYears) : null;
    const maxParam = maxYears != null && maxYears !== '' ? Number(maxYears) : null;
    // coalesce to 0 reproduces memory's JS semantics for null years
    // (null >= 0 → true, null >= 1 → false).
    const where = `($1::text is null
            or ${matchesSql('c.full_name', 1)}
            or ${matchesSql('c.headline', 1)}
            or ${matchesSql('c.summary', 1)}
            or ${matchesSql('c.current_company', 1)}
            or exists (select 1 from candidate_skills s
                        where s.candidate_id = c.id and ${matchesSql('s.skill', 1)}))
       and ($2::text is null
            or exists (select 1 from candidate_skills s2
                        where s2.candidate_id = c.id and lower(s2.skill) = lower($2)))
       and ($3::numeric is null or coalesce(c.years_experience, 0) >= $3)
       and ($4::numeric is null or coalesce(c.years_experience, 0) <= $4)
       and ($5::text is null
            or exists (select 1 from candidate_evidence e
                        where e.candidate_id = c.id and e.status = $5))`;
    // `''` means "no filter" in the UI (e.g. the "Any" option) and memory.js
    // treats it as falsy — normalise so both backends agree.
    const params = [qParam, skillParam, minParam, maxParam, evidenceStatus || null];

    const orderBy =
      sort === 'experience'
        ? 'coalesce(c.years_experience, 0) desc, c.ord asc'
        : sort === 'name'
          ? 'lower(c.full_name) asc, c.ord asc'
          : 'c.created_at desc, c.ord asc'; // `recent` (default) — ord = demo order

    const { rows: countRows } = await q(
      `select count(*)::int as n from candidates c where ${where}`,
      params
    );
    const total = countRows[0].n;
    const { p, pageCount } = clampPage(total, page, pageSize);
    const { rows } = await q(
      `select c.* from candidates c where ${where}
        order by ${orderBy}
        limit $6 offset $7`,
      [...params, pageSize, (p - 1) * pageSize]
    );

    let skillsByCandidate = new Map();
    if (rows.length) {
      const { rows: skillRows } = await q(
        `select candidate_id, skill, years, level, source from candidate_skills
          where candidate_id = any($1::text[]) order by ord, skill`,
        [rows.map((r) => r.id)]
      );
      for (const r of skillRows) {
        if (!skillsByCandidate.has(r.candidate_id)) skillsByCandidate.set(r.candidate_id, []);
        skillsByCandidate.get(r.candidate_id).push(mapSkill(r));
      }
    }

    const items = rows.map((r) => ({
      ...mapCandidate(r),
      skills: skillsByCandidate.get(r.id) ?? [],
    }));
    return { items, total, page: p, pageCount };
  },

  async getCandidate(id) {
    await ensureSchema();
    const { rows } = await q('select * from candidates where id = $1', [id]);
    if (!rows[0]) return null;
    const candidateId = rows[0].id;

    const [{ rows: skills }, { rows: experiences }, { rows: education }, { rows: projects }, { rows: resumes }] =
      await Promise.all([
        q('select candidate_id, skill, years, level, source from candidate_skills where candidate_id = $1 order by ord, skill', [candidateId]),
        q('select candidate_id, company, title, start, "end", location, summary, highlights from experiences where candidate_id = $1 order by ord', [candidateId]),
        q('select candidate_id, institution, degree, year, start, "end", detail from education where candidate_id = $1 order by ord', [candidateId]),
        q('select candidate_id, name, summary, tech, url from projects where candidate_id = $1 order by ord', [candidateId]),
        q('select * from resumes where candidate_id = $1 order by uploaded_at asc, id asc limit 1', [candidateId]),
      ]);

    return {
      ...mapCandidate(rows[0]),
      skills: skills.map(mapSkill),
      experience: experiences.map(mapExperience),
      education: education.map(mapEducation),
      projects: projects.map(mapProject),
      resume: mapResume(resumes[0] ?? null),
    };
  },

  async createCandidateFromExtraction(data) {
    await ensureSchema();
    const slug = String(data.fullName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return withTransaction(async (client) => {
      // Slug ids collide when two candidates share a name — suffix instead of
      // overwriting the first profile (same loop as memory.js).
      let id = `cand-${slug || shortId('cand').slice(5)}`;
      for (let n = 2; ; n += 1) {
        const { rows } = await client.query('select 1 from candidates where id = $1', [id]);
        if (!rows[0]) break;
        id = `cand-${slug || 'candidate'}-${n}`;
      }

      const { rows: ordRows } = await client.query(
        'select coalesce(max(ord), 0) + 1 as next from candidates'
      );
      const { rows: inserted } = await client.query(
        `insert into candidates (id, full_name, headline, email, location, years_experience,
                                 current_company, status, source, summary, links,
                                 created_at, updated_at, ord)
         values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, now(), now(), $11)
         returning *`,
        [
          id,
          data.fullName,
          data.headline ?? 'Candidate',
          data.email ?? null,
          data.location ?? null,
          data.yearsExperience ?? null,
          data.currentCompany ?? null,
          data.source ?? 'Resume upload',
          data.summary ?? '',
          str(data.links ?? {}),
          ordRows[0].next,
        ]
      );

      if (data.resume) {
        const r = data.resume;
        await client.query(
          `insert into resumes (id, candidate_id, filename, mime_type, file_size, page_count,
                                storage_path, uploaded_at, status, sections, full_text)
           values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9, $10, $11)`,
          [
            shortId('res'),
            id,
            r.filename ?? null,
            r.mimeType ?? null,
            r.fileSize ?? null,
            r.pageCount ?? null,
            r.storagePath ?? null,
            r.uploadedAt ?? null,
            r.status ?? 'received',
            str(r.sections ?? []),
            r.fullText ?? null,
          ]
        );
      }

      for (const [i, sk] of (data.skills ?? []).entries()) {
        await client.query(
          `insert into candidate_skills (candidate_id, skill, years, level, source, ord)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, sk.skill, sk.years ?? null, sk.level ?? null, sk.source ?? null, i]
        );
      }
      for (const [i, e] of (data.experience ?? []).entries()) {
        await client.query(
          `insert into experiences (candidate_id, company, title, start, "end", location,
                                    summary, highlights, ord)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, e.company ?? null, e.title ?? null, e.start ?? null, e.end ?? null, e.location ?? null,
           e.summary ?? '', str(e.highlights ?? []), i]
        );
      }
      for (const [i, e] of (data.education ?? []).entries()) {
        await client.query(
          `insert into education (candidate_id, institution, degree, year, start, "end", detail, ord)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, e.school ?? e.institution ?? null, e.degree ?? null, e.year ?? null,
           e.start ?? null, e.end ?? null, e.detail ?? null, i]
        );
      }
      for (const [i, p] of (data.projects ?? []).entries()) {
        await client.query(
          `insert into projects (candidate_id, name, summary, tech, url, ord)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, p.name ?? null, p.summary ?? '', str(p.tech ?? []), p.link ?? p.url ?? null, i]
        );
      }
      for (const ev of data.evidence ?? []) {
        await client.query(
          `insert into candidate_evidence (id, candidate_id, skill, source_type, source_id,
                                           source_name, excerpt, location, status, extractor,
                                           notes, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
          [
            shortId('ev'), id, ev.skill, ev.sourceType ?? null, ev.sourceId ?? null,
            ev.sourceName ?? null, ev.excerpt ?? '', str(ev.location ?? null), ev.status,
            ev.extractor ?? null, ev.notes ?? null,
          ]
        );
      }

      return mapCandidate(inserted[0]);
    });
  },

  async getCandidateSkills(candidateId) {
    await ensureSchema();
    const { rows } = await q(
      'select candidate_id, skill, years, level, source from candidate_skills where candidate_id = $1 order by ord, skill',
      [candidateId]
    );
    return rows.map(mapSkill);
  },

  async getCandidateEvidence(candidateId) {
    await ensureSchema();
    const { rows } = await q(
      'select * from candidate_evidence where candidate_id = $1 order by id',
      [candidateId]
    );
    return rows.map(mapEvidence);
  },

  async updateEvidence(evidenceId, patch) {
    await ensureSchema();
    const { rows } = await q('select * from candidate_evidence where id = $1', [evidenceId]);
    if (!rows[0]) return null;
    const sets = ['reviewed_at = now()'];
    const params = [];
    // Prefer the real signed-in reviewer; demo mode has no session so it falls
    // back to the labelled demo name (memory.js parity).
    params.push(patch.reviewedBy ?? 'Demo Recruiter');
    sets.push(`reviewed_by = $${params.length}`);
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.notes !== undefined) {
      params.push(patch.notes ?? null);
      sets.push(`notes = $${params.length}`);
    }
    params.push(evidenceId);
    const { rows: updated } = await q(
      `update candidate_evidence set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return mapEvidence(updated[0]);
  },

  async addEvidence(data) {
    await ensureSchema();
    // Build the returned object with memory.js semantics (defaults first, then
    // `...data`), so the key set matches exactly — including NOT having a
    // `location` key when the caller did not pass one.
    const ev = {
      id: shortId('ev'),
      status: 'supporting',
      extractor: 'human',
      sourceType: 'manual',
      sourceName: 'Manual note',
      createdAt: new Date().toISOString(),
    };
    Object.assign(ev, data);

    await q(
      `insert into candidate_evidence (id, candidate_id, skill, source_type, source_id,
                                       source_name, excerpt, location, status, extractor,
                                       notes, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        ev.id,
        ev.candidateId,
        ev.skill,
        ev.sourceType ?? null,
        ev.sourceId ?? null,
        ev.sourceName ?? null,
        ev.excerpt ?? '',
        str(ev.location ?? null),
        ev.status ?? 'supporting',
        ev.extractor ?? null,
        ev.notes ?? null,
        ev.createdAt,
      ]
    );
    return ev;
  },

  async getCandidateSubmissions(candidateId) {
    await ensureSchema();
    const { rows } = await q(
      'select * from assessment_submissions where candidate_id = $1 order by submitted_at, id',
      [candidateId]
    );
    const assessmentIds = [...new Set(rows.map((r) => r.assessment_id))];
    const assessments = new Map();
    if (assessmentIds.length) {
      const { rows: aRows } = await q('select * from assessments where id = any($1::text[])', [
        assessmentIds,
      ]);
      for (const a of aRows) assessments.set(a.id, mapAssessment(a));
    }
    return rows.map((r) => ({
      ...mapSubmission(r),
      assessment: assessments.get(r.assessment_id) ?? null,
    }));
  },

  async getCandidateApplications(candidateId) {
    await ensureSchema();
    const { rows } = await q(
      'select * from applications where candidate_id = $1 order by id',
      [candidateId]
    );
    const jobIds = [...new Set(rows.map((r) => r.job_id))];
    const jobs = new Map();
    if (jobIds.length) {
      const grouped = await requirementsFor(jobIds);
      const { rows: jRows } = await q('select * from jobs where id = any($1::text[])', [jobIds]);
      for (const j of jRows) jobs.set(j.id, attachRequirements(mapJobBase(j), grouped.get(j.id) ?? []));
    }
    return rows.map((r) => ({ ...mapApplication(r), job: jobs.get(r.job_id) ?? null }));
  },

  async getJobApplications(jobId) {
    await ensureSchema();
    const { rows } = await q('select * from applications where job_id = $1 order by id', [jobId]);
    const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];
    const candidates = new Map();
    if (candidateIds.length) {
      const { rows: cRows } = await q('select * from candidates where id = any($1::text[])', [
        candidateIds,
      ]);
      for (const c of cRows) candidates.set(c.id, mapCandidate(c)); // raw candidate: no skills key
    }
    return rows.map((r) => ({ ...mapApplication(r), candidate: candidates.get(r.candidate_id) ?? null }));
  },

  async createApplication({ candidateId, jobId, stage = 'applied' }) {
    await ensureSchema();
    const { rows: existing } = await q(
      'select * from applications where candidate_id = $1 and job_id = $2',
      [candidateId, jobId]
    );
    if (existing[0]) return mapApplication(existing[0]); // memory.js returns the existing row
    const id = shortId('app');
    const { rows } = await q(
      `insert into applications (id, candidate_id, job_id, stage, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now()) returning *`,
      [id, candidateId, jobId, stage]
    );
    return mapApplication(rows[0]);
  },

  async updateApplicationStage(applicationId, stage) {
    await ensureSchema();
    const { rows } = await q(
      'update applications set stage = $2, updated_at = now() where id = $1 returning *',
      [applicationId, stage]
    );
    return rows[0] ? mapApplication(rows[0]) : null;
  },

  async updateCandidate(id, patch) {
    await ensureSchema();
    const { rows } = await q('select * from candidates where id = $1', [id]);
    if (!rows[0]) return null;
    const COLUMN_OF = {
      fullName: 'full_name',
      headline: 'headline',
      location: 'location',
      email: 'email',
      summary: 'summary',
      currentCompany: 'current_company',
      yearsExperience: 'years_experience',
    };
    const sets = ['updated_at = now()'];
    const params = [];
    for (const [key, col] of Object.entries(COLUMN_OF)) {
      if (key in patch && patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    params.push(id);
    const { rows: updated } = await q(
      `update candidates set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return mapCandidate(updated[0]);
  },

  // -- Assessments -----------------------------------------------------------
  async listAssessments() {
    await ensureSchema();
    const { rows } = await q(
      `select a.*,
              (select count(*)::int from assessment_submissions s where s.assessment_id = a.id)
                as submission_count
         from assessments a
        order by a.created_at asc, a.id asc`
    );
    return rows.map((r) => ({ ...mapAssessment(r), submissionCount: r.submission_count }));
  },

  async getAssessment(id) {
    await ensureSchema();
    const { rows } = await q('select * from assessments where id = $1', [id]);
    if (!rows[0]) return null;
    const { rows: subs } = await q(
      'select * from assessment_submissions where assessment_id = $1 order by submitted_at, id',
      [id]
    );
    const candidateIds = [...new Set(subs.map((s) => s.candidate_id))];
    const candidates = new Map();
    if (candidateIds.length) {
      const { rows: cRows } = await q('select * from candidates where id = any($1::text[])', [
        candidateIds,
      ]);
      for (const c of cRows) candidates.set(c.id, mapCandidate(c));
    }
    return {
      ...mapAssessment(rows[0]),
      submissions: subs.map((s) => ({
        ...mapSubmission(s),
        candidate: candidates.get(s.candidate_id) ?? null,
      })),
    };
  },

  async createAssessment(data) {
    await ensureSchema();
    const id = shortId('asmt');
    const { rows } = await q(
      `insert into assessments (id, title, skill, difficulty, description, instructions,
                                time_limit_minutes, status, execution_mode, test_cases,
                                created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now()) returning *`,
      [
        id,
        data.title,
        data.skill,
        data.difficulty ?? 'medium',
        data.description ?? '',
        data.instructions ?? '',
        data.timeLimitMinutes ?? 45,
        data.status ?? 'draft',
        data.executionMode ?? 'manual_review',
        str(data.testCases ?? []),
      ]
    );
    return mapAssessment(rows[0]);
  },

  async createSubmission(data) {
    await ensureSchema();
    const id = shortId('sub');
    const { rows } = await q(
      `insert into assessment_submissions (id, assessment_id, candidate_id, submitted_at,
                                           status, score, execution_mode, result)
       values ($1, $2, $3, now(), $4, $5, $6, $7) returning *`,
      [
        id,
        data.assessmentId,
        data.candidateId,
        data.status ?? 'manual_review',
        data.score ?? null,
        data.executionMode ?? 'static_checks',
        str(
          data.result ?? {
            staticChecks: { passed: [], warnings: [] },
            testCaseResults: [],
            reviewerNote: null,
          }
        ),
      ]
    );
    return mapSubmission(rows[0]);
  },

  async updateSubmission(id, patch) {
    await ensureSchema();
    const { rows } = await q('select * from assessment_submissions where id = $1', [id]);
    if (!rows[0]) return null;
    const COLUMN_OF = { status: 'status', score: 'score', result: 'result' };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(COLUMN_OF)) {
      if (key in patch && patch[key] !== undefined) {
        params.push(key === 'result' ? str(patch[key]) : patch[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return mapSubmission(rows[0]);
    params.push(id);
    const { rows: updated } = await q(
      `update assessment_submissions set ${sets.join(', ')} where id = $${params.length} returning *`,
      params
    );
    return mapSubmission(updated[0]);
  },

  async listSubmissions({ assessmentId, candidateId } = {}) {
    await ensureSchema();
    const { rows } = await q(
      `select * from assessment_submissions
        where ($1::text is null or assessment_id = $1)
          and ($2::text is null or candidate_id = $2)
        order by submitted_at, id`,
      [assessmentId ?? null, candidateId ?? null]
    );
    const assessmentIds = [...new Set(rows.map((r) => r.assessment_id))];
    const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];
    const assessments = new Map();
    const candidates = new Map();
    if (assessmentIds.length) {
      const { rows: aRows } = await q('select * from assessments where id = any($1::text[])', [assessmentIds]);
      for (const a of aRows) assessments.set(a.id, mapAssessment(a));
    }
    if (candidateIds.length) {
      const { rows: cRows } = await q('select * from candidates where id = any($1::text[])', [candidateIds]);
      for (const c of cRows) candidates.set(c.id, mapCandidate(c));
    }
    return rows.map((r) => ({
      ...mapSubmission(r),
      assessment: assessments.get(r.assessment_id) ?? null,
      candidate: candidates.get(r.candidate_id) ?? null,
    }));
  },

  // -- Search events / analytics / audit --------------------------------------
  async recordSearchEvent({ query, mode, resultCount }) {
    await ensureSchema();
    const id = shortId('se');
    const { rows } = await q(
      `insert into search_events (id, query, mode, result_count, created_at)
       values ($1, $2, $3, $4, now()) returning *`,
      [id, query ?? null, mode ?? null, resultCount ?? null]
    );
    return mapSearchEvent(rows[0]);
  },

  async recentSearchEvents(limit = 8) {
    await ensureSchema();
    const { rows } = await q(
      'select * from search_events order by created_at desc, id desc limit $1',
      [limit]
    );
    return rows.map(mapSearchEvent);
  },

  async analyticsSummary() {
    await ensureSchema();
    const { rows: counts } = await q(`
      select
        (select count(*) from jobs where status = 'open')::int as open_jobs,
        (select count(*) from jobs)::int as total_jobs,
        (select count(*) from candidates)::int as total_candidates,
        (select count(*) from assessment_submissions where status = 'completed')::int as completed_assessments,
        (select count(*) from assessment_submissions where status = 'manual_review')::int as pending_submissions,
        (select count(*) from candidate_evidence where status in ('needs_review', 'claimed'))::int as pending_evidence,
        (select count(*) from applications)::int as total_applications,
        (select count(*) from search_events where created_at >= now() - interval '30 days')::int as searches_30d
    `);
    const c = counts[0];

    const { rows: stageRows } = await q(
      'select stage, count(*)::int as n from applications group by stage'
    );
    const byStage = Object.fromEntries(
      ['applied', 'screening', 'assessment', 'interview', 'offer', 'hired'].map((s) => [
        s,
        stageRows.find((r) => r.stage === s)?.n ?? 0,
      ])
    );

    const { rows: statusRows } = await q(
      'select status, count(*)::int as n from candidate_evidence group by status'
    );
    const evidenceByStatus = Object.fromEntries(
      ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review'].map((s) => [
        s,
        statusRows.find((r) => r.status === s)?.n ?? 0,
      ])
    );

    // Weekly series for the last 6 ISO weeks (Monday-anchored). The window
    // arithmetic matches memory.js — which computes it correctly; its
    // searchesLast30d (counted below) is the field where the two backends
    // intentionally differ: memory counts ALL events, postgres counts the
    // true last-30-days window.
    const [{ rows: appRows }, { rows: seRows }, { rows: resumeRows }] = await Promise.all([
      q('select created_at from applications'),
      q('select created_at from search_events'),
      q('select uploaded_at from resumes'),
    ]);
    const weeks = [];
    const msWeek = 7 * 24 * 3600 * 1000;
    const anchor = new Date();
    anchor.setUTCHours(0, 0, 0, 0);
    const dow = (anchor.getUTCDay() + 6) % 7; // Monday = 0
    anchor.setUTCDate(anchor.getUTCDate() - dow - 5 * 7); // Monday 5 weeks ago
    for (let i = 0; i < 6; i += 1) {
      const start = new Date(anchor.getTime() + i * msWeek);
      const end = new Date(start.getTime() + msWeek);
      weeks.push({
        weekStart: start.toISOString().slice(0, 10),
        label: start.toISOString().slice(5, 10),
        applications: appRows.filter((r) => r.created_at >= start && r.created_at < end).length,
        searches: seRows.filter((r) => r.created_at >= start && r.created_at < end).length,
        uploads: resumeRows.filter((r) => r.uploaded_at >= start && r.uploaded_at < end).length,
      });
    }

    return {
      openJobs: c.open_jobs,
      totalJobs: c.total_jobs,
      totalCandidates: c.total_candidates,
      completedAssessments: c.completed_assessments,
      pendingReviews: c.pending_submissions + c.pending_evidence,
      byStage,
      evidenceByStatus,
      totalApplications: c.total_applications,
      searchesLast30d: c.searches_30d,
      weeks,
    };
  },

  async logAudit({ action, entityType, entityId, metadata }) {
    await ensureSchema();
    const id = shortId('audit');
    const { rows } = await q(
      `insert into audit_logs (id, actor, action, entity_type, entity_id, metadata, created_at)
       values ($1, 'Demo Recruiter', $2, $3, $4, $5, now()) returning *`,
      [id, action, entityType, entityId, str(metadata ?? {})]
    );
    return mapAuditLog(rows[0]);
  },

  async recentAuditLogs(limit = 8) {
    await ensureSchema();
    const { rows } = await q(
      'select * from audit_logs order by created_at desc, id desc limit $1',
      [limit]
    );
    return rows.map(mapAuditLog);
  },

  // -- Search engine input ----------------------------------------------------
  // 8 keys per candidate, in the demo insertion order (candidates.ord).
  async searchCorpus() {
    await ensureSchema();
    const { rows: candRows } = await q('select * from candidates order by ord asc');
    const ids = candRows.map((r) => r.id);

    const [{ rows: skillRows }, { rows: evRows }, { rows: expRows }, { rows: projRows }, { rows: resRows }, { rows: subRows }, { rows: appRows }] =
      await Promise.all([
        q('select candidate_id, skill, years, level, source from candidate_skills where candidate_id = any($1::text[]) order by ord, skill', [ids]),
        q('select * from candidate_evidence where candidate_id = any($1::text[]) order by id', [ids]),
        q('select candidate_id, company, title, start, "end", location, summary, highlights from experiences where candidate_id = any($1::text[]) order by ord', [ids]),
        q('select candidate_id, name, summary, tech, url from projects where candidate_id = any($1::text[]) order by ord', [ids]),
        q('select * from resumes where candidate_id = any($1::text[]) order by uploaded_at asc, id asc', [ids]),
        q('select * from assessment_submissions where candidate_id = any($1::text[]) order by submitted_at, id', [ids]),
        q('select * from applications where candidate_id = any($1::text[]) order by id', [ids]),
      ]);

    const subAssessmentIds = [...new Set(subRows.map((r) => r.assessment_id))];
    const assessments = new Map();
    if (subAssessmentIds.length) {
      const { rows: aRows } = await q('select * from assessments where id = any($1::text[])', [
        subAssessmentIds,
      ]);
      for (const a of aRows) assessments.set(a.id, mapAssessment(a));
    }

    const byCandidate = (rows) => {
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.candidate_id)) map.set(r.candidate_id, []);
        map.get(r.candidate_id).push(r);
      }
      return map;
    };
    const skillsMap = byCandidate(skillRows);
    const evMap = byCandidate(evRows);
    const expMap = byCandidate(expRows);
    const projMap = byCandidate(projRows);
    const subMap = byCandidate(subRows);
    const appMap = byCandidate(appRows);
    const resumeMap = new Map();
    for (const r of resRows) if (!resumeMap.has(r.candidate_id)) resumeMap.set(r.candidate_id, r);

    return candRows.map((c) => ({
      candidate: mapCandidate(c),
      skills: (skillsMap.get(c.id) ?? []).map(mapSkill),
      evidence: (evMap.get(c.id) ?? []).map(mapEvidence),
      experience: (expMap.get(c.id) ?? []).map(mapExperience),
      projects: (projMap.get(c.id) ?? []).map(mapProject),
      resume: mapResume(resumeMap.get(c.id) ?? null),
      submissions: (subMap.get(c.id) ?? []).map((s) => ({
        ...mapSubmission(s),
        assessment: assessments.get(s.assessment_id) ?? null,
      })),
      applications: (appMap.get(c.id) ?? []).map(mapApplication),
    }));
  },
};

export { ensureSchema };
export default postgres;
