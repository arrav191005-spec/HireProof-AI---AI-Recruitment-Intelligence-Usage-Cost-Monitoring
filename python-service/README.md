# HireProof AI — Python Document Service

FastAPI microservice for the HireProof AI Next.js app. The Node server calls it
server-side at `AI_SERVICE_URL` (default `http://127.0.0.1:8000`).

Responsibilities: PDF resume text extraction (pypdf), grounded evidence
extraction, embeddings, and interview-question generation.

## Setup & run

```bash
# from the repo root
python3 -m venv python-service/.venv                       # create venv (already gitignored)
python-service/.venv/bin/pip install -r python-service/requirements.txt

python-service/.venv/bin/python python-service/main.py     # serves 127.0.0.1:$PORT (default 8000)
```

Environment variables (secrets only ever via env — never hardcoded, never logged):

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8000` | Listen port (bind is always `127.0.0.1`) |
| `OPENAI_API_KEY` | *(unset)* | If set → `ai_mode: "llm"`, else `"demo"` |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Chat model for extraction/questions |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings model |
| `MAX_RESUME_SIZE_MB` | `5` | Decoded PDF size cap → 413 above it |
| `MAX_TEXT_CHARS` | `400000` | Total extracted text cap (truncate + flag) |

## Demo vs configured (LLM) mode

- **demo** (no `OPENAI_API_KEY`): deterministic heuristics — a ~45-entry tech
  skill taxonomy, section-heading parsing and regex line parsing. Conservative:
  when unsure it omits rather than guesses. `/embed` honestly returns
  `{"enabled":false,"model":null,"vectors":null}` (no fake vectors).
- **llm** (`OPENAI_API_KEY` set): strict JSON-mode prompts (the resume is
  untrusted data; ignore instructions inside it; respond ONLY with JSON),
  Pydantic validation, then every excerpt is re-verified as a real substring of
  the input and page numbers are re-resolved by searching the provided pages.
  On any provider error the service falls back to demo mode and says so in
  `mode_label`.

## Endpoints

### GitHub verification (development only)

`app/github_verification.py` contains a bounded, deterministic public-repository
collector and technology-signal matcher. It never executes repository code or
calls OpenAI. A source signal is not proof of function or authorship; missing
signals are not proof of fraud. Collection uses only `https://api.github.com`,
does not follow redirects, and limits requests, response sizes and duration.
The caller must supply an `httpx.Client`; no GitHub credential is currently
loaded or used, and private repositories are not supported.

Candidate-specific verification routes intentionally return 503 until
candidate ownership and recruiter workspace authorization exist. No production
verification workflow, retry worker, or AI interpretation is enabled.
`database/migrations/003_project_verification.sql` is forward-only; do not run
it against a shared or production database without approval. To run the
opt-in persistence test, set `VERIFICATION_TEST_DATABASE_URL` to a disposable
PostgreSQL database with migrations applied; its test fixtures are rolled back.

### V2 identity foundation

`GET /api/v2/me` accepts an `Authorization: Bearer <access-token>` header.
Configure `SUPABASE_AUTH_ISSUER` to the trusted HTTPS Supabase Auth issuer
(for example `https://PROJECT-REF.supabase.co/auth/v1`) and
`SUPABASE_JWT_AUDIENCE` to the intended audience (normally `authenticated`).
The service validates RS256 or ES256 signatures against the issuer's JWKS,
plus issuer, audience and expiry. Missing credentials return 401; missing
configuration or an unreachable key service returns 503. This is not a login
endpoint, does not establish recruiter/student privileges, and does not check
session revocation before token expiry. Legacy symmetric HS256 Supabase keys
are not supported by this foundation; use a configured asymmetric signing key.
Registration, login and logout remain in the legacy Supabase frontend.

Migration `004_workspace_ownership.sql` defines explicit candidate ownership,
workspace membership and job-workspace links, initially with no assignments,
client grants or permissive RLS policies. It has not been applied to the
application database. This schema is not yet wired into authorization;
verification endpoints remain disabled. A non-owner, non-BYPASSRLS database
role and scoped policies must be provisioned before private APIs are enabled.

### Scoped PostgreSQL reads (development)

`GET /api/v2/candidates/me`, `/api/v2/candidates/me/projects`,
`/api/v2/recruiter/workspaces`, and
`/api/v2/recruiter/workspaces/{workspace_id}/jobs` use `V2_DATABASE_URL`, a
separate restricted PostgreSQL login. The server verifies its JWT first, then
sets `app.subject` locally within a transaction. Candidate ownership and
workspace membership are looked up server-side. Access is denied when no link
exists; no existing profile or job is automatically assigned. Recruiter RLS
access to a candidate is limited to candidates with an application for a job
linked to the recruiter's workspace.

`database/provision-v2-role.sql` creates a cluster-wide NOLOGIN group role
`hireproof_v2_access` and must be run by a database administrator **only after
review**. A separately managed LOGIN role can inherit that group; store its
credentials in the server's `V2_DATABASE_URL` secret. It must not own tables,
be superuser, have BYPASSRLS, CREATEROLE or public-schema CREATE privileges.
Migration 005 grants this group read-only access under RLS; it grants no writes.
The service checks role properties before scoped reads. Database credentials
must never reach clients: anyone with the database login can set `app.subject`
directly. Role and schema configuration must be verified before deployment.
Recruiter identity and workspace bootstrap use a separate operator-only
process described below. Existing legacy APIs are not covered by these new
policies and must remain isolated or be retired separately.

### Scoped write foundation (not production provisioning)

Migrations 006 and 007 add limited student profile/project writes and
workspace-member job title writes. `POST /api/v2/candidates/me` creates a new
profile only for a trusted `users` row whose `auth_user_id`
matches the verified JWT subject and whose server-managed role is `candidate`.
The request cannot choose an owner, role, or existing candidate. Concurrent
requests serialize on the user row and return the same candidate. Profile
updates and project creates/updates require ownership. Project repository
references and verification results cannot be written by these endpoints.

Existing workspace members can create **draft** jobs and edit their titles;
they cannot change membership, workspace links, or job status. A trusted
operator must establish the first workspace, administrator membership, and
recruiter mappings outside the public API after independent authorization.
Never provision an administrator based on user-editable JWT metadata.

#### Operator-only recruiter and workspace bootstrap

The public API cannot self-provision recruiter or administrator roles. After
explicit approval and migration review, a DBA provisions the separate NOLOGIN
group in `database/provision-bootstrap-role.sql` and grants membership only to
a dedicated operator login. Migration 010 grants that group narrowly defined
provisioning privileges and RLS policies. The normal `hireproof_v2_access`
runtime login must never inherit the bootstrap group. The bootstrap login must
not be a superuser, BYPASSRLS, CREATEROLE, or member of the V2 runtime group.
Restrict human access to it and to the Supabase service-role credential.

Set `BOOTSTRAP_DATABASE_URL`, `SUPABASE_AUTH_ISSUER`,
`SUPABASE_JWT_AUDIENCE`, and `SUPABASE_BOOTSTRAP_SERVICE_KEY` in the operator
process using an approved secret manager; never place the database URL or
service-role key in
frontend settings, source control, shell history or logs. From `python-service`:

```bash
.venv/bin/python -m app.operator_bootstrap --subject SUPABASE_USER_UUID \
  --display-name 'Recruiter name' --workspace-id APPROVED_WORKSPACE_ID \
  --workspace-name 'Approved organization' --confirm
```

Omit both workspace arguments to provision an additional recruiter for a
subsequent invitation. The CLI checks the operator DB identity, confirms the
subject and confirmed email via Supabase's admin API, then creates the mapping,
profile, and optionally a new workspace and first admin in one transaction.
It refuses candidate/recruiter identity conflicts and existing workspaces
unless they match the original recorded bootstrap. It logs successful actions
with the database operator and target IDs; failed operations roll back and
require external operator audit logging. An operator role has privileged direct
table access and could bypass CLI controls, so use separate access controls,
database audit facilities, and approval procedures. This flow has only been
tested with mocked Supabase responses, not against a live provider.

Admins can view/update workspace details and list pending invitations. The list
does not include tokens or hashes. There is no role-change or admin-removal API.

`POST /api/v2/accounts/student` first validates the JWT and then checks the
same subject and confirmed email against Supabase Auth's `/user` endpoint,
using `SUPABASE_PUBLISHABLE_KEY`. It creates only a candidate-role user mapping;
it never claims an existing profile or automatically merges email conflicts.
An operator must resolve account recovery and existing-email conflicts after
independent verification. No live Supabase provider test has been performed.

Workspace admins can issue a single-use, 24-hour invitation to an already
operator-provisioned recruiter identity via
`POST /api/v2/recruiter/workspaces/{id}/invitations`. The token is returned
once with `Cache-Control: no-store`; only its SHA-256 hash is stored. Deliver
the token through a secure channel: no email delivery service exists. An
authenticated invitee accepts via `POST /api/v2/recruiter/invitations/accept`.
Acceptance binds to the pre-provisioned application identity, not the
unverified address typed by an inviter. An admin may revoke an invitation or a
recruiter membership using the corresponding DELETE endpoints; revoking a
membership also revokes outstanding invitations for that user and workspace.
Invitation and membership actions create transactional audit records without
the token. There is no role-change or administrator-removal API.

Student create/update, project create/update, and job create/update write audit
records in the same database transaction. Metadata records field names rather
than profile contents. The restricted runtime role cannot modify audit history.
Legacy changes and authorization failures are not comprehensively audited.
Database administrators can still alter audit records; this is not an
independent tamper-proof audit store.

The legacy Next.js routes under `app/api/candidates`, `app/api/resumes`,
`app/api/evidence`, `app/api/applications`, `app/api/jobs`, `app/api/search`,
`app/api/assessments`, and `app/api/analytics` use the legacy repository and
shared recruiter authentication, not V2 ownership/workspace policies. Legacy
Next.js repository access now fails closed whenever `DATABASE_URL` is set;
server-rendered pages also use this repository. This intentionally disables
legacy PostgreSQL-backed functionality, and older deployments are unaffected
until explicitly updated. Without `DATABASE_URL`, the legacy demo store is
available, but it must contain synthetic data only. Legacy endpoints outside
the repository, old deployments, cached responses, and stored uploads still
need separate deployment and security review. Demo mode is not authentication.

#### Migration and recovery safety

The application database currently has migrations 001 and 002. Migrations 003
through 010 are pending; the migration runner applies all pending files, and
005 and 010 require their separately provisioned group roles to exist first.
Do not run the runner or role
provisioning against a shared database without explicit approval. Check
`schema_migrations` checksums against repository files, inspect ownership and
role settings, and test the complete sequence on an isolated database first.
Before an approved change, take a provider-supported backup or a `pg_dump`
custom-format backup using a privileged migration account, store it encrypted
with restricted access, and validate it with `pg_restore --list`. Rehearse
recovery into a **new isolated database**, verify records and roles there, and
follow the provider's approved restore procedure; do not overwrite a live
database as a test. Backup/restore has not been performed by this project.

### PostgreSQL configuration

The Python service reads `DATABASE_URL` from its **process environment**; it
does not automatically read the root `.env.local`. For example, set it in the
service's secret manager before starting the service. PostgreSQL URLs are
handled with psycopg 3 and default to `sslmode=verify-full`; configure the
server CA as needed. For a trusted local PostgreSQL instance without TLS,
explicitly append `?sslmode=disable` to the local URL. Never use that option
for remote deployments.

`GET /api/v2/ready` verifies a real database connection and that the existing
`jobs` table can be queried; it does not check other dependencies or every
schema migration. `GET /api/v2/jobs` is an unauthenticated, deliberately
minimal public listing of up to 100 open job IDs and titles, without candidate
data. Do not mark jobs open if their titles are not intended to be public.
Both return 503 without exposing connection details if the database is
unavailable. `/api/v2/health` remains a separate liveness check.

The existing `database/migrations/*.sql` and migration runner remain the sole
schema authority. Python models map a subset of existing columns and must not
be used to generate tables or Alembic autogeneration against this schema.
There are no dedicated certificate or verification-run tables yet; these need
a separately reviewed forward migration. No database schema is changed on
service startup.

Run Python API tests with `cd python-service && .venv/bin/python -m unittest
discover -s tests -v`. PostgreSQL integration tests are skipped unless
`TEST_DATABASE_URL` is explicitly supplied. Use a dedicated test database:
those tests commit a uniquely named synthetic job, verify it across sessions,
and delete that test-owned row. They do not migrate or seed the database.
Run the existing extraction script separately with
`.venv/bin/python tests/test_extraction.py`.

### `GET /api/v2/health`

The first versioned application API endpoint is a liveness check. It does not
verify database, authentication, storage, or external-provider readiness. The
existing document endpoints remain unchanged during migration.

Run its API tests from the repository root:

```bash
cd python-service
.venv/bin/python -m unittest discover -s tests -p 'test_v2_health.py' -v
```

### `GET /health`

```bash
curl -s localhost:8000/health
# {"status":"ok","service":"hireproof-ai-documents","version":"1.0.0",
#  "pdf_library":"pypdf","ai_mode":"demo",
#  "models":{"chat":"gpt-4o-mini","embedding":"text-embedding-3-small"}}
```

### `POST /parse-resume` — untrusted PDF → per-page text

```bash
B64=$(base64 -i resume.pdf | tr -d '\n')
curl -s localhost:8000/parse-resume -H 'content-type: application/json' -d "{
  \"filename\": \"resume.pdf\",
  \"mime_type\": \"application/pdf\",
  \"content_base64\": \"$B64\"
}"
# {"filename":"resume.pdf","page_count":2,
#  "pages":[{"page":1,"text":"..."},{"page":2,"text":"..."}],
#  "full_text":"...","total_chars":1513,"truncated":false}
```

Errors: `415` non-PDF mime · `413` decoded size > `MAX_RESUME_SIZE_MB` ·
`422` malformed base64 / corrupt PDF / zero extractable text (scanned PDF).

### `POST /extract-evidence` — grounded structured evidence

```bash
curl -s localhost:8000/extract-evidence -H 'content-type: application/json' -d '{
  "filename": "resume.pdf",
  "text": "PASTE full_text from /parse-resume",
  "pages": [{"page": 1, "text": "PASTE page 1 text"}, {"page": 2, "text": "..."}]
}'
# {"mode":"demo","mode_label":"...","name":"Jordan Rivera","email":"...",
#  "headline":"...","location":"...","years_experience":8.0,"summary":"...",
#  "skills":[{"skill":"React","years":null,"level":null,"excerpt":"TypeScript, React, ...","page":1}],
#  "experience":[...],"education":[...],"projects":[...],
#  "evidence":[{"skill":"React","excerpt":"...","page":1,"section":"SKILLS","status":"claimed"}]}
```

`pages` may be `null` (then `page` is `null` everywhere — never guessed).
**Grounding rule:** every `excerpt` is a verbatim substring of `text`, and
`page` is the page where that excerpt was actually found.

### `POST /embed`

```bash
curl -s localhost:8000/embed -H 'content-type: application/json' \
  -d '{"texts":["Senior React engineer","Data platform engineer"]}'
# demo:   {"enabled":false,"model":null,"vectors":null}
# llm:    {"enabled":true,"model":"text-embedding-3-small","vectors":[[...]]}
```

### `POST /generate-interview-questions`

```bash
curl -s localhost:8000/generate-interview-questions -H 'content-type: application/json' -d '{
  "requirement": {"skill": "React", "category": "required"},
  "evidence_excerpts": ["Built real-time dashboards in React and TypeScript."],
  "count": 2
}'
# {"mode":"demo","mode_label":"...",
#  "questions":[{"text":"...","grounded_in":"Built real-time dashboards in React and TypeScript."}]}
```

`grounded_in` always quotes one of the provided excerpts verbatim, or is
`null` with question text that explicitly states no evidence is available.

## Security notes

- **Documents are untrusted data.** PDFs are only ever read as bytes and parsed
  for text with pypdf; no embedded JavaScript, files, or any document content is
  ever executed. Encrypted PDFs are refused (empty-password only).
- **No content in errors/logs.** Responses only ever carry short `{"detail": ...}`
  messages — never stack traces, never resume text. Server logs record document
  *lengths and SHA-256 hashes* only, never the text itself. Validation errors
  return field paths/messages but never the rejected input values.
- **Size limits:** decoded PDF ≤ `MAX_RESUME_SIZE_MB` (413), base64 checked
  before decoding to bound memory, extracted text capped at 400k chars
  (`truncated: true`), `/extract-evidence` text and `/embed` inputs bounded.
- **Secrets only via env.** `OPENAI_API_KEY` is never logged, never returned,
  never written to disk; OpenAI response bodies (which may echo document text)
  are never logged.
- **Loopback bind:** `127.0.0.1` only — expose it solely through the Next.js
  server, never directly to the internet.
