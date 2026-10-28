'use client';

// Sign-in page for AUTH_MODE=supabase. Renders outside the app shell (no
// sidebar) and shows honest states: demo mode has no login; an unconfirmed
// email tells the user exactly what to do instead of failing silently.

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient, supabaseBrowserConfigured } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';

function safeNext(raw) {
  // Only allow same-origin relative paths — never an attacker-supplied URL.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const configured = supabaseBrowserConfigured();
  const demoMode = process.env.NEXT_PUBLIC_AUTH_MODE !== 'supabase';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.');
      return;
    }
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) {
      if (/email not confirmed/i.test(signInError.message)) {
        setError('This email has not been confirmed yet. Check your inbox for the confirmation link, then sign in again.');
      } else if (/invalid login credentials/i.test(signInError.message)) {
        setError('Wrong email or password.');
      } else {
        setError(signInError.message);
      }
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (demoMode || !configured) {
    return (
      <div className="mx-auto w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <ShieldCheck size={16} className="text-brand-600" aria-hidden />
          <h1 className="text-base font-semibold">Demo mode</h1>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This build runs with <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">AUTH_MODE=demo</code> —
          a clearly labeled local recruiter session, no sign-in required.
        </p>
        <Button className="mt-5 w-full" onClick={() => router.replace('/')}>Continue to the dashboard</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-brand-600" aria-hidden />
        <h1 className="text-base font-semibold text-slate-900">Sign in to HireProof AI</h1>
      </div>
      <p className="mt-1.5 text-[13px] text-slate-500">Email and password, verified by Supabase Auth.</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-[13px] font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            className="field mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>
        <label className="block text-[13px] font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            className="field mt-1.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-slate-400">
        No account yet?{' '}
        <Link href={next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`} className="text-brand-600 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex h-12 items-center gap-2 px-4">
        <span className="text-sm font-semibold tracking-tight text-navy-900">HireProof AI</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Suspense fallback={<div className="h-64" />}>
          <SignInForm />
        </Suspense>
      </main>
      <footer className="pb-6 text-center text-[12px] text-slate-400">
        Evidence-based hiring · every claim traceable to a source
      </footer>
    </div>
  );
}
