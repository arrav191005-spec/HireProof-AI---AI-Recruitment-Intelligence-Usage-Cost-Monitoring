// Server-side Supabase client for Route Handlers and Server Components.
// Uses the cookie session created by the login page / middleware (@supabase/ssr).
// Only server modules import this — the publishable key is browser-safe, but
// the session cookies must never leave the server.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { AUTH_MODE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/config';

export function supabaseAuthConfigured() {
  return AUTH_MODE === 'supabase' && Boolean(SUPABASE_URL) && Boolean(SUPABASE_PUBLISHABLE_KEY);
}

// `cookieStore` may be a promise (Next 15) or a plain store; @supabase/ssr
// accepts both via getAll/setAll.
export async function createSupabaseServerClient() {
  if (!supabaseAuthConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — middleware refreshes instead.
        }
      },
    },
  });
}
