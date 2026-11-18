# Phase 11 development runbook

This runbook connects a **new, isolated development** Supabase project to the
existing HireProof AI V2 verification workflow. It does not configure a
production project, use mock identities for live authentication, or require
any credential to be added to source control.

## Current environment boundary

The checked-out environment does not have a Supabase project configured:

- `.env.local` has `AUTH_MODE=demo` and `NEXT_PUBLIC_AUTH_MODE=demo`;
- the public Supabase URL and publishable key are empty;
- no local Supabase stack is installed or running.

The UI therefore shows its setup state instead of creating a synthetic
student. Do not change the mode until the steps below are complete.

## 1. Create the development Auth project

1. Create a separate Supabase development project in the Supabase dashboard.
   Do not reuse a production project.
2. In **Authentication → Providers → Email**, enable email/password sign-in.
   Keep email confirmation enabled so the application can require a confirmed
   provider identity.
3. In **Authentication → URL Configuration**, add these development URLs:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/**` and
     `http://127.0.0.1:3000/**`
4. In **Authentication → JWT**, configure asymmetric signing keys (RS256 or
   ES256). The FastAPI service deliberately rejects legacy HS256 access
   tokens. Confirm that
   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` is
   available.
5. Create a dedicated development test student through the dashboard or the
   normal sign-up flow, then confirm that email. Do not use a real candidate,
   a production account, or share that account password.

The browser publishable key is intentionally public. Never use the
`service_role` key in the browser, in `NEXT_PUBLIC_*` variables, or in this
repository.

## 2. Configure local processes

Store values in local ignored environment files or the process manager's
secret store; do not commit them. Replace placeholders locally:

```dotenv
# .env.local — Next.js browser/server process
AUTH_MODE=supabase
NEXT_PUBLIC_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

```dotenv
# FastAPI process environment; retain the restricted isolated DB URL generated
# in .env.dev.local. The publishable key is used only to authenticate /user.
SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
V2_DATABASE_URL=<isolated API login URL from .env.dev.local>
API_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
VERIFICATION_ENABLED=true
```

```dotenv
# Verification worker environment only
VERIFICATION_WORKER_DATABASE_URL=<isolated worker login URL from .env.dev.local>
VERIFICATION_ENABLED=true
# Optional: server-side only, to avoid anonymous GitHub rate limits.
GITHUB_TOKEN=<fine-grained token with public repository read access>
```

`VERIFICATION_ENABLED=true` is permitted only in the isolated development
environment. Leave it disabled in all production and shared environments.

Start the processes separately:

```bash
# terminal 1
npm run dev

# terminal 2
cd python-service
.venv/bin/uvicorn app.main:app --reload --port 8000

# terminal 3: invoke from a scheduler or manually for development
cd python-service
.venv/bin/python -m app.verification_worker
```

The browser calls FastAPI directly with its Supabase bearer token; no Next.js
verification API route is introduced. The worker is the only process that can
claim jobs and finalize evidence.

## 3. Verify the live authentication boundary

With a dedicated, confirmed development test user, set these variables only in
your shell/secret manager and run:

```bash
cd python-service
LIVE_SUPABASE_TEST=1 \
LIVE_SUPABASE_URL=https://<project-ref>.supabase.co \
LIVE_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
LIVE_SUPABASE_TEST_EMAIL=<dedicated test email> \
LIVE_SUPABASE_TEST_PASSWORD=<dedicated test password> \
.venv/bin/python -m unittest tests.test_live_supabase_optional -v
```

This opt-in test signs in through GoTrue, checks the subject against
`/auth/v1/user`, confirms the email is verified, validates the token through
FastAPI's real JWKS path, and rejects a malformed bearer token. It prints no
token or password and makes no database writes.

Then use `/login?next=/verification` in a browser:

1. Sign in as the confirmed test student.
2. Confirm the profile/session card is shown and create the student profile.
3. Register a project.
4. Submit a public canonical GitHub URL and one or more technology claims.
5. Run the worker; wait for the progress state to complete.
6. Review the commit-pinned report, source links, technology metadata, and
   claim groups.
7. Use **Reverify repository** to create a fresh run.
8. Use **Sign out**, then confirm `/verification` returns to the authenticated
   sign-in flow.

The middleware refreshes valid sessions with Supabase SSR. The verification
client retries one FastAPI request after `refreshSession()` on a 401 and
displays sanitized authentication/provider failures. As with many JWT
integrations, FastAPI cannot detect a server-side session revocation before the
short-lived access token expires; reduce token lifetime and rely on normal
Supabase refresh/session controls until token-introspection or a revocation
check is designed.

## 4. Database migration and report data

`database/migrations/014_verification_report_metadata.sql` is forward-only.
It adds the bounded `repository_languages` JSONB field to
`project_verification_runs` and replaces the worker finalizer with:

```sql
hp_finish_verification_job(text, text, text, jsonb, jsonb, text)
```

Only the restricted worker role can execute it. The function validates at most
30 language names (1–60 printable characters) and numeric byte counts before
completion. Apply it only to the isolated development database:

```bash
set -a; . ./.env.dev.local; set +a
DATABASE_URL="$DEV_DATABASE_URL" DATABASE_SSL=disable node database/run-migrations.js
```

Do not apply migrations 003–014 to the existing shared/application database
without explicit review and approval.

## Evidence scope

The collector reads only public GitHub metadata, the default-branch commit,
language bytes, a recursive tree, and a bounded set of small files. It never
clones or executes repository code. File selection reserves part of its budget
for diverse source extensions rather than spending it only on README files and
manifests. A matching static signal supports a technology claim only; it does
not prove the candidate authored the repository, the project functions, or it
is deployed.

For the optional real public-GitHub API → worker → PostgreSQL → report test,
first create a disposable migrated `hireproof_rls_*` database and provide its
restricted test URLs, then run:

```bash
cd python-service
LIVE_GITHUB_WORKFLOW_TEST=1 \
RLS_TEST_ADMIN_URL=<disposable admin URL> \
RLS_TEST_APP_URL=<disposable restricted API URL> \
VERIFICATION_TEST_WORKER_URL=<disposable restricted worker URL> \
.venv/bin/python -m unittest tests/test_live_github_workflow_optional.py -v
```

It uses synthetic database fixture rows solely to exercise database ownership
and RLS in the disposable database; it performs a real public GitHub
collection. It uses a server-side `GITHUB_TOKEN` automatically if one is
configured, otherwise it is subject to GitHub's anonymous API rate limit.
