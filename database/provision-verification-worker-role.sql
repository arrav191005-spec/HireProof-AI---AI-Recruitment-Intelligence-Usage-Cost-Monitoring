-- Cluster-level prerequisite, reviewed and executed by an administrator.
-- Grant only to a separately managed verification worker login.
create role hireproof_verification_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
