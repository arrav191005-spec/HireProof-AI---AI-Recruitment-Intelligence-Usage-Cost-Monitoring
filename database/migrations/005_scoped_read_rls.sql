-- Requires an administrator-provisioned NOLOGIN role `hireproof_v2_access`.
-- This role receives SELECT only; no writes, ownership or DDL are granted.
-- Application login credentials must be separate and least-privileged.
--
-- These SECURITY DEFINER helpers read ownership tables as their migration
-- owner to avoid recursive RLS. Their search_path is fixed and PUBLIC execute
-- is revoked. The service sets app.subject from a verified JWT transaction
-- locally. A holder of database credentials can set that context directly,
-- so those credentials must be accessible only to the trusted API.

create function hp_user_id() returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select id from public.users
  where auth_user_id = nullif(current_setting('app.subject', true), '')
  limit 1
$$;

create function hp_in_workspace(wid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = wid and m.user_id = public.hp_user_id()
  )
$$;

create function hp_can_candidate(cid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.candidate_owners o
    where o.candidate_id = cid and o.user_id = public.hp_user_id()
  ) or exists (
    select 1 from public.applications a
    join public.workspace_jobs wj on wj.job_id = a.job_id
    join public.workspace_memberships wm on wm.workspace_id = wj.workspace_id
    where a.candidate_id = cid and wm.user_id = public.hp_user_id()
  )
$$;

create function hp_can_project(pid bigint) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.projects p
                 where p.id = pid and public.hp_can_candidate(p.candidate_id))
$$;

revoke all on function hp_user_id(), hp_in_workspace(text), hp_can_candidate(text), hp_can_project(bigint) from public;
grant execute on function hp_user_id(), hp_in_workspace(text), hp_can_candidate(text), hp_can_project(bigint) to hireproof_v2_access;
grant usage on schema public to hireproof_v2_access;
grant select on candidate_owners, workspaces, workspace_memberships, workspace_jobs,
  candidates, resumes, projects, project_repository_refs, project_claims,
  project_verification_runs, project_verification_evidence, certificates,
  certificate_verification_runs, applications, jobs to hireproof_v2_access;

create policy hp_owner_read on candidate_owners for select to hireproof_v2_access using (user_id = hp_user_id());
create policy hp_workspace_read on workspaces for select to hireproof_v2_access using (hp_in_workspace(id));
create policy hp_membership_read on workspace_memberships for select to hireproof_v2_access using (user_id = hp_user_id());
create policy hp_workspace_jobs_read on workspace_jobs for select to hireproof_v2_access using (hp_in_workspace(workspace_id));
create policy hp_job_read on jobs for select to hireproof_v2_access using (
  exists (select 1 from workspace_jobs w where w.job_id = id and hp_in_workspace(w.workspace_id))
);
create policy hp_application_read on applications for select to hireproof_v2_access using (
  exists (select 1 from candidate_owners o where o.candidate_id = applications.candidate_id and o.user_id = hp_user_id())
  or exists (select 1 from workspace_jobs w where w.job_id = applications.job_id and hp_in_workspace(w.workspace_id))
);
create policy hp_candidate_read on candidates for select to hireproof_v2_access using (hp_can_candidate(id));
create policy hp_resume_read on resumes for select to hireproof_v2_access using (hp_can_candidate(candidate_id));
create policy hp_project_read on projects for select to hireproof_v2_access using (hp_can_candidate(candidate_id));
create policy hp_project_ref_read on project_repository_refs for select to hireproof_v2_access using (hp_can_project(project_id));
create policy hp_project_claim_read on project_claims for select to hireproof_v2_access using (hp_can_project(project_id));
create policy hp_run_read on project_verification_runs for select to hireproof_v2_access using (hp_can_project(project_id));
create policy hp_project_evidence_read on project_verification_evidence for select to hireproof_v2_access using (hp_can_project(project_id));
create policy hp_certificate_read on certificates for select to hireproof_v2_access using (hp_can_candidate(candidate_id));
create policy hp_certificate_run_read on certificate_verification_runs for select to hireproof_v2_access using (
  exists (select 1 from certificates c where c.id = certificate_id and hp_can_candidate(c.candidate_id))
);
