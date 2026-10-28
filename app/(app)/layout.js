import { redirect } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { requireUser } from '@/lib/api';

// Server-side auth gate for every page in the app shell. Middleware already
// redirects unauthenticated browsers, but layouts re-validate so a client-side
// navigation that reuses a cached layout can never render without a session.
export default async function DashboardLayout({ children }) {
  let user = null;
  try {
    user = await requireUser();
  } catch {
    user = null;
  }
  if (!user) redirect('/login');
  return <AppShell user={user}>{children}</AppShell>;
}
