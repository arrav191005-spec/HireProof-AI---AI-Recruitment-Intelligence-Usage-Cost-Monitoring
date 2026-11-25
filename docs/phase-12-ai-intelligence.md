# Phase 12 AI intelligence

## Status and safety boundary

The Phase 12 intelligence layer is implemented as a backend-only, opt-in
feature. It is **disabled by default**, including in production. A missing
OpenAI key or disabled feature flag returns a clear unavailable response; it
never substitutes synthetic AI output.

The current environment has no configured `OPENAI_API_KEY`, so real provider
calls have not been run. Deterministic `FixtureAIProvider` tests cover the
request, grounding, persistence, cost accounting, and authorization paths.

## Required backend configuration

Set these only in the FastAPI process/secret manager for the isolated
development environment:

```dotenv
AI_ANALYSIS_ENABLED=true
OPENAI_API_KEY=<server-side key>
# OPENAI_MODEL is preferred; OPENAI_RESUME_MODEL remains supported.
OPENAI_MODEL=<Responses API capable model>
OPENAI_TIMEOUT_SECONDS=60
OPENAI_MAX_RETRIES=2
AI_MAX_REQUEST_COST_USD=0.05
# Optional accounting inputs; set to the rate agreed for the selected model.
OPENAI_INPUT_USD_PER_MILLION=0
OPENAI_OUTPUT_USD_PER_MILLION=0
```

Do not expose any of these values through `NEXT_PUBLIC_*`, browser code,
committed files, logs, database records, or report exports.

The implementation uses the OpenAI Python SDK Responses API with strict JSON
Schema structured output and Pydantic validation. Calls are bounded by the
configured timeout and at most three client attempts. Provider errors are
sanitized and recorded as failures; response bodies and resume contents are
not logged.

## Consent, minimization, and injection resistance

`POST /api/v2/candidates/me/resume-intelligence` requires
`consent_to_external_ai: true` for every request. Before a model call, the
backend bounds resume text and redacts direct email/phone patterns. The system
prompt treats resume content as untrusted data and explicitly rejects
instructions embedded in a document.

Model projects and claims must carry an exact excerpt from the original
resume. The backend removes outputs whose excerpts or links cannot be located
in the source. The model does not receive repository files. Claim-to-code
mapping uses only stored, commit-pinned verification evidence. It rejects
unsupported citations and does not infer authorship, functionality, deployment,
or honesty.

## Endpoints

All new application APIs are FastAPI endpoints and use bearer authentication:

- `GET /api/v2/candidates/me/resumes` — scoped resume metadata.
- `POST /api/v2/candidates/me/resume-intelligence` — consented structured
  extraction, project claim decomposition, evidence mapping, usage recording,
  and optional job compatibility analysis.
- `GET /api/v2/candidates/me/resume-intelligence/{run_id}` — scoped saved
  result.

The student verification page invokes these APIs directly; no new Next.js
application API route was added.

## Persistence and migrations

- `015_resume_intelligence.sql`: analysis runs, extracted project claims,
  compatibility runs, usage/cost records, RLS, and restricted grants.
- `016_commit_pinned_source_excerpts.sql`: bounded deterministic snippets
  from inspected GitHub files, retained beside commit-pinned evidence.
- `017_job_requirement_scoped_read.sql` and
  `018_resume_intelligence_scoped_inputs.sql`: minimum RLS-scoped inputs for
  compatibility analysis.

Apply them only to the isolated development database:

```bash
set -a; . ./.env.dev.local; set +a
DATABASE_URL="$DEV_DATABASE_URL" DATABASE_SSL=disable node database/run-migrations.js
```

The compatibility estimate covers explicit job requirements, structured
skills/project relevance, and resume-section completeness. It excludes
protected characteristics and always states that it is not an official or
universal ATS score; it must not automatically accept or reject candidates.

## Live provider test

A real provider test remains intentionally opt-in and should be created only
after the development Supabase/auth boundary is configured. Use a dedicated
synthetic resume with explicit consent. Do not run it against production
candidate documents. Until that test is complete, label all provider behavior
as mocked/fixture-tested rather than live-verified.

```bash
cd python-service
LIVE_OPENAI_TEST=1 AI_ANALYSIS_ENABLED=true OPENAI_API_KEY=<server-side-key> \
.venv/bin/python -m unittest tests/test_live_openai_optional.py -v
```

Before this opt-in paid request, confirm the development project has billing
or credits in the OpenAI dashboard. Keep the synthetic fixture below the
configured `AI_MAX_REQUEST_COST_USD`, run only one test invocation, and check
the resulting `ai_request_usage` row. The database also enforces defaults of
three requests/hour, ten/day, and USD 0.50/day per student; only the migration
administrator can change them.
