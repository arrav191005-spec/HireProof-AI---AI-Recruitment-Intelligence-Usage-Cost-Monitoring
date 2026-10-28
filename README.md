# HireProof AI

Evidence-based recruitment intelligence. Every candidate signal is traceable to
a source excerpt with a page number — nothing is inferred, scored opaquely, or
auto-rejected. Claims an extractor cannot locate in the document are labeled
`claimed`, not dressed up as facts.

**Stack:** Next.js 15 (App Router, JavaScript, Tailwind, Lucide, Recharts) ·
Python FastAPI document service · PostgreSQL 17 + pgvector on Supabase ·
Supabase Auth (GoTrue) · npm.

---

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in at least DATABASE_URL
npm run db:migrate && npm run db:seed
npm run service                    # Python document service on :8000 (optional)
npm run dev                        # app on :3000
```

Without a database the app boots on the seeded in-memory store (demo only).
Without the Python service, uploads fall back to the Node PDF parser (unpdf).
Without an `OPENAI_API_KEY`, all AI features run deterministic demo adapters —
clearly labeled in every response, never faked.

### Tests

```bash
npm test                          # 59/59 — extraction, repo, search engine, validation
python-service/.venv/bin/python python-service/tests/test_extraction.py   # 22/22
node database/smoke-test.js       # 74/74 — live Postgres parity + mutations
npm run eval:search               # P@5 0.47 · R@5 0.95 · MRR 1.00 on the judged set
```

---

## Environment variables

See `.env.example` for placeholders and notes. Summary:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | for persistence | Supabase Postgres connection (transaction pooler `:6543`). Server-only. |
| `AUTH_MODE` | no (default `demo`) | `supabase` = real GoTrue sign-in · `demo` = labeled local session |
| `NEXT_PUBLIC_AUTH_MODE` | with the above | Public mirror for the login page — keep identical to `AUTH_MODE` |
| `NEXT_PUBLIC_SUPABASE_URL` | for auth | Supabase project URL (public by design) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | for auth | Browser-safe key — not a secret |
| `AI_SERVICE_URL` | no (default `:8000`) | Python document service. Server-only. |
| `OPENAI_API_KEY` | no | Enables real LLM extraction/questions. Without it: demo mode |
| `OPENAI_CHAT_MODEL` / `OPENAI_EMBEDDING_MODEL` | no | Model names when a key is set |
| `MAX_RESUME_SIZE_MB` | no (default 5) | Upload size limit |

Secrets live only in `.env.local` (gitignored). No key is ever sent to the
client; the Settings page shows masked values read from the live server.

---

## Architecture

```
app/                     Next.js App Router
  (app)/                 Authenticated shell (sidebar + header)
  login/                 Sign-in page (Supabase mode)
  signup/                Sign-up page (Supabase mode; confirmation-aware)
  api/                   18 route handlers (candidates, jobs, search, evidence,
                         assessments, resumes, analytics, health)
components/              UI (ui/, layout/, candidates/, evidence/, assessments/…)
lib/
  api.js                 JSON envelopes, requireUser(), error mapping
  repo/                  Data layer — postgres.js (32 methods) | memory.js
  ai-client.js           Document pipeline: Python service → unpdf → LLM → demo
  extraction.js          Evidence status rules + grounding checks
  search.js              Keyword + evidence matcher with score breakdown
  supabase/              Auth clients (server + browser)
python-service/          FastAPI: /parse-resume (pypdf), /extract-evidence,
                         /interview-questions. Optional LLM behind a key.
database/                Migrations (17 tables + optional pgvector), seed,
                         reset, smoke-test. RLS enabled on every table.
storage/resumes/         Uploaded PDFs + extraction metadata (gitignored)
tests/                   Node test suite + fixtures + judged search set
docs/auth.md             How authentication works in both modes
```

### Evidence statuses (exact vocabulary)

`claimed` · `supporting` · `assessment` · `not_established` · `needs_review`

A resume excerpt the extractor can locate on a page is `supporting`; a claim
with no locatable source is `claimed`. A recruiter's decision never moves or
rejects a candidate — every review is recorded with the reviewer and an audit
log entry.

### Document pipeline

Upload → `POST /api/resumes` parses the PDF (Python service if running, else
unpdf) and stores the file under `storage/resumes/`. Extraction runs in layers:
LLM (only if a key is configured) → deterministic heuristics → demo adapters.
Every excerpt must be a real substring of the parsed text; unlocatable claims
are downgraded, never invented.

### Search

Natural-language or keyword queries, matched against skills, experience and
requirement evidence with a transparent per-factor score breakdown. No
"AI match %". Evaluated on a judged query set (`npm run eval:search`).

### Authentication

Demo mode by default; `AUTH_MODE=supabase` enables real email+password sign-in
with three enforcement layers (middleware, layout, API `requireUser()`), plus
open self-registration at `/signup` (GoTrue; shows the confirmation-vs-sign-in
path actually taken — see `docs/auth.md`).
Details, setup and limitations: [`docs/auth.md`](docs/auth.md).

### Data layer

`lib/repo/postgres.js` and `lib/repo/memory.js` implement the same interface.
The backend is chosen automatically (Postgres if `DATABASE_URL` is reachable
and migrated, else memory with a logged warning). All 17 tables have RLS
enabled with no policies plus revoked anon/authenticated grants — database
access only works through the server.

---

## Test results (2026-10-28)

| Suite | Result | What it covers |
|---|---|---|
| `npm test` | **59/59 pass** | Extraction (ISO dates, education split, grounding), repo memory-parity, search engine, validation schemas |
| Python extraction | **22/22 pass** | Date-range formats (ISO/month/plain), role summaries, education years, grounding, plausibility guards |
| `node database/smoke-test.js` | **74/74 pass** | Live Postgres read parity vs oracle, all mutations, RLS/grants, row-count restore |
| `npm run eval:search` | P@5 **0.47** · R@5 **0.95** · MRR **1.00** | Judged query set against the live engine (results are honestly mediocre — see limitations) |
| `npm run build` | passes | Production build incl. middleware + login/signup routes |

Browser-verified end-to-end on the live Postgres backend: dashboard, search,
filters, profile tabs, evidence review (PATCH → verified in psql), requirement
matrix, interview questions, assessment review (incl. a 422 for an
out-of-range score surfaced in the UI), analytics run matching the CLI exactly,
settings probing all live services, full upload→create flow through the Python
service, Supabase Auth (login, session enforcement, review attribution,
sign-out, wrong-password state), the full sign-up flow (validation errors,
GoTrue account creation → "Confirm your email", honest unconfirmed-sign-in
error, and a confirmed sign-in whose sidebar shows the real `full_name`
metadata), and the 375×812 mobile layout with its
navigation drawer.

---

## Deployment (live)

| Piece | Where | URL |
|---|---|---|
| Next.js frontend + API | Cloudflare Workers (OpenNext) | https://hireproof-ai.hireproof-ai.workers.dev |
| Python document service | Render (Free, Singapore) | https://hireproof-documents.onrender.com |
| PostgreSQL + Auth | Supabase (Tokyo, pooler `:6543`) | — |

### Cloudflare Workers (frontend)

Built with `@opennextjs/cloudflare` + wrangler:

```bash
npm run preview     # local workerd on :8787 (reads .dev.vars, gitignored)
npm run deploy      # opennextjs-cloudflare build + wrangler deploy
```

- Non-secret vars live in `wrangler.jsonc`: `AUTH_MODE=supabase`,
  `AI_SERVICE_URL=https://hireproof-documents.onrender.com`.
- `DATABASE_URL` is a **secret**: `grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"' | npx wrangler secret put DATABASE_URL`
- `compatibility_flags: ["nodejs_compat"]` — `node:net`/`node:tls` shims are
  what let `pg` open TCP to the Supabase pooler from workerd.
  `global_fetch_strictly_public` is deliberately omitted so preview can call
  `http://127.0.0.1:8000` locally.
- Binding access goes through `getCloudflareContext().env.X` (never
  `process.env` for bindings). Runtime detection:
  `navigator.userAgent === "Cloudflare-Workers"`.

### Render (document service)

- Service `hireproof-documents`, root `python-service`, start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Connected as a **Public Git Repository** → redeploys are manual (Render
  dashboard → Manual deploy), no auto-deploy on push without a Blueprint.
- Free tier sleeps when idle: first request after idle takes ~30 s. The
  Settings probe uses a 1.5 s timeout, so a cold instance can transiently show
  "not running" — refresh once it wakes.

### Verified live (2026-10-28)

Browser end-to-end on the deployed workers.dev URL: `/api/health` →
`dataBackend: postgres` · sign-in → Overview with no demo banner (12
candidates) · search → 9 matches with requirement-evidence labels · candidate
detail with extraction + evidence tabs · upload → create → double-submit 409
guard · Settings (PostgreSQL · Supabase Auth · document service running
v1.0.0 · in-memory storage honestly labeled) · sign-out → `/login` + API 401 ·
fresh-page console clean.

---

## Known limitations

- **Search quality is a baseline.** P@5 0.47 on the judged set — the ranking is
  keyword+evidence matching, not a trained model. The eval numbers are shown
  in the UI exactly as measured; they are not marketed up.
- **tsvector column is a starting point.** `candidates.search_tsv` covers
  name/headline/summary/company for DB-native keyword search; the shipped
  ranking engine runs in-process, not in SQL.
- **pgvector is optional and untyped.** Migration 002 creates an untyped
  `vector` column (multi-model flexibility) which cannot take an ANN index
  until it gains a typmod; sequential scans work.
- **Supabase pooler only.** The app connects through the transaction pooler
  (`:6543`); direct connections (`:5432`) are not exercised. TLS defaults to
  encrypted-but-unpinned (drop `database/supabase-ca.pem` to pin).
- **Auth is single-workspace.** All recruiters share one workspace; no
  per-user data isolation beyond the session. Sign-up UI exists (`/signup`);
  there is no password-reset UI — admins also provision users directly in the
  Supabase dashboard (`docs/auth.md`).
- **Demo and real environments share one deployment.** The Settings page warns
  about this; a production deployment should partition environments.
- **Search-quality `lastRun` is in-memory.** The Analytics "Run evaluation"
  result resets to "no run yet" on server restart — it is never cached or faked.
- **Extractor conservatism.** The heuristics prefer missing data over guessing:
  unusual resume layouts may yield fewer entries than a human would extract.
  The review step exists precisely for humans to fill those gaps.
- **Resume storage is runtime-dependent.** Local/dev stores files on disk
  (`storage/resumes/`). On the deployed Worker there is no filesystem and no
  R2 binding (subscription not activated), so upload sessions live in a
  **per-isolate in-memory map**: the `.meta.json` survives until a cold start,
  the raw PDF bytes are not retained, and upload→save must hit the same
  isolate — a miss returns an honest 404 ("upload session is no longer
  available") rather than a fabricated success; the duplicate-submit guard
  still prevents double creation (409 when the isolate is shared). Enabling
  durable R2 later needs no code change — steps are commented in
  `wrangler.jsonc` (`r2_buckets`).
- **Workers ↔ Supabase over plain TCP.** workerd's `node:tls` shim does not
  implement `rejectUnauthorized` (it throws), and the pooler certificate is
  rejected by its verifier — so on Workers the pooler connection runs
  **unencrypted plain TCP** (`database/tls.js` returns `ssl: false`, verified
  accept by the pooler). On Node the same config uses TLS. Related: workerd
  also wedges when an idle pooled connection is reused, so Workers opens a
  **fresh `pg` Client per query** (`lib/repo/postgres.js`) instead of a pool —
  correct but with per-query connection overhead.
- **Render has no auto-deploy.** The service tracks the repo as a public Git
  repository, so pushes to GitHub do not redeploy it — trigger a Manual
  deploy from the Render dashboard. The free instance also sleeps when idle
  (~30 s cold start; the Settings probe may transiently show "not running").
- **No rate limiting or CSRF hardening** beyond SameSite cookies — fine for a
  demo, add a gateway before real traffic.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server on :3000 (reads `.env.local`) |
| `npm run preview` | Production build served by local workerd on :8787 (Cloudflare parity) |
| `npm run deploy` | Build + `wrangler deploy` to Cloudflare Workers |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Node test suite (plain `node --test`, no deps) |
| `npm run service` | Python FastAPI document service (venv-aware) |
| `npm run db:migrate` | Apply migrations (idempotent; `--status` to inspect) |
| `npm run db:seed` | Upsert the demo dataset (safe to re-run) |
| `npm run db:reset` | Drop all tables (requires `--yes`) |
| `node database/smoke-test.js` | 74-check live database verification |
| `npm run eval:search` | Search quality metrics on the judged set |
