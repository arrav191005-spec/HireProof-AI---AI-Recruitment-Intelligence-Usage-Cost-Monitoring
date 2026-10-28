# Authentication

HireProof AI supports two authentication modes. The mode is chosen by the
`AUTH_MODE` environment variable (with a public mirror, `NEXT_PUBLIC_AUTH_MODE`,
so the client-side login page can see it — keep the two identical).

## Demo mode (`AUTH_MODE=demo`, the default)

- No sign-in page. `/login` immediately redirects to the dashboard.
- Every request resolves to a clearly-labeled synthetic session:
  `{ id: 'user-demo', name: 'Demo Recruiter', email: 'recruiter@demo.local' }`.
- Reviews are attributed to "Demo Recruiter" so nothing looks like a real person
  acted. Used for offline development and the automated test suite.

## Supabase mode (`AUTH_MODE=supabase`)

Real email+password sign-in backed by your Supabase project's GoTrue service.
Only the browser-safe **publishable key** is used — never a service-role or
secret key.

### Sign-up (`/signup`)

`app/signup/page.js` is an open registration form wired to `supabase.auth.signUp()`:

- Client-side validation before any network call: password ≥ 8 characters and
  the two password fields must match.
- What happens next depends on the project's email-confirmation setting, and
  the page says exactly which path was taken:
  - **Confirmation on** → "Confirm your email" screen naming the address, with
    an explicit note that signing in before opening the link will be refused.
  - **Confirmation off** (GoTrue returns a session) → straight into the app.
- No user enumeration: an already-registered email gets the same
  "If this email isn't already registered, a confirmation link is on its way…"
  message GoTrue's own obfuscation implies.
- Admins can still provision users in the dashboard (Authentication → Users →
  Add user; tick "Auto confirm user" for immediate sign-in). Both routes create
  the same GoTrue user.
- `/signup` redirects signed-in users to `/` (same middleware rule as
  `/login`), and in demo mode it shows a labeled "Demo mode" notice instead of
  a form.

### How a request is authenticated (three layers)

1. **`middleware.js`** — on every page navigation it refreshes the session
   cookie via `@supabase/ssr` and calls `getUser()`, which validates the JWT
   with GoTrue (a forged cookie does not pass). No user → redirect to
   `/login?next=<path>`. API routes are excluded from the matcher; they
   authenticate themselves so API clients get a machine-readable 401 instead of
   an HTML redirect.
2. **`app/(app)/layout.js`** — the server layout re-validates the session before
   rendering any page, so a client-side navigation that reuses a cached layout
   can never render without a session. Unauthenticated → `redirect('/login')`.
3. **`lib/api.js` `requireUser()`** — every API route handler calls this. It
   validates the session cookie with GoTrue on each request and throws
   `HttpError(401)` when there is no valid session; `handleRouteError` maps that
   to a `{"error":{"status":401,"message":"Sign in required"}}` envelope.

The signed-in user's identity flows into the data layer: reviews record the real
user (`reviewedBy`), and audit log entries store their name.

### Files

| File | Role |
|---|---|
| `middleware.js` | Session refresh + page-level redirect (no-op in demo mode) |
| `app/login/page.js` | Sign-in page (email + password); honest error states |
| `app/signup/page.js` | Sign-up page (name/email/password); confirmation-aware states |
| `lib/supabase/server.js` | `createServerClient` bound to request/response cookies |
| `lib/supabase/client.js` | `createBrowserClient` for the login page |
| `lib/api.js` | `requireUser()` / `HttpError` / `handleRouteError` |

### Sign-out

The sidebar sign-out button calls `supabase.auth.signOut()` (which revokes the
session server-side) and then hard-navigates to `/login`, clearing all state.

### Session storage

`@supabase/ssr` stores the session in cookies readable by both the browser and
the server (chunked when large). The middleware rewrites them on refresh, so
access-token expiry is transparent to the user.

### Verifying it works

1. Set `AUTH_MODE=supabase` and `NEXT_PUBLIC_AUTH_MODE=supabase` in `.env.local`
   along with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Create a confirmed user in the Supabase dashboard (Users → Add user →
   "Auto confirm user").
3. Visit `/` — you should be redirected to `/login`. Sign in; you land back on
   the page you requested. The Settings page shows
   "Supabase Auth enforced — signed in as <email>".
4. `curl -i localhost:3000/api/candidates` without cookies → HTTP 401.

### In production (Cloudflare Workers)

The deployed Worker sets `AUTH_MODE=supabase` as a plain var in
`wrangler.jsonc` (kept identical to the `NEXT_PUBLIC_AUTH_MODE` baked into the
build — see `.env.local` at build time), and GoTrue sign-in runs server-side
from the Worker, so no auth secret is ever exposed to the client. Verified on
the live URL: sign-in → Overview, session enforced across pages, sign-out →
`/login`, and `/api/candidates` without cookies → `401 {"message":"Sign in
required"}`. Cookie names and chunking are unchanged from the local setup
(`@supabase/ssr`); the middleware refreshes expiring tokens the same way.

### Known limitations

- **No password reset UI.** `/signup` exists, but password recovery is not
  wired up; accounts are reset via the Supabase dashboard or GoTrue's email
  templates (customizable there).
- **Confirm users through GoTrue, not raw SQL.** Manually setting
  `auth.users.email_confirmed_at` (or nulling `confirmation_token`) behind
  GoTrue's back corrupts its token bookkeeping — sign-in then returns GoTrue's
  opaque `500 "Database error querying schema"`. Confirmed by experiment: the
  dashboard's **Confirm email** action (or the emailed link) is the supported
  path, because it clears `confirmation_token`/`confirmation_sent_at` and the
  `one_time_tokens` row together.
- **Single organization.** All authenticated recruiters share one workspace;
  there is no per-user data isolation beyond the app-level session.
- **Email confirmation.** If a user is created without auto-confirm, GoTrue
  requires the confirmation link before sign-in; the login page surfaces this
  explicitly ("This email has not been confirmed yet…").
- **The `users` table is not synced.** Application rows reference
  `user-demo` in demo mode; Supabase mode stores the GoTrue user id in
  audit/review fields without a foreign key to `auth.users`.
