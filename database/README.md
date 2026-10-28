# HireProof AI — PostgreSQL data layer

This directory plus `lib/repo/postgres.js` implement the PostgreSQL backend for
the repository layer. `lib/repo/index.js` probes it at startup: when
`DATABASE_URL` is set **and** the schema answers, this backend serves every
request; otherwise the app falls back to `lib/repo/memory.js` (the in-memory
demo store). No file outside `database/**` and `lib/repo/postgres.js` was
touched to make this work.

## Files

| File | Purpose |
| --- | --- |
| `migrations/001_initial_schema.sql` | Full application schema (14 tables) + RLS/grant lockdown |
| `migrations/002_pgvector_optional.sql` | Optional pgvector extension + `evidence_embeddings` |
| `run-migrations.js` | Transaction-per-file runner, sha256 checksums, `--status` |
| `seed.js` | Idempotent demo seed from `lib/demo-data.js` (exact ids) |
| `reset.js` | Destructive reset with hardcoded allowlist (needs `--yes`) |
| `smoke-test.js` | Parity + mutation test of `lib/repo/postgres.js` (exit ≠ 0 on mismatch) |
| `load-env.js` | Loads `.env.local` then `.env` for plain-`node` scripts |
| `tls.js` | Shared TLS config for the Supabase pooler |
| `../lib/repo/postgres.js` | The repository backend (same contract as `memory.js`) |

## Quickstart

```bash
node database/run-migrations.js        # or: npm run db:migrate
node database/seed.js                  # or: npm run db:seed   (--force to re-upsert)
node database/smoke-test.js            # verifies every repo method, cleans up after itself
node database/run-migrations.js --status
node database/reset.js --yes           # DESTRUCTIVE: drops allowlisted objects, then re-seed
```

All scripts load `.env.local` themselves (plain `node` has no dotenv) and work
with the Supabase pooler (`:6543`, TLS required — see `tls.js`).

## Design decisions

**Keys.** Text primary keys preserve the demo ids verbatim
(`job-junior-fullstack`, `cand-ava-thompson`, `ev-ava-1`, …) so
`tests/search-eval.json` behaves identically on both backends. Rows created at
runtime use `${prefix}-${8 hex chars}` (e.g. `app-3f2a91c4`).

**camelCase ↔ snake_case.** Mapped explicitly in `postgres.js`. Two renames are
visible to JS: SQL `institution` → JS `school`, SQL `url` → JS `link`.
`end` is a PostgreSQL reserved word and is quoted (`"end"`) everywhere.

**Ordering.** The in-memory store's array order is observable (list order,
search tie-breaks), so several tables carry an internal `ord` column that
reproduces the demo insertion order (`candidates`, `candidate_skills`,
`experiences`, `education`, `projects`). `ord` is never returned. Fixed-width
demo ids (`app-001`, `sub-001`) let the other tables order by `id`.

**Row shapes.** Mappers return exactly the key sets `memory.js` exposes:
no `updatedAt` on candidates/assessments (the demo rows have none);
`resume.storagePath`/`fullText` and `education.start`/`end`/`detail` appear
only when set; evidence `reviewedBy`/`reviewedAt` appear only once reviewed.
`numeric`/`bigint` values are converted with `Number()` (node-postgres returns
them as strings).

**Pool.** One shared `Pool` (max 3, idle 30 s, connect 10 s). All SQL is
parameterised. `closePool()` is exported for scripts and tests.

## Security model

Every table gets **row level security with no policies** and **all privileges
revoked from `anon` and `authenticated`** at the end of migration 001 (plus a
guarded `ALTER DEFAULT PRIVILEGES` revoke so Supabase's stock default ACLs
cannot re-grant future tables). Belt and suspenders:

- RLS alone would make PostgREST reads return `[]` (silent deny);
- the `REVOKE`s make them fail loudly — the REST negative control with the
  publishable key returns `42501 permission denied for table candidates`.

The `postgres` role owns the tables and has `BYPASSRLS`, so the application
itself is unaffected. The `auth`, `storage`, `realtime`, `extensions` and
`graphql_public` schemas are never touched.

`schema_migrations` is bookkeeping only; it also has RLS enabled and no
policies.

## Optional migration 002 (pgvector)

A file named `*optional*.sql` that fails is **not** fatal: the runner rolls it
back, records `status = 'failed'`, prints a warning and continues (it is
retried on every run). Non-optional failures abort with a non-zero exit code.

The `evidence_embeddings.embedding` column is intentionally **untyped**
`vector` so models of different widths (384/1536/3072) can share the table;
`dimensions` records the per-row width. Consequence: pgvector ANN indexes
(`hnsw`/`ivfflat`) refuse an untyped column ("column does not have
dimensions"), so the index creation sits in a guarded `DO` block that logs a
`NOTICE` and succeeds the day the column gains a typmod. Until then the table
is fully usable with sequential scans.

## Known divergences from `memory.js`

These are deliberate and documented; everything else is byte-for-byte
identical in shape (verified by `smoke-test.js`, 74 checks).

1. **`analyticsSummary().searchesLast30d`** — PostgreSQL counts the *true*
   30-day window; memory counts all events ever. Same result on the demo data
   (all events are recent), different once old events accumulate.
2. **`analyticsSummary().weeks`** — the six Monday-anchored ISO weeks are
   computed with correct arithmetic. `memory.js` has a fatal bug there
   (`setUTCDate(getUTCDate() - dow - 5 * msWeek)` subtracts 604 800 000 *days*
   → `RangeError: Invalid time value`); the postgres implementation is the
   working version of the intended behaviour.
3. **`addEvidence()` without a `location`** — memory's return object simply
   has no `location` key; postgres matches that on the return value, but a
   later re-read of the stored row includes `location: null`. The smoke test
   tolerates exactly this (missing key ≡ null for that column).
4. **Requirement arrays** — `requiredSkills`/`preferredSkills` entries always
   expose `{ skill, minYears, note }`; memory passes sparse arrays through
   untouched. The API always sends complete objects (zod schema), so this is
   only observable to direct callers.
5. **Runtime evidence ordering** — `getCandidateEvidence` orders by `id`, which
   matches the demo order for the fixed-width demo ids but is arbitrary for
   uuid-suffixed runtime ids.

## Troubleshooting

- **App says "PostgreSQL unavailable … falling back to the in-memory demo
  store"** — usually "schema not migrated" (run the migrations) or a bad
  `DATABASE_URL`. Every method of `postgres.js` throws
  `schema not migrated — …` when `public.jobs` is missing.
- **`checksum changed since it was applied`** — a migration file was edited
  after being applied. Edit history is not tracked; fix forward with a new
  numbered file instead.
- **Certificate verification** — the default TLS config encrypts but does not
  pin (`rejectUnauthorized: false`), matching Supabase quickstart guidance.
  Drop the project CA bundle at `database/supabase-ca.pem` to switch to full
  verification.
