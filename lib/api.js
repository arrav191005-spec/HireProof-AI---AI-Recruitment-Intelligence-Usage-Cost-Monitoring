// Shared helpers for Route Handlers: JSON responses, error envelopes, auth
// context and zod validation.

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function json(data, init = {}) {
  return NextResponse.json(data, init);
}

export function ok(data, meta) {
  return NextResponse.json(meta ? { data, meta } : data);
}

export function fail(status, message, details) {
  return NextResponse.json(
    { error: { status, message, ...(details ? { details } : {}) } },
    { status }
  );
}

export function validationError(zodError) {
  const details = zodError.issues?.map((i) => ({ path: i.path.join('.'), message: i.message })) ?? [];
  return fail(422, 'Validation failed', details);
}

export async function validate(schema, payload) {
  try {
    return { ok: true, data: await schema.parseAsync(payload) };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, error: validationError(err) };
    throw err;
  }
}

// --- Authorization -------------------------------------------------------------
// Demo mode (AUTH_MODE=demo): a single synthetic recruiter session — no real
// credentials are involved. Supabase mode (AUTH_MODE=supabase): the server
// verifies the GoTrue session cookie on every request; unauthenticated calls
// get a 401 and the browser is sent to /login by the (app) layout + middleware.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function requireUser() {
  const { supabaseAuthConfigured, createSupabaseServerClient } = await import('@/lib/supabase/server');
  if (!supabaseAuthConfigured()) {
    // Demo mode: clearly-labeled local session, never presented as a real login.
    return { id: 'user-demo', name: 'Demo Recruiter', email: 'recruiter@demo.local', role: 'recruiter', mode: 'demo' };
  }
  const supabase = await createSupabaseServerClient();
  // getUser() validates the JWT with GoTrue — it is not a cookie-presence check.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, 'Sign in required');
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? 'Recruiter',
    role: 'recruiter',
    mode: 'supabase',
  };
}

export function handleRouteError(err, route) {
  if (err instanceof HttpError) {
    return fail(err.status, err.message);
  }
  // Never leak stack traces or internals to the client.
  console.error(`[hireproof] ${route}:`, err?.message ?? err);
  return fail(500, 'Internal server error');
}
