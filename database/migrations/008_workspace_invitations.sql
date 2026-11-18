-- Invitations bind to an already trusted application user, not an unverified
-- email supplied by a caller. Only SHA-256 token digests are stored.
create table workspace_invitations (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  invitee_user_id text not null references users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index workspace_invitations_workspace_idx on workspace_invitations(workspace_id, created_at desc);
alter table workspace_invitations enable row level security;
revoke all on workspace_invitations from public, anon, authenticated, hireproof_v2_access;

create function hp_create_invitation(wid text, invitee text, digest text) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; iid text;
begin
  uid := public.hp_user_id();
  perform 1 from public.workspace_memberships
    where workspace_id=wid and user_id=uid and role='admin' for share;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.users where id=invitee and role='recruiter' and auth_user_id is not null)
     or digest is null or digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation' using errcode='22023';
  end if;
  iid := 'inv-' || gen_random_uuid()::text;
  insert into public.workspace_invitations(id,workspace_id,invitee_user_id,token_hash,created_by,expires_at)
    values (iid,wid,invitee,digest,uid,now()+interval '24 hours');
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'invitation.create','invitation',iid,
            jsonb_build_object('workspace_id',wid,'invitee_user_id',invitee));
  return iid;
end $$;

create function hp_accept_invitation(digest text) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text; inv public.workspace_invitations%rowtype;
begin
  uid := public.hp_user_id();
  select * into inv from public.workspace_invitations where token_hash=digest for update;
  if not found or uid is null or inv.invitee_user_id<>uid or inv.accepted_at is not null
     or inv.revoked_at is not null or inv.expires_at<=now()
     or not exists (select 1 from public.users where id=uid and role='recruiter') then
    return null;
  end if;
  -- Never alter an existing role (especially admin) on invitation acceptance.
  insert into public.workspace_memberships(workspace_id,user_id,role)
    values (inv.workspace_id,uid,'recruiter') on conflict (workspace_id,user_id) do nothing;
  update public.workspace_invitations set accepted_at=now() where id=inv.id;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'membership.accept','workspace',inv.workspace_id,
            jsonb_build_object('invitation_id',inv.id));
  return inv.workspace_id;
end $$;

create function hp_revoke_invitation(wid text, iid text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text;
begin
  uid := public.hp_user_id();
  perform 1 from public.workspace_memberships where workspace_id=wid and user_id=uid and role='admin' for share;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  update public.workspace_invitations set revoked_at=now()
    where id=iid and workspace_id=wid and accepted_at is null and revoked_at is null;
  if not found then return false; end if;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'invitation.revoke','invitation',iid,
            jsonb_build_object('workspace_id',wid));
  return true;
end $$;

create function hp_revoke_recruiter(wid text, target text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid text;
begin
  uid := public.hp_user_id();
  perform 1 from public.workspace_memberships where workspace_id=wid and user_id=uid and role='admin' for share;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  -- Only recruiters may be removed; admin lifecycle needs a separate workflow.
  delete from public.workspace_memberships where workspace_id=wid and user_id=target and role='recruiter';
  if not found then return false; end if;
  -- Outstanding invitations must not silently undo a membership revocation.
  update public.workspace_invitations set revoked_at=now()
    where workspace_id=wid and invitee_user_id=target
      and accepted_at is null and revoked_at is null;
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values ('audit-' || gen_random_uuid()::text,uid,'membership.revoke','workspace',wid,
            jsonb_build_object('user_id',target));
  return true;
end $$;

revoke all on function hp_create_invitation(text,text,text), hp_accept_invitation(text),
  hp_revoke_invitation(text,text), hp_revoke_recruiter(text,text) from public;
grant execute on function hp_create_invitation(text,text,text), hp_accept_invitation(text),
  hp_revoke_invitation(text,text), hp_revoke_recruiter(text,text) to hireproof_v2_access;
