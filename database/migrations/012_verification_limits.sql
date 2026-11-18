-- Phase 10: bounded verification quotas, global concurrency and sanitized
-- metrics. Forward-only. Requires hireproof_v2_access and
-- hireproof_verification_worker (see database/provision-*.sql).
--
-- Policy values are database configuration, not user input. Only the table
-- owner (the migration administrator) can change them; runtime roles have no
-- table privileges. Example operator statement:
--   update verification_policy set max_requests_per_hour = 5;
--
-- The metrics function returns aggregate operational counters only. It never
-- exposes candidate identifiers, repository URLs, file paths, tokens or errors.

-- The migration runner creates this table before the reviewed migrations.
-- It contains no candidate data, but RLS keeps every public table consistent.
alter table schema_migrations enable row level security;

create table verification_policy (
  singleton boolean primary key default true check (singleton),
  max_active_per_user integer not null default 2
    check (max_active_per_user between 1 and 20),
  max_requests_per_hour integer not null default 10
    check (max_requests_per_hour between 1 and 200),
  max_requests_per_day integer not null default 30
    check (max_requests_per_day between 1 and 1000),
  max_running_jobs integer not null default 4
    check (max_running_jobs between 1 and 32),
  updated_at timestamptz not null default now()
);
insert into verification_policy(singleton) values (true) on conflict do nothing;
alter table verification_policy enable row level security;
revoke all on verification_policy from public, anon, authenticated,
  hireproof_v2_access, hireproof_verification_worker, hireproof_bootstrap_operator;
-- No policies: security-definer functions below read it, runtime roles cannot.

-- Enqueue keeps the existing ownership, validation, duplicate and conflict
-- behaviour. New runs additionally pass per-user active/hour/day quotas.
-- Duplicate retries return the existing run before quota checks, so a lost
-- HTTP response can be retried safely.
create or replace function hp_enqueue_verification(pid bigint, repo_url text, requested_claims text[])
returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cid text; uid text; rid text; runid text; claim text; claimid text; ids text[] := '{}'; seen text[] := '{}';
        pol public.verification_policy%rowtype; active_count int; hourly_count int; daily_count int;
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

  -- Serialize quota accounting per user across different projects. The
  -- project row lock above already serializes requests for the same project.
  perform pg_advisory_xact_lock(hashtextextended('verification-quota:' || uid, 0));
  select * into pol from public.verification_policy where singleton;
  select count(*) into active_count from public.project_verification_runs
    where requested_by=uid and status in ('pending','running');
  if active_count >= pol.max_active_per_user then
    raise exception 'verification quota exceeded' using errcode='P0001', detail='active';
  end if;
  select count(*) into hourly_count from public.project_verification_runs
    where requested_by=uid and requested_at > now() - interval '1 hour';
  if hourly_count >= pol.max_requests_per_hour then
    raise exception 'verification quota exceeded' using errcode='P0001', detail='hourly';
  end if;
  select count(*) into daily_count from public.project_verification_runs
    where requested_by=uid and requested_at > now() - interval '1 day';
  if daily_count >= pol.max_requests_per_day then
    raise exception 'verification quota exceeded' using errcode='P0001', detail='daily';
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

-- Claiming is globally serialized so the running-job ceiling cannot be
-- exceeded by two workers counting simultaneously. Expired leases are
-- recovered first, then a new job is leased only below the configured limit.
create or replace function hp_claim_verification_job()
returns table(job_id text,run_id text,lease_token text,repository_url text,claims jsonb)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare job public.verification_jobs%rowtype; token text; max_running int; running_now int;
begin
  perform pg_advisory_xact_lock(hashtextextended('verification-claim', 0));
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

  select max_running_jobs into max_running from public.verification_policy where singleton;
  select count(*) into running_now from public.project_verification_runs where status='running';
  if running_now >= max_running then return; end if;

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

-- Aggregate operational metrics only: no candidate IDs, repository URLs,
-- file paths, tokens, provider bodies or per-user rows. The worker/monitor
-- role can call this without direct table access.
create function hp_verification_metrics() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'queue_depth', (
      select count(*) from public.verification_jobs j
      join public.project_verification_runs r on r.id=j.run_id
      where r.status='pending' and j.attempts<3 and j.available_at<=now()
    ),
    'pending_runs', (select count(*) from public.project_verification_runs where status='pending'),
    'running_runs', (select count(*) from public.project_verification_runs where status='running'),
    'completed_last_24h', (
      select count(*) from public.project_verification_runs
      where status='completed' and finished_at > now() - interval '24 hours'
    ),
    'unavailable_last_24h', (
      select count(*) from public.project_verification_runs
      where status='unavailable' and finished_at > now() - interval '24 hours'
    ),
    'failed_last_24h', (
      select count(*) from public.project_verification_runs
      where status='failed' and finished_at > now() - interval '24 hours'
    ),
    'retrying_jobs', (
      select count(*) from public.verification_jobs
      where attempts > 0 and attempts < 3 and lease_token is null
    ),
    'rate_limited_last_24h', (
      select count(*) from public.audit_logs
      where action='verification.error' and metadata->>'error_code'='rate_limited'
        and created_at > now() - interval '24 hours'
    ),
    'oldest_pending_seconds', coalesce((
      select extract(epoch from now() - min(requested_at))::int
      from public.project_verification_runs where status='pending'
    ), 0),
    'average_duration_seconds_last_24h', coalesce((
      select round(avg(extract(epoch from finished_at - requested_at)))::int
      from public.project_verification_runs
      where finished_at > now() - interval '24 hours'
    ), 0),
    'policy', (
      select jsonb_build_object(
        'max_active_per_user', max_active_per_user,
        'max_requests_per_hour', max_requests_per_hour,
        'max_requests_per_day', max_requests_per_day,
        'max_running_jobs', max_running_jobs
      ) from public.verification_policy where singleton
    )
  )
$$;
revoke all on function hp_verification_metrics() from public, anon, authenticated,
  hireproof_v2_access, hireproof_bootstrap_operator;
grant execute on function hp_verification_metrics() to hireproof_verification_worker;
