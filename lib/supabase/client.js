// Browser-side Supabase client for the sign-in page. Session tokens are stored
// in httpOnly-adjacent cookies managed by @supabase/ssr, so the server can read
// them; nothing here is secret (publishable key only).

import { createBrowserClient } from '@supabase/ssr';

let client = null;

export function getSupabaseBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client = createBrowserClient(url, key);
  return client;
}

export function supabaseBrowserConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
