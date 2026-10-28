-- ---------------------------------------------------------------------------
-- HireProof AI — 001: initial application schema
--
-- Applied by `node database/run-migrations.js` (one transaction per file).
-- Design notes:
--
--  * Naming: JavaScript uses camelCase, PostgreSQL uses snake_case.
--    lib/repo/postgres.js maps between the two so both repository backends
--    (memory / postgres) return identical shapes — see lib/repo/memory.js,
--    the reference implementation.
--  * Keys: text primary keys preserve the exact ids from lib/demo-data.js
--    (job-junior-fullstack, cand-ava-thompson, ev-ava-1, …) so the search
--    evaluation dataset (tests/search-eval.json) behaves identically on both
--    backends. Rows created at runtime use `${prefix}-${uuid[0..8]}`.
--  * Ordering: several tables carry an internal `ord` column that reproduces
--    the insertion order of the in-memory store (which is observable through
--    list/corpus ordering and search tie-breaks). `ord` is never returned.
--  * JSONB columns (links, sections, highlights, tech, location, test_cases,
--    result, metadata) are parsed to JS objects by node-postgres.
--  * SECURITY — the Supabase public schema is exposed over PostgREST with the
--    publishable (anon) key, so every table here gets:
--      1. ROW LEVEL SECURITY enabled with no policies → anon/authenticated
--         are denied (SELECT silently returns no rows, writes error out), and
--      2. ALL privileges revoked from anon/authenticated (see the security
--         section at the bottom) → even reads fail with "permission denied".
--    The `postgres` role owns these tables (and has BYPASSRLS), so the app
--    itself is unaffected. Tables are never created in auth/storage/realtime/
--    extensions/graphql_public.
--  * candidates.search_tsv — PostgreSQL full-text keyword baseline: a stored
--    generated tsvector over name/headline/summary/company with a GIN index.
--    The shipped ranking engine (lib/search/engine.js) runs in-process; this
--    column is the DB-native starting point for server-side keyword search.
-- ---------------------------------------------------------------------------

-- users ---------------------------------------------------------------------
create table if not exists users (
  id            text primary key,
  auth_user_id  text unique,                       -- Supabase auth.uid() linkage (nullable)
  email         text not null unique,
  name          text,
  role          text not null default 'recruiter' check (role in ('recruiter', 'candidate', 'admin')),
  created_at    timestamptz not null default now()
);
alter table users enable row level security;

-- jobs ----------------------------------------------------------------------
create table if not exists jobs (
  id              text primary key,
  title           text not null,
  department      text,
  location        text,
  employment_type text,
  status          text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  experience_min  integer,
  experience_max  integer,
  description     text not null default '',
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table jobs enable row level security;
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_title_lower_idx on jobs (lower(title));

-- job_requirements (structured skills of a job; required/preferred) ---------
create table if not exists job_requirements (
  id       bigserial primary key,
  job_id   text not null references jobs (id) on delete cascade,
  skill    text not null,
  category text not null check (category in ('required', 'preferred')),
  min_years numeric,
  note     text,
  unique (job_id, skill, category)
);
alter table job_requirements enable row level security;
-- (job_id, skill, category) unique index also serves lookups by job_id.

-- candidates ----------------------------------------------------------------
create table if not exists candidates (
  id               text primary key,
  full_name        text not null,
  headline         text not null default 'Candidate',
  email            text,
  location         text,
  years_experience numeric,
  current_company  text,
  status           text not null default 'active',
  source           text,
  summary          text not null default '',
  links            jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- internal ordering, mirrors insertion order of the in-memory store; never returned
  ord              integer not null default 0,
  -- PostgreSQL full-text keyword baseline (stored, generated, GIN-indexed)
  search_tsv       tsvector generated always as (
    to_tsvector('english',
      coalesce(full_name, '') || ' ' || coalesce(headline, '') || ' ' ||
      coalesce(summary, '') || ' ' || coalesce(current_company, ''))
  ) stored
);
alter table candidates enable row level security;
create index if not exists candidates_search_tsv_idx on candidates using gin (search_tsv);

-- resumes -------------------------------------------------------------------
create table if not exists resumes (
  id           text primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  filename     text,
  mime_type    text,
  file_size    bigint,
  page_count   integer,
  storage_path text,
  uploaded_at  timestamptz not null default now(),
  status       text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed')),
  sections     jsonb not null default '[]',        -- [{page, section, text}] — evidence locations point here
  full_text    text
);
alter table resumes enable row level security;
create index if not exists resumes_candidate_idx on resumes (candidate_id, uploaded_at);

-- candidate_skills ----------------------------------------------------------
create table if not exists candidate_skills (
  candidate_id text not null references candidates (id) on delete cascade,
  skill        text not null,
  years        numeric,
  level        text,
  source       text,
  ord          integer not null default 0,         -- skill list order from the in-memory store
  primary key (candidate_id, skill)
);
alter table candidate_skills enable row level security;

-- experiences ---------------------------------------------------------------
create table if not exists experiences (
  id           bigserial primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  company      text,
  title        text,
  start        text,                               -- 'YYYY-MM' as in the demo data
  "end"        text,                               -- null = current (`end` is a reserved word)
  location     text,
  summary      text not null default '',
  highlights   jsonb not null default '[]',
  ord          integer not null default 0,
  unique (candidate_id, ord)                       -- also serves candidate lookups
);
alter table experiences enable row level security;

-- education -----------------------------------------------------------------
create table if not exists education (
  id           bigserial primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  institution  text,                               -- returned to JS as `school` (memory.js shape)
  degree       text,
  year         text,                               -- demo data stores graduation year as text
  start        text,
  "end"        text,
  detail       text,
  ord          integer not null default 0,
  unique (candidate_id, ord)
);
alter table education enable row level security;

-- projects ------------------------------------------------------------------
create table if not exists projects (
  id           bigserial primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  name         text,
  summary      text not null default '',
  tech         jsonb not null default '[]',
  url          text,                               -- returned to JS as `link` (memory.js shape)
  ord          integer not null default 0,
  unique (candidate_id, ord)
);
alter table projects enable row level security;

-- candidate_evidence --------------------------------------------------------
create table if not exists candidate_evidence (
  id           text primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  skill        text not null,
  source_type  text,                               -- resume | assessment | manual
  source_id    text,
  source_name  text,
  excerpt      text not null default '',
  location     jsonb,                              -- {page, section} from the source doc — never invented
  status       text not null check (status in ('claimed', 'supporting', 'assessment', 'not_established', 'needs_review')),
  extractor    text,
  notes        text,
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table candidate_evidence enable row level security;
create index if not exists candidate_evidence_candidate_idx on candidate_evidence (candidate_id, id);
create index if not exists candidate_evidence_skill_idx on candidate_evidence (skill);
create index if not exists candidate_evidence_status_idx on candidate_evidence (status);
-- full-text helper over evidence excerpts (keyword baseline alongside search_tsv)
create index if not exists candidate_evidence_excerpt_tsv_idx
  on candidate_evidence using gin (to_tsvector('english', excerpt));

-- assessments ---------------------------------------------------------------
create table if not exists assessments (
  id                 text primary key,
  title              text not null,
  skill              text not null,
  difficulty         text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  description        text not null default '',
  instructions       text not null default '',
  time_limit_minutes integer not null default 45,
  status             text not null default 'draft' check (status in ('draft', 'published')),
  execution_mode     text not null default 'manual_review',
  test_cases         jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table assessments enable row level security;

-- assessment_submissions ----------------------------------------------------
-- status values cover what lib/demo-data.js seeds ('completed', 'manual_review')
-- plus 'pending'/'failed' for future runner states.
create table if not exists assessment_submissions (
  id             text primary key,
  assessment_id  text not null references assessments (id) on delete cascade,
  candidate_id   text not null references candidates (id) on delete cascade,
  submitted_at   timestamptz not null default now(),
  status         text not null default 'manual_review'
                 check (status in ('pending', 'manual_review', 'completed', 'failed')),
  score          numeric,
  execution_mode text,
  result         jsonb not null default '{}'
);
alter table assessment_submissions enable row level security;
create index if not exists assessment_submissions_assessment_idx on assessment_submissions (assessment_id, id);
create index if not exists assessment_submissions_candidate_idx on assessment_submissions (candidate_id, submitted_at, id);

-- applications (candidate ⇄ job pipeline) -----------------------------------
create table if not exists applications (
  id           text primary key,
  candidate_id text not null references candidates (id) on delete cascade,
  job_id       text not null references jobs (id) on delete cascade,
  stage        text not null default 'applied'
               check (stage in ('applied', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (candidate_id, job_id)                    -- also serves candidate lookups
);
alter table applications enable row level security;
create index if not exists applications_job_idx on applications (job_id, id);

-- search_events -------------------------------------------------------------
create table if not exists search_events (
  id           text primary key,
  query        text,
  mode         text,
  result_count integer,
  created_at   timestamptz not null default now()
);
alter table search_events enable row level security;
create index if not exists search_events_created_at_idx on search_events (created_at desc, id desc);

-- audit_logs ----------------------------------------------------------------
create table if not exists audit_logs (
  id          text primary key,
  actor       text,
  action      text,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
alter table audit_logs enable row level security;
create index if not exists audit_logs_created_at_idx on audit_logs (created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- SECURITY (Supabase): deny anon/authenticated — belt and suspenders with RLS.
--
-- 1. Default privileges: this project ships Supabase's stock default ACLs that
--    GRANT all new tables/sequences to anon+authenticated+service_role in
--    schema public. Revoke that for future objects created by role `postgres`
--    (guarded — best effort, see exception handler).
-- 2. Direct revoke over every object that already exists, so tables created
--    earlier in THIS file lose the creation-time grants too.
-- Anon still needs schema USAGE (PostgREST discovery), but with RLS enabled
-- and no policies + no table privileges it cannot read or write any row.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated';
exception when others then
  raise notice 'default privileges not updated (continuing): %', sqlerrm;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
