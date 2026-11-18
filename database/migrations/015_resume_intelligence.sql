-- Phase 12: consented, auditable resume intelligence.
-- AI output is advisory and source-grounded; it is never verification evidence
-- and never drives automatic hiring decisions.

create table resume_ai_analysis_runs (
  id text primary key,
  candidate_id text not null references candidates(id) on delete cascade,
  resume_id text references resumes(id) on delete set null,
  status text not null check (status in ('running','completed','failed','disabled')),
  consented_at timestamptz not null,
  model_identifier text,
  resume_summary text,
  report jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (jsonb_typeof(report) = 'object'),
  check (error_code is null or error_code in ('provider_unavailable','invalid_provider_output','disabled'))
);
alter table resume_ai_analysis_runs enable row level security;
create index resume_ai_analysis_runs_candidate_idx
  on resume_ai_analysis_runs(candidate_id, started_at desc);

create table resume_project_claims (
  id text primary key,
  analysis_run_id text not null references resume_ai_analysis_runs(id) on delete cascade,
  candidate_id text not null references candidates(id) on delete cascade,
  resume_id text references resumes(id) on delete set null,
  project_id bigint references projects(id) on delete set null,
  project_name text not null,
  claim_text text not null,
  claim_category text not null check (claim_category in ('language','framework','database','feature','other')),
  source_excerpt text not null,
  source_page integer check (source_page is null or source_page > 0),
  github_url text,
  deployed_url text,
  evidence_classification text not null check (evidence_classification in
    ('supported','partially_supported','not_established','conflicting','needs_review')),
  evidence_refs jsonb not null default '[]'::jsonb,
  explanation text not null,
  limitations text not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(evidence_refs) = 'array')
);
alter table resume_project_claims enable row level security;
create index resume_project_claims_candidate_idx
  on resume_project_claims(candidate_id, analysis_run_id);

create table job_compatibility_runs (
  id text primary key,
  analysis_run_id text references resume_ai_analysis_runs(id) on delete set null,
  candidate_id text not null references candidates(id) on delete cascade,
  job_id text not null references jobs(id) on delete cascade,
  status text not null check (status in ('completed','disabled','failed')),
  estimate numeric check (estimate is null or (estimate >= 0 and estimate <= 100)),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(report) = 'object')
);
alter table job_compatibility_runs enable row level security;
create index job_compatibility_runs_candidate_job_idx
  on job_compatibility_runs(candidate_id, job_id, created_at desc);

create table ai_request_usage (
  id text primary key,
  analysis_run_id text not null references resume_ai_analysis_runs(id) on delete cascade,
  provider text not null check (provider in ('openai')),
  model_identifier text not null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  total_tokens integer not null check (total_tokens >= 0),
  estimated_cost_usd numeric not null check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);
alter table ai_request_usage enable row level security;

-- These rows are scoped through candidate ownership or an application in an
-- authorized recruiter workspace. Runtime writes are available only to the
-- trusted FastAPI login, whose endpoints require consent and validate output.
grant select, insert, update (status,model_identifier,resume_summary,report,error_code,finished_at)
  on resume_ai_analysis_runs to hireproof_v2_access;
grant select, insert on resume_project_claims to hireproof_v2_access;
grant select, insert on job_compatibility_runs to hireproof_v2_access;
grant select, insert on ai_request_usage to hireproof_v2_access;

create policy hp_resume_ai_read on resume_ai_analysis_runs for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
create policy hp_resume_ai_write on resume_ai_analysis_runs for insert to hireproof_v2_access
  with check (hp_owns_candidate(candidate_id));
create policy hp_resume_ai_update on resume_ai_analysis_runs for update to hireproof_v2_access
  using (hp_owns_candidate(candidate_id)) with check (hp_owns_candidate(candidate_id));
create policy hp_resume_claim_read on resume_project_claims for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
create policy hp_resume_claim_write on resume_project_claims for insert to hireproof_v2_access
  with check (hp_owns_candidate(candidate_id));
create policy hp_job_compatibility_read on job_compatibility_runs for select to hireproof_v2_access
  using (hp_can_candidate(candidate_id));
create policy hp_job_compatibility_write on job_compatibility_runs for insert to hireproof_v2_access
  with check (hp_owns_candidate(candidate_id));
create policy hp_ai_usage_read on ai_request_usage for select to hireproof_v2_access
  using (exists (
    select 1 from resume_ai_analysis_runs r
    where r.id=ai_request_usage.analysis_run_id and hp_can_candidate(r.candidate_id)
  ));
create policy hp_ai_usage_write on ai_request_usage for insert to hireproof_v2_access
  with check (exists (
    select 1 from resume_ai_analysis_runs r
    where r.id=ai_request_usage.analysis_run_id and hp_owns_candidate(r.candidate_id)
  ));
