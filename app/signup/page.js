'use client';

// Sign-up page for AUTH_MODE=supabase. Creates the account through GoTrue;
// what happens next depends on the project's email-confirmation setting, and
// the page says exactly which path was taken — it never claims success it
// cannot verify.

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient, supabaseBrowserConfigured } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import { ShieldCheck, AlertTriangle, Loader2, MailCheck } from 'lucide-react';

function safeNext(raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const configured = supabaseBrowserConfigured();
  const demoMode = process.env.NEXT_PUBLIC_AUTH_MODE !== 'supabase';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  // null = idle | 'confirming' (email confirmation sent) | 'done' (signed in)
  const [phase, setPhase] = useState('idle');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.');
      return;
    }
    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() || undefined } },
    });
    setBusy(false);
    if (signUpError) {
      if (/already (registered|exists)/i.test(signUpError.message)) {
        setError('An account with this email already exists — sign in instead.');
      } else if (/password.*should be/i.test(signUpError.message)) {
        setError(signUpError.message);
      } else {
        setError(signUpError.message);
      }
      return;
    }
    // GoTrue hides whether the email was taken (no user enumeration), so an
    // empty identities list is the only signal we get for "already registered".
    const alreadyRegistered = data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
    if (alreadyRegistered) {
      setError('If this email isn’t already registered, a confirmation link is on its way. If it is, sign in with it instead.');
      return;
    }
    if (data?.session) {
      // Email confirmation is off — we are signed in right away.
      setPhase('done');
      router.replace(next);
      router.refresh();
      return;
    }
    // Email confirmation on: the account exists but cannot sign in yet.
    setPhase('confirming');
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
          sign-up is disabled and a labeled local session is used instead.
        </p>
        <Button className="mt-5 w-full" onClick={() => router.replace('/')}>Continue to the dashboard</Button>
      </div>
    );
  }

  if (phase === 'confirming') {
    return (
      <div className="mx-auto w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-slate-900">
          <MailCheck size={18} className="text-teal-600" aria-hidden />
          <h1 className="text-base font-semibold">Confirm your email</h1>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          We sent a confirmation link to <span className="font-medium text-slate-800">{email.trim()}</span>.
          Open it to activate the account, then sign in.
        </p>
        <p className="mt-2 text-[13px] leading-5 text-slate-500">
          Nothing is active until the link is opened — signing in now will say the email is unconfirmed.
        </p>
        <Button className="mt-5 w-full" onClick={() => router.replace('/login')}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-brand-600" aria-hidden />
        <h1 className="text-base font-semibold text-slate-900">Create your recruiter account</h1>
      </div>
      <p className="mt-1.5 text-[13px] text-slate-500">Your workspace may require email confirmation before the first sign-in.</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-[13px] font-medium text-slate-700">
          Full name
          <input
            type="text"
            autoComplete="name"
            className="field mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Rivera"
          />
        </label>
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
            autoComplete="new-password"
            className="field mt-1.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label className="block text-[13px] font-medium text-slate-700">
          Confirm password
          <input
            type="password"
            required
            autoComplete="new-password"
            className="field mt-1.5"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat the password"
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
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-4 text-center text-[12px] text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex h-12 items-center gap-2 px-4">
        <span className="text-sm font-semibold tracking-tight text-navy-900">HireProof AI</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Suspense fallback={<div className="h-96" />}>
          <SignUpForm />
        </Suspense>
      </main>
      <footer className="pb-6 text-center text-[12px] text-slate-400">
        Evidence-based hiring · every claim traceable to a source
      </footer>
    </div>
  );
}
