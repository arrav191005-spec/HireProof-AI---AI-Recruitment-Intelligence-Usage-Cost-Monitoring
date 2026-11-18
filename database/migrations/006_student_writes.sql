-- Narrow student writes. Trusted provisioning must first create users with
-- auth_user_id bound to the verified provider subject and role='candidate'.
-- No existing candidate is claimed; migration itself changes no user data.
create function hp_owns_candidate(cid text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.candidate_owners o
                 where o.candidate_id=cid and o.user_id=public.hp_user_id())
$$;
revoke all on function hp_owns_candidate(text) from public;
grant execute on function hp_owns_candidate(text) to hireproof_v2_access;

create function hp_can_provision_candidate() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.users where id=public.hp_user_id() and role='candidate')
$$;
revoke all on function hp_can_provision_candidate() from public;
grant execute on function hp_can_provision_candidate() to hireproof_v2_access;

create function hp_provision_candidate(p_full_name text) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; cid text;
begin
  uid := public.hp_user_id();
  -- Lock the trusted identity row to serialize concurrent requests.
  perform 1 from public.users where id=uid and role='candidate' for update;
  if not found then
    raise exception 'Candidate provisioning unavailable' using errcode='42501';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    raise exception 'Invalid profile' using errcode='22023';
  end if;
  select candidate_id into cid from public.candidate_owners where user_id=uid;
  if cid is not null then return cid; end if;
  cid := 'cand-' || gen_random_uuid()::text;
  insert into public.candidates(id, full_name) values (cid, btrim(p_full_name));
  insert into public.candidate_owners(candidate_id, user_id) values (cid, uid);
  insert into public.audit_logs(id, actor, action, entity_type, entity_id, metadata)
    values ('audit-' || gen_random_uuid()::text, uid, 'candidate.create', 'candidate', cid, '{}'::jsonb);
  return cid;
end $$;
revoke all on function hp_provision_candidate(text) from public;
grant execute on function hp_provision_candidate(text) to hireproof_v2_access;

-- Column-level grants prevent ownership, IDs, status, and source changes.
grant update (full_name, headline, summary) on candidates to hireproof_v2_access;
grant insert (candidate_id, name, summary), update (name, summary) on projects to hireproof_v2_access;
grant usage on sequence projects_id_seq to hireproof_v2_access;
create policy hp_candidate_owner_update on candidates for update to hireproof_v2_access
  using (hp_owns_candidate(id)) with check (hp_owns_candidate(id));
create policy hp_project_owner_insert on projects for insert to hireproof_v2_access
  with check (hp_owns_candidate(candidate_id));
create policy hp_project_owner_update on projects for update to hireproof_v2_access
  using (hp_owns_candidate(candidate_id)) with check (hp_owns_candidate(candidate_id));

-- Append-only audit on V2 student writes. Store field names, not values.
-- Legacy writes without a verified context are intentionally not represented
-- as V2 actions; securing/auditing those routes is separate work.
create function hp_audit_student_write() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; action_name text; fields jsonb;
begin
  uid := public.hp_user_id();
  if uid is null then return new; end if;
  if tg_table_name='projects' then
    action_name := case when tg_op='INSERT' then 'project.create' else 'project.update' end;
    fields := case when tg_op='INSERT' then '["name","summary"]'::jsonb
                   else to_jsonb(array_remove(array[
                     case when old.name is distinct from new.name then 'name' end,
                     case when old.summary is distinct from new.summary then 'summary' end
                   ], null)) end;
  else
    action_name := 'candidate.update';
    fields := to_jsonb(array_remove(array[
      case when old.full_name is distinct from new.full_name then 'full_name' end,
      case when old.headline is distinct from new.headline then 'headline' end,
      case when old.summary is distinct from new.summary then 'summary' end
    ], null));
  end if;
  insert into public.audit_logs(id, actor, action, entity_type, entity_id, metadata)
    values ('audit-' || gen_random_uuid()::text, uid, action_name,
            case when tg_table_name='projects' then 'project' else 'candidate' end,
            new.id::text, jsonb_build_object('fields', fields));
  return new;
end $$;
revoke all on function hp_audit_student_write() from public;
create trigger hp_candidate_write_audit after update on candidates
  for each row execute function hp_audit_student_write();
create trigger hp_project_write_audit after insert or update on projects
  for each row execute function hp_audit_student_write();
