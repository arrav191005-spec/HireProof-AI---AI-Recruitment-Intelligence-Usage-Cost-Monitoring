-- The trusted FastAPI service must verify the subject AND confirmed email
-- against Supabase before calling this function. No client-provided role,
-- application user ID, existing candidate ID or ownership link is accepted.
create function hp_provision_student_identity(confirmed_email text) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare subject text; normalized text; uid text;
begin
  subject := nullif(current_setting('app.subject',true),'');
  normalized := lower(btrim(confirmed_email));
  if subject is null or length(subject)>128 or normalized is null
     or length(normalized) not between 3 and 254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    return null;
  end if;
  -- Serialize both same-subject requests and competing email claims.
  perform pg_advisory_xact_lock(hashtextextended('student-subject:' || subject, 0));
  perform pg_advisory_xact_lock(hashtextextended('student-email:' || normalized, 0));
  select id into uid from public.users where auth_user_id=subject;
  if uid is not null then
    if exists (select 1 from public.users where id=uid and role='candidate') then return uid; end if;
    return null;
  end if;
  if exists (select 1 from public.users where lower(email)=normalized) then return null; end if;
  uid := 'user-' || gen_random_uuid()::text;
  insert into public.users(id,auth_user_id,email,role) values(uid,subject,normalized,'candidate');
  insert into public.audit_logs(id,actor,action,entity_type,entity_id,metadata)
    values('audit-' || gen_random_uuid()::text,uid,'identity.student.create','user',uid,'{}'::jsonb);
  return uid;
end $$;
revoke all on function hp_provision_student_identity(text) from public;
grant execute on function hp_provision_student_identity(text) to hireproof_v2_access;
