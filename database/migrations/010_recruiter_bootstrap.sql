-- Requires the separately provisioned hireproof_bootstrap_operator group.
-- No user, workspace or membership is created by this migration.
create table recruiter_profiles (
  user_id text primary key references users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
alter table recruiter_profiles enable row level security;
revoke all on recruiter_profiles from public, anon, authenticated;
grant select on recruiter_profiles to hireproof_v2_access;
create policy hp_recruiter_profile_read on recruiter_profiles for select to hireproof_v2_access
  using (user_id=hp_user_id());

-- The dedicated operator role can provision but not modify or delete existing
-- records or audit history. These policies must never be assigned to V2 logins.
grant usage on schema public to hireproof_bootstrap_operator;
grant select, insert on users, recruiter_profiles, workspaces, workspace_memberships, audit_logs
  to hireproof_bootstrap_operator;
create policy hp_bootstrap_users on users for select to hireproof_bootstrap_operator using (true);
create policy hp_bootstrap_users_insert on users for insert to hireproof_bootstrap_operator with check (role='recruiter');
create policy hp_bootstrap_profiles on recruiter_profiles for select to hireproof_bootstrap_operator using (true);
create policy hp_bootstrap_profiles_insert on recruiter_profiles for insert to hireproof_bootstrap_operator with check (true);
create policy hp_bootstrap_workspaces on workspaces for select to hireproof_bootstrap_operator using (true);
create policy hp_bootstrap_workspaces_insert on workspaces for insert to hireproof_bootstrap_operator with check (true);
create policy hp_bootstrap_memberships on workspace_memberships for select to hireproof_bootstrap_operator using (true);
create policy hp_bootstrap_memberships_insert on workspace_memberships for insert to hireproof_bootstrap_operator with check (role='admin');
create policy hp_bootstrap_audit on audit_logs for select to hireproof_bootstrap_operator using (true);
create policy hp_bootstrap_audit_insert on audit_logs for insert to hireproof_bootstrap_operator with check (true);

create function hp_update_workspace(wid text, new_name text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text;
begin
  uid := public.hp_user_id();
  perform 1 from public.workspace_memberships
    where workspace_id=wid and user_id=uid and role='admin' for share;
  if not found then return false; end if;
  if new_name is null or length(btrim(new_name)) not between 1 and 120 then
    raise exception 'Invalid workspace name' using errcode='22023';
  end if;
  update public.workspaces set name=btrim(new_name) where id=wid;
  if not found then return false; end if;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'workspace.update','workspace',wid,
            jsonb_build_object('fields',jsonb_build_array('name')));
  return true;
end $$;

create function hp_pending_invitations(wid text)
returns table(id text, invitee_user_id text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from public.workspace_memberships m
                 where m.workspace_id=wid and m.user_id=public.hp_user_id() and m.role='admin') then
    return;
  end if;
  return query select i.id,i.invitee_user_id,i.created_at,i.expires_at
    from public.workspace_invitations i
    where i.workspace_id=wid and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
    order by i.created_at desc limit 100;
end $$;
revoke all on function hp_update_workspace(text,text), hp_pending_invitations(text) from public;
grant execute on function hp_update_workspace(text,text), hp_pending_invitations(text) to hireproof_v2_access;
