-- Run only as an administrator after reviewing the target PostgreSQL cluster.
-- This is cluster-wide, NOT a migration. It is intentionally NOLOGIN and has
-- no password; provision a separate LOGIN role and membership via your secret
-- manager. Never grant this role SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB.
create role hireproof_v2_access nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
