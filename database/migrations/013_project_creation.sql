-- Forward-only fix for runtime project creation. The demo schema's
-- unique(candidate_id, ord) and ord default 0 allow only one project per
-- candidate through a plain INSERT. Runtime creation now goes through a
-- security-definer function that assigns the next ordinal under a per-candidate
-- advisory lock; the API role loses direct project INSERT.
create function hp_create_project(p_name text, p_summary text)
returns table(id bigint, name text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cid text; next_ord int;
begin
  select c.id into cid
    from public.candidates c join public.candidate_owners o on o.candidate_id=c.id
    where o.user_id=public.hp_user_id();
  if cid is null then
    raise exception 'Candidate profile not found' using errcode='P0002';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120
     or length(coalesce(p_summary,'')) > 2000 then
    raise exception 'Invalid project' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('project-ord:' || cid, 0));
  select coalesce(max(p.ord)+1, 0) into next_ord
    from public.projects p where p.candidate_id=cid;
  insert into public.projects(candidate_id,name,summary,ord)
    values (cid, btrim(p_name), coalesce(p_summary,''), next_ord);
  return query select p.id, p.name from public.projects p
    where p.candidate_id=cid and p.ord=next_ord;
end $$;
revoke all on function hp_create_project(text,text) from public;
grant execute on function hp_create_project(text,text) to hireproof_v2_access;

-- No runtime role needs to construct project rows directly anymore. Updates
-- remain limited to name/summary by migration 006.
revoke insert (candidate_id, name, summary) on projects from hireproof_v2_access;
