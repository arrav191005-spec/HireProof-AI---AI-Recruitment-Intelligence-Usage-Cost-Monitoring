-- Only existing trusted workspace members can create or edit workspace jobs.
-- No membership, workspace, ownership, job status or verification grants.
create function hp_create_workspace_job(wid text, job_title text) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; jid text;
begin
  uid := public.hp_user_id();
  -- Hold a share lock on the membership row so revocation and creation serialize.
  perform 1 from public.workspace_memberships
    where workspace_id=wid and user_id=uid and role in ('admin','recruiter') for share;
  if not found then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  if job_title is null or length(btrim(job_title)) not between 1 and 120 then
    raise exception 'Invalid title' using errcode='22023';
  end if;
  jid := 'job-' || gen_random_uuid()::text;
  insert into public.jobs(id,title,status) values (jid,btrim(job_title),'draft');
  insert into public.workspace_jobs(job_id,workspace_id,linked_by) values (jid,wid,uid);
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'job.create','job',jid,
            jsonb_build_object('workspace_id',wid));
  return jid;
end $$;
revoke all on function hp_create_workspace_job(text,text) from public;
grant execute on function hp_create_workspace_job(text,text) to hireproof_v2_access;
grant update (title) on jobs to hireproof_v2_access;
create policy hp_workspace_job_update on jobs for update to hireproof_v2_access
  using (exists (select 1 from workspace_jobs w where w.job_id=jobs.id and hp_in_workspace(w.workspace_id)))
  with check (exists (select 1 from workspace_jobs w where w.job_id=jobs.id and hp_in_workspace(w.workspace_id)));

create function hp_audit_job_write() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text;
begin
  uid := public.hp_user_id();
  if uid is not null then
    insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
      values ('audit-' || gen_random_uuid()::text,uid,'job.update','job',new.id,
              jsonb_build_object('fields',jsonb_build_array('title')));
  end if;
  return new;
end $$;
revoke all on function hp_audit_job_write() from public;
create trigger hp_job_write_audit after update on jobs for each row execute function hp_audit_job_write();
