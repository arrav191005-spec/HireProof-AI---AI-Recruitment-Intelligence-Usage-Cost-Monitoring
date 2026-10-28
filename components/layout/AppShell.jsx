'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Briefcase,
  Search,
  Users,
  ClipboardCheck,
  BarChart3,
  Settings,
  ShieldCheck,
  Menu,
  X,
  FlaskConical,
  LogOut,
} from 'lucide-react';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/search', label: 'Candidate Search', icon: Search },
  { href: '/candidates', label: 'Candidates', icon: Users },
  { href: '/assessments', label: 'Skill Assessments', icon: ClipboardCheck },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function NavLinks({ onNavigate }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex-1 space-y-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-navy-700/80 text-white'
                : 'text-navy-100/85 hover:bg-navy-700/45 hover:text-white'
            }`}
          >
            <Icon size={17} strokeWidth={active ? 2.2 : 1.9} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    setBusy(true);
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    // Hard navigation: drops all caches and lands on the login page.
    window.location.assign('/login');
  }

  return (
    <button
      onClick={onSignOut}
      disabled={busy}
      title="Sign out"
      aria-label="Sign out"
      className="flex h-7 w-7 items-center justify-center rounded-md text-navy-100/70 hover:bg-navy-700/60 hover:text-white disabled:opacity-50"
    >
      <LogOut size={14} aria-hidden="true" />
    </button>
  );
}

function SidebarContent({ onNavigate, user }) {
  const supabaseMode = user?.mode === 'supabase';
  const initials = (user?.name ?? 'DR')
    .split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="flex h-full flex-col bg-navy-900">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/20 text-brand-300 ring-1 ring-brand-400/30">
          <ShieldCheck size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[15px] font-semibold leading-tight text-white">HireProof AI</p>
          <p className="text-[11px] leading-tight text-navy-100/60">Evidence-based hiring</p>
        </div>
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="space-y-3 px-5 pb-5 pt-4">
        <div className="rounded-xl bg-navy-800/70 p-3 ring-1 ring-white/5">
          {supabaseMode ? (
            <>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
                <ShieldCheck size={12} aria-hidden="true" /> Signed in
              </p>
              <p className="mt-1 text-[11px] leading-snug text-navy-100/65">
                Session verified by Supabase Auth on every request. Sample data; AI features are labeled.
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">
                <FlaskConical size={12} aria-hidden="true" /> Demo environment
              </p>
              <p className="mt-1 text-[11px] leading-snug text-navy-100/65">
                Synthetic data only. AI providers and auth are in demo mode.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2.5 border-t border-white/10 pt-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials || 'DR'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{user?.name ?? 'Demo Recruiter'}</p>
            <p className="truncate text-[11px] text-navy-100/60">{user?.email ?? 'recruiter@demo.local'}</p>
          </div>
          {supabaseMode && <SignOutButton />}
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children, user }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block" aria-label="Sidebar">
        <SidebarContent user={user} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-navy-950/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-(--shadow-pop)">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute -right-0 -top-11 flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
            >
              <X size={18} />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} user={user} />
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 bg-navy-900 px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-navy-100 hover:bg-navy-700/60"
          >
            <Menu size={19} />
          </button>
          <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <ShieldCheck size={18} className="text-brand-300" aria-hidden="true" />
            HireProof AI
          </span>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
