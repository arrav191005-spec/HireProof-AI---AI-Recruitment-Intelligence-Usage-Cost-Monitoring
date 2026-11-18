-- Forward-only verification schema. Existing projects and candidates remain
-- the ownership roots. No existing rows, statuses, or migrations are altered.
create table project_repository_refs (
  id text primary key,
  project_id bigint not null references projects(id) on delete cascade,
  repository_url text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id),
  unique (project_id, repository_url),
  unique (id, project_id)
);

create table project_claims (
  id text primary key,
  project_id bigint not null references projects(id) on delete cascade,
  resume_id text references resumes(id) on delete set null,
  claim_text text not null,
  source_page integer check (source_page is null or source_page > 0),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);

create table project_verification_runs (
  id text primary key,
  project_id bigint not null references projects(id) on delete cascade,
  repository_ref_id text not null,
  status text not null check (status in ('pending', 'running', 'completed', 'unavailable', 'failed')),
  commit_sha text,
  error_code text,
  requested_by text references users(id),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (repository_ref_id, project_id) references project_repository_refs(id, project_id),
  unique (id, project_id)
);

create table project_verification_evidence (
  id text primary key,
  run_id text not null,
  project_id bigint not null,
  claim_id text not null,
  status text not null check (status in ('supporting', 'partial', 'not_established', 'conflicting', 'needs_review', 'unavailable')),
  source_url text,
  file_path text,
  commit_sha text,
  explanation text not null,
  observed_at timestamptz not null default now(),
  foreign key (run_id, project_id) references project_verification_runs(id, project_id) on delete cascade,
  foreign key (claim_id, project_id) references project_claims(id, project_id)
);

create table certificates (
  id text primary key,
  candidate_id text not null references candidates(id) on delete cascade,
  title text not null,
  issuer text,
  credential_id text,
  verification_url text,
  created_at timestamptz not null default now(),
  unique (id, candidate_id)
);

create table certificate_verification_runs (
  id text primary key,
  certificate_id text not null references certificates(id) on delete cascade,
  status text not null check (status in ('pending', 'issuer_verified', 'cryptographically_verified', 'accessible_unconfirmed', 'mismatch', 'expired_or_revoked', 'unavailable', 'manual_review_required')),
  source_url text,
  explanation text,
  error_code text,
  requested_by text references users(id),
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);

create index project_repository_refs_project_idx on project_repository_refs(project_id);
create index project_claims_project_idx on project_claims(project_id);
create index project_verification_runs_project_idx on project_verification_runs(project_id, requested_at desc);
create index project_verification_evidence_run_idx on project_verification_evidence(run_id);
create index certificates_candidate_idx on certificates(candidate_id);
create index certificate_verification_runs_certificate_idx on certificate_verification_runs(certificate_id, requested_at desc);

alter table project_repository_refs enable row level security;
alter table project_claims enable row level security;
alter table project_verification_runs enable row level security;
alter table project_verification_evidence enable row level security;
alter table certificates enable row level security;
alter table certificate_verification_runs enable row level security;
revoke all on project_repository_refs, project_claims, project_verification_runs,
  project_verification_evidence, certificates, certificate_verification_runs from anon, authenticated;
