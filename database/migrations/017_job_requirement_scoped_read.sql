-- Phase 12: compatibility analysis needs only requirements for a job the
-- caller can already see through their own application or recruiter workspace.
grant select on job_requirements to hireproof_v2_access;
create policy hp_job_requirement_read on job_requirements for select to hireproof_v2_access using (
  exists (
    select 1 from applications a
    where a.job_id=job_requirements.job_id
      and (
        exists (select 1 from candidate_owners o where o.candidate_id=a.candidate_id and o.user_id=hp_user_id())
        or exists (select 1 from workspace_jobs w where w.job_id=a.job_id and hp_in_workspace(w.workspace_id))
      )
  )
);
