-- Phase 13: database-enforced per-student AI request and spend reservations.
-- Defaults are deliberately small. Only the migration administrator may alter
-- this policy; the application login can only invoke the reviewed function.

create table ai_analysis_policy (
  singleton boolean primary key default true check (singleton),
  max_requests_per_hour integer not null default 3 check (max_requests_per_hour between 1 and 20),
  max_requests_per_day integer not null default 10 check (max_requests_per_day between 1 and 100),
  max_daily_cost_usd numeric not null default 0.50 check (max_daily_cost_usd > 0 and max_daily_cost_usd <= 100),
  updated_at timestamptz not null default now()
);
alter table ai_analysis_policy enable row level security;
insert into ai_analysis_policy(singleton) values (true) on conflict do nothing;
revoke all on ai_analysis_policy from public, anon, authenticated, hireproof_v2_access;

alter table resume_ai_analysis_runs
  add column reserved_cost_usd numeric not null default 0 check (reserved_cost_usd >= 0 and reserved_cost_usd <= 5);

-- Direct run creation is forbidden. This function serializes each student's
-- accounting and proves the selected resume belongs to that student.
revoke insert on resume_ai_analysis_runs from hireproof_v2_access;

create function hp_start_ai_analysis_run(runid text, rid text, reserve_cost numeric)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; cid text; policy public.ai_analysis_policy%rowtype; spent numeric;
begin
  if runid !~ '^rai-[0-9a-f]{32}$' or reserve_cost is null or reserve_cost < 0 or reserve_cost > 5 then
    raise exception 'Invalid AI analysis request' using errcode='22023';
  end if;
  uid := public.hp_user_id();
  select candidate_id into cid from public.candidate_owners where user_id=uid;
  if cid is null then return null; end if;
  if not exists (select 1 from public.resumes where id=rid and candidate_id=cid and full_text is not null) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-analysis-quota:' || uid, 0));
  select * into policy from public.ai_analysis_policy where singleton;
  if (select count(*) from public.resume_ai_analysis_runs
      where candidate_id=cid and started_at>=now()-interval '1 hour') >= policy.max_requests_per_hour then
    raise exception 'AI analysis quota exceeded' using errcode='P0001', detail='hourly';
  end if;
  if (select count(*) from public.resume_ai_analysis_runs
      where candidate_id=cid and started_at>=now()-interval '24 hours') >= policy.max_requests_per_day then
    raise exception 'AI analysis quota exceeded' using errcode='P0001', detail='daily';
  end if;
  select coalesce(sum(u.estimated_cost_usd),0)
       + coalesce((select sum(r.reserved_cost_usd) from public.resume_ai_analysis_runs r
                   where r.candidate_id=cid and r.status='running'
                     and r.started_at>=now()-interval '24 hours'),0)
    into spent
    from public.ai_request_usage u join public.resume_ai_analysis_runs r on r.id=u.analysis_run_id
    where r.candidate_id=cid and u.created_at>=now()-interval '24 hours';
  if spent + reserve_cost > policy.max_daily_cost_usd then
    raise exception 'AI analysis quota exceeded' using errcode='P0001', detail='cost';
  end if;
  insert into public.resume_ai_analysis_runs(id,candidate_id,resume_id,status,consented_at,reserved_cost_usd)
    values(runid,cid,rid,'running',now(),reserve_cost);
  return runid;
end $$;
revoke all on function hp_start_ai_analysis_run(text,text,numeric) from public;
grant execute on function hp_start_ai_analysis_run(text,text,numeric) to hireproof_v2_access;
