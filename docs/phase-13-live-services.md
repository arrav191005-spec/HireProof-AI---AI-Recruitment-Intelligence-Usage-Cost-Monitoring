# Phase 13 live-services activation checklist

The checked-out environment is intentionally not activated: Supabase is in
demo mode and no OpenAI or GitHub server token is configured. Do not claim a
live student journey until every applicable step below has passed.

## Supabase

Follow the complete dashboard setup in
[`phase-11-development.md`](phase-11-development.md), then use a distinct,
confirmed synthetic student. Configure only local ignored files/secret
managers:

```dotenv
# Next.js
AUTH_MODE=supabase
NEXT_PUBLIC_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>

# FastAPI
SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Supabase must issue asymmetric RS256 or ES256 JWTs and expose the Auth JWKS
endpoint. HireProof rejects legacy HS256 bearer tokens. The FastAPI service
validates signature, issuer, audience, expiry and non-empty subject; candidate
provisioning additionally checks `/user` for matching subject and confirmed
email.

Run the opt-in test using shell/secret-manager values only:

```bash
cd python-service
LIVE_SUPABASE_TEST=1 LIVE_SUPABASE_URL=https://<project-ref>.supabase.co \
LIVE_SUPABASE_PUBLISHABLE_KEY=<publishable-key> \
LIVE_SUPABASE_TEST_EMAIL=<confirmed-synthetic-email> \
LIVE_SUPABASE_TEST_PASSWORD=<synthetic-password> \
.venv/bin/python -m unittest tests.test_live_supabase_optional -v
```

Then browser-test registration, login, profile provisioning, resume selection,
analysis consent, logout, and cross-student denial. Session refresh is handled
by Supabase SSR and one browser-token refresh retry. Server-side revocation
cannot be detected until a short-lived access token expires; this remains a
known limitation.

## OpenAI

Confirm billing/credits in the OpenAI dashboard before setting a backend-only
key. Use one synthetic, non-PII resume and a low per-request reservation:

```dotenv
AI_ANALYSIS_ENABLED=true
OPENAI_API_KEY=<server-side key>
OPENAI_MODEL=<Responses-capable-model>
AI_MAX_REQUEST_COST_USD=0.05
OPENAI_TIMEOUT_SECONDS=60
OPENAI_MAX_RETRIES=2
```

The database enforces a student-level reservation before external egress:
three requests/hour, ten/day and USD 0.50/day by default. It records actual
reported token usage/cost in `ai_request_usage`. Do not set a zero reservation
for live testing.

Run only the opt-in synthetic smoke test:

```bash
cd python-service
LIVE_OPENAI_TEST=1 AI_ANALYSIS_ENABLED=true OPENAI_API_KEY=<server-side-key> \
.venv/bin/python -m unittest tests.test_live_openai_optional -v
```

## Full journey

With the isolated `hireproof_dev` database and three separate processes:

1. Start Next.js, FastAPI, and the verification worker.
2. Log in as the confirmed synthetic student.
3. Provision the candidate profile and select an authorized synthetic resume.
4. Consent explicitly, run one AI analysis, and verify its persisted usage row.
5. Submit a public repository and run the worker.
6. Confirm report evidence is commit-pinned, excerpt-bounded and scoped to the
   student.
7. Attempt the report as a different student and an unrelated recruiter;
   both must receive no private report.

Never send a real student resume during this development validation. Keep
production AI analysis and verification disabled until this checklist and a
security review pass.
