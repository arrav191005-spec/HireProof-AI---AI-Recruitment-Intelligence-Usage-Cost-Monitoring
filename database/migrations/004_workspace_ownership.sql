-- Forward-only ownership foundation. No data is assigned automatically:
-- existing profiles and jobs remain inaccessible to future scoped APIs until
-- explicitly linked by a trusted onboarding process.
create table candidate_owners (
  candidate_id text primary key references candidates(id) on delete cascade,
  user_id text not null unique references users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  linked_by text references users(id)
);

create table workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id)
);

create table workspace_memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('admin', 'recruiter')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_memberships_user_idx on workspace_memberships(user_id);

create table workspace_jobs (
  job_id text primary key references jobs(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  linked_at timestamptz not null default now(),
  linked_by text references users(id)
);
create index workspace_jobs_workspace_idx on workspace_jobs(workspace_id);

-- No client grants or permissive policies are added. Enabling RLS without
-- policies denies anon/authenticated access. Server-side scoped access must
-- use a separately provisioned non-owner role and explicit policies.
alter table candidate_owners enable row level security;
alter table workspaces enable row level security;
alter table workspace_memberships enable row level security;
alter table workspace_jobs enable row level security;
revoke all on candidate_owners, workspaces, workspace_memberships, workspace_jobs from anon, authenticated;
