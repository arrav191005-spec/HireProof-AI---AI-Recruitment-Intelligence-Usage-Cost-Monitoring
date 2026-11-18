-- Phase 11: persist bounded repository language metadata for the student report.
-- Forward-only. Repository languages are observations, not authorship evidence.
--
-- The collection is already bounded by the worker (MAX_BODY/MAX_REQUESTS).
-- The database re-validates the object shape so a compromised worker cannot
-- store arbitrary large JSON or non-numeric values on a verification run.

alter table project_verification_runs
  add column repository_languages jsonb not null default '{}'::jsonb;
alter table project_verification_runs
  add constraint project_verification_runs_languages_object
  check (jsonb_typeof(repository_languages) = 'object');

-- Replaces the five-argument finalizer from migration 011. The new argument is
-- the bounded language map returned by GitHub's /languages endpoint.
drop function if exists hp_finish_verification_job(text, text, text, jsonb, text);

create function hp_finish_verification_job(
  jid text, token text, sha text, findings jsonb, languages jsonb, error text
)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.verification_jobs%rowtype; runrow public.project_verification_runs%rowtype;
        item jsonb; repo_url text;
begin
  select * into job from public.verification_jobs where id=jid for update;
  if not found or token is null or job.lease_token is null or job.lease_token is distinct from token
     or job.lease_until is null or job.lease_until<=now() then return false; end if;
  select * into runrow from public.project_verification_runs where id=job.run_id for update;
  if runrow.status<>'running' then return false; end if;
  if error is not null then
    if error not in ('not_found_or_inaccessible','inaccessible','rate_limited','github_unavailable','limit_exceeded','response_limit','invalid_metadata','internal_error') then
      raise exception 'Invalid error' using errcode='22023';
    end if;
    if error in ('rate_limited','github_unavailable','internal_error') and job.attempts<3 then
      update public.project_verification_runs set status='pending',error_code=error where id=job.run_id;
      update public.verification_jobs set lease_token=null,lease_until=null,available_at=now()+interval '30 seconds' where id=jid;
    else
      update public.project_verification_runs set status='unavailable',error_code=error,finished_at=now() where id=job.run_id;
      update public.verification_jobs set lease_token=null,lease_until=null where id=jid;
    end if;
    insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
      values('audit-' || gen_random_uuid()::text,'verification-worker','verification.error','project',
             runrow.project_id::text,jsonb_build_object('run_id',job.run_id,'error_code',error));
    return true;
  end if;
  if sha is null or sha !~ '^[0-9a-f]{40}$' or findings is null or jsonb_typeof(findings)<>'array'
     or jsonb_array_length(findings)<>cardinality(job.claim_ids) then
    raise exception 'Invalid findings' using errcode='22023';
  end if;
  if languages is null or jsonb_typeof(languages)<>'object'
     or (select count(*) from jsonb_object_keys(languages)) > 30
     or exists (
       select 1 from jsonb_each(languages) as language
       where length(language.key) not between 1 and 60
          or jsonb_typeof(language.value) <> 'number'
     ) then
    raise exception 'Invalid languages' using errcode='22023';
  end if;
  if (select count(distinct value->>'claim_id') from jsonb_array_elements(findings))<>cardinality(job.claim_ids) then
    raise exception 'Invalid claims' using errcode='22023';
  end if;
  select repository_url into repo_url from public.project_repository_refs where id=runrow.repository_ref_id;
  for item in select value from jsonb_array_elements(findings) loop
    if not (item->>'claim_id'=any(job.claim_ids))
       or coalesce(item->>'status','') not in ('supporting','partial','not_established','conflicting','needs_review','unavailable')
       or length(coalesce(item->>'explanation','')) not between 1 and 1000
       or (coalesce(item->>'file_path','') <> '' and (length(item->>'file_path')>240
           or left(item->>'file_path',1)='/' or item->>'file_path' ~ '(^|/)\.\.?(/|$)'))
       or (coalesce(item->>'source_url','') <> ''
           and position(repo_url || '/blob/' || sha || '/' in item->>'source_url')<>1)
       or (item->>'status'='supporting' and (coalesce(item->>'source_url','')='' or coalesce(item->>'file_path','')='')) then
      raise exception 'Invalid finding' using errcode='22023';
    end if;
    insert into public.project_verification_evidence(id,run_id,project_id,claim_id,status,source_url,file_path,commit_sha,explanation)
      values('pve-' || gen_random_uuid()::text,job.run_id,runrow.project_id,item->>'claim_id',item->>'status',
             item->>'source_url',item->>'file_path',sha,item->>'explanation');
  end loop;
  update public.project_verification_runs
    set status='completed',commit_sha=sha,repository_languages=languages,error_code=null,finished_at=now()
    where id=job.run_id;
  update public.verification_jobs set lease_token=null,lease_until=null where id=jid;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values('audit-' || gen_random_uuid()::text,'verification-worker','verification.complete','project',
           runrow.project_id::text,jsonb_build_object('run_id',job.run_id));
  return true;
end $$;
revoke all on function hp_finish_verification_job(text,text,text,jsonb,jsonb,text) from public;
grant execute on function hp_finish_verification_job(text,text,text,jsonb,jsonb,text) to hireproof_verification_worker;
