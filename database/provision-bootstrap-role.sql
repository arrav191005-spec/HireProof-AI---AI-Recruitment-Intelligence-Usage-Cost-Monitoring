-- Cluster-level, operator-reviewed prerequisite. No login or credentials.
-- Administrators grant this group only to a separately managed operator login.
create role hireproof_bootstrap_operator nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
