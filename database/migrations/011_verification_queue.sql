-- Durable verification queue. Requires hireproof_verification_worker.
-- Worker and API roles are separate; runtime callers cannot finalize evidence.
grant usage on schema public to hireproof_verification_worker;
create unique index hp_one_active_verification on project_verification_runs(project_id)
  where status in ('pending','running');

create table verification_jobs (
  id text primary key,
  run_id text not null unique references project_verification_runs(id) on delete cascade,
  claim_ids text[] not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
alter table verification_jobs enable row level security;
revoke all on verification_jobs from public, anon, authenticated, hireproof_v2_access, hireproof_verification_worker;

create function hp_enqueue_verification(pid bigint, repo_url text, requested_claims text[]) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cid text; uid text; rid text; runid text; claim text; claimid text; ids text[] := '{}'; seen text[] := '{}';
begin
  uid := public.hp_user_id();
  select candidate_id into cid from public.projects where id=pid for update;
  if cid is null or uid is null or not public.hp_owns_candidate(cid) then return null; end if;
  if repo_url is null or length(repo_url)>230 or repo_url !~ '^https://github[.]com/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$'
     or requested_claims is null or cardinality(requested_claims) not between 1 and 8 then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  foreach claim in array requested_claims loop
    if claim is null or claim not in ('JavaScript','TypeScript','React','Python','FastAPI','PostgreSQL','Java','Spring Boot') then
      raise exception 'Invalid claim' using errcode='22023';
    end if;
  end loop;
  select id into runid from public.project_verification_runs
    where project_id=pid and status in ('pending','running') limit 1;
  if runid is not null then
    if exists (
      select 1 from public.project_verification_runs r
      join public.project_repository_refs ref on ref.id=r.repository_ref_id
      join public.verification_jobs j on j.run_id=r.id
      where r.id=runid and ref.repository_url=repo_url
        and (select array_agg(distinct c.claim_text order by c.claim_text)
             from public.project_claims c where c.id=any(j.claim_ids))
          = (select array_agg(distinct x order by x) from unnest(requested_claims) x)
    ) then return runid; end if;
    return 'conflict';
  end if;
  select id into rid from public.project_repository_refs where project_id=pid and repository_url=repo_url;
  if rid is null then
    rid := 'prr-' || gen_random_uuid()::text;
    insert into public.project_repository_refs(id,project_id,repository_url,created_by) values(rid,pid,repo_url,uid);
  end if;
  foreach claim in array requested_claims loop
    if not claim = any(seen) then
      claimid := 'pc-' || gen_random_uuid()::text;
      insert into public.project_claims(id,project_id,claim_text) values(claimid,pid,claim);
      ids := array_append(ids,claimid);
      seen := array_append(seen,claim);
    end if;
  end loop;
  runid := 'pvr-' || gen_random_uuid()::text;
  insert into public.project_verification_runs(id,project_id,repository_ref_id,status,requested_by)
    values(runid,pid,rid,'pending',uid);
  insert into public.verification_jobs(id,run_id,claim_ids)
    values('vjob-' || gen_random_uuid()::text,runid,ids);
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values('audit-' || gen_random_uuid()::text,uid,'verification.request','project',pid::text,
           jsonb_build_object('run_id',runid));
  return runid;
end $$;
revoke all on function hp_enqueue_verification(bigint,text,text[]) from public;
grant execute on function hp_enqueue_verification(bigint,text,text[]) to hireproof_v2_access;

create function hp_claim_verification_job()
returns table(job_id text,run_id text,lease_token text,repository_url text,claims jsonb)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.verification_jobs%rowtype; token text;
begin
  -- Failed leases that exhausted their budget must not block future requests.
  -- Audit before the update so the failed attempt remains traceable.
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    select 'audit-' || gen_random_uuid()::text,'verification-worker','verification.error','project',
           r.project_id::text,jsonb_build_object('run_id',r.id,'error_code','retry_exhausted')
    from public.project_verification_runs r
    join public.verification_jobs j on j.run_id=r.id
    where r.status='running' and j.lease_until < now() and j.attempts>=3;
  update public.project_verification_runs r set status='failed', error_code='retry_exhausted', finished_at=now()
    from public.verification_jobs j where j.run_id=r.id and r.status='running'
      and j.lease_until < now() and j.attempts>=3;
  select j.* into job from public.verification_jobs j
    join public.project_verification_runs r on r.id=j.run_id
    where r.status in ('pending','running') and j.available_at<=now()
      and (j.lease_until is null or j.lease_until<now()) and j.attempts<3
    order by j.created_at for update of j skip locked limit 1;
  if not found then return; end if;
  token := gen_random_uuid()::text;
  update public.verification_jobs set lease_token=token,lease_until=now()+interval '90 seconds',
    attempts=attempts+1 where id=job.id;
  update public.project_verification_runs set status='running',error_code=null where id=job.run_id;
  return query select job.id,job.run_id,token,ref.repository_url,
    (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'claim',c.claim_text) order by c.id),'[]'::jsonb)
       from public.project_claims c where c.id=any(job.claim_ids))
    from public.project_verification_runs r
    join public.project_repository_refs ref on ref.id=r.repository_ref_id
    where r.id=job.run_id;
end $$;
revoke all on function hp_claim_verification_job() from public;
grant execute on function hp_claim_verification_job() to hireproof_verification_worker;

create function hp_finish_verification_job(jid text, token text, sha text, findings jsonb, error text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.verification_jobs%rowtype; runrow public.project_verification_runs%rowtype; item jsonb; repo_url text;
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
  update public.project_verification_runs set status='completed',commit_sha=sha,error_code=null,finished_at=now() where id=job.run_id;
  update public.verification_jobs set lease_token=null,lease_until=null where id=jid;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values('audit-' || gen_random_uuid()::text,'verification-worker','verification.complete','project',
           runrow.project_id::text,jsonb_build_object('run_id',job.run_id));
  return true;
end $$;
revoke all on function hp_finish_verification_job(text,text,text,jsonb,text) from public;
grant execute on function hp_finish_verification_job(text,text,text,jsonb,text) to hireproof_verification_worker;
