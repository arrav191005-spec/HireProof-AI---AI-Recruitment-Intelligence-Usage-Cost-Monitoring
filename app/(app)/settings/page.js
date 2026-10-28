import PageHeader from '@/components/layout/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { InlineAlert, Breadcrumbs } from '@/components/ui/Feedback';
import Badge from '@/components/ui/Badge';
import {
  Database, KeyRound, Brain, FileText, Terminal, ShieldCheck, CheckCircle2, XCircle, HardDrive,
} from 'lucide-react';
import { getBackendInfo } from '@/lib/repo';
import { aiMode } from '@/lib/config';
import { requireUser } from '@/lib/api';
import {
  DATABASE_URL, AI_SERVICE_URL, OPENAI_API_KEY, OPENAI_CHAT_MODEL, OPENAI_EMBEDDING_MODEL,
  MAX_RESUME_SIZE_MB, AUTH_MODE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
} from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings' };

function maskDatabase(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//•••@${u.hostname}:${u.port ?? '5432'}${u.pathname}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}

async function probeDocumentService() {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, detail: err?.name === 'TimeoutError' ? 'timed out' : 'not running' };
  }
}

function StatusRow({ icon: Icon, label, value, detail, ok }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          ok ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? 'text-teal-700' : 'text-slate-500'}`}>
            {ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <XCircle size={13} aria-hidden="true" />}
            {value}
          </span>
        </div>
        {detail && <p className="mt-0.5 break-words text-xs text-slate-500">{detail}</p>}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const backend = await getBackendInfo();
  const service = await probeDocumentService();
  const dbOk = backend?.backend === 'postgres';
  const authEnforced = AUTH_MODE === 'supabase' && Boolean(SUPABASE_URL);
  // Actually resolve the current session — this row reports a verified state,
  // not just "env vars are present".
  let sessionUser = null;
  if (authEnforced) {
    try {
      sessionUser = await requireUser();
    } catch {
      sessionUser = null;
    }
  }
  const authOk = authEnforced && Boolean(sessionUser);
  const llmOk = aiMode() === 'configured';
  const serviceOk = Boolean(service.ok && service.data?.status === 'ok');

  const envRows = [
    ['DATABASE_URL', maskDatabase(DATABASE_URL) ?? 'not set', 'PostgreSQL connection (server only)', Boolean(DATABASE_URL)],
    ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL || 'not set', 'Supabase project URL (public by design)', Boolean(SUPABASE_URL)],
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', SUPABASE_PUBLISHABLE_KEY ? `${SUPABASE_PUBLISHABLE_KEY.slice(0, 18)}…` : 'not set', 'Browser-safe key — not a secret', Boolean(SUPABASE_PUBLISHABLE_KEY)],
    ['AUTH_MODE', AUTH_MODE, 'supabase = real sign-in · demo = labeled local session', true],
    ['AI_SERVICE_URL', AI_SERVICE_URL, 'Python document service (server only)', serviceOk],
    ['OPENAI_API_KEY', llmOk ? 'configured (hidden)' : 'not set', 'Without a key the app runs in demo AI mode — never faked', llmOk],
    ['OPENAI_CHAT_MODEL', OPENAI_CHAT_MODEL, 'Used when a key is configured', true],
    ['OPENAI_EMBEDDING_MODEL', OPENAI_EMBEDDING_MODEL, 'Used for semantic search when configured', true],
    ['MAX_RESUME_SIZE_MB', String(MAX_RESUME_SIZE_MB), 'Upload size limit', true],
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Live configuration and connection status — every value below is read from the running server, not typed in by hand."
        actions={
          <Badge tone={dbOk ? 'green' : 'amber'} dot>
            {dbOk ? 'PostgreSQL connected' : 'Demo store active'}
          </Badge>
        }
      />

      {!dbOk && (
        <div className="mb-4">
          <InlineAlert tone="warning" title="Using the in-memory demo store">
            PostgreSQL did not answer, so records live in memory (persisted to{' '}
            <code className="rounded bg-white/70 px-1 font-mono text-[11px]">.data/demo-store.json</code>). Run{' '}
            <code className="rounded bg-white/70 px-1 font-mono text-[11px]">npm run db:migrate &amp;&amp; npm run db:seed</code>{' '}
            and restart to switch to the database.
          </InlineAlert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Connections" subtitle="Probed at page load" />
          <CardBody className="divide-y divide-slate-100">
            <StatusRow
              icon={Database}
              label="Data backend"
              ok={dbOk}
              value={backend?.label ?? backend?.backend ?? 'unknown'}
              detail={
                dbOk
                  ? `${maskDatabase(DATABASE_URL)} · persistent`
                  : 'Seeded synthetic records — not the database'
              }
            />
            <StatusRow
              icon={KeyRound}
              label="Authentication"
              ok={authOk}
              value={
                authOk
                  ? `Supabase Auth enforced — signed in as ${sessionUser.email}`
                  : authEnforced
                    ? 'Supabase Auth enforced — no active session'
                    : 'Demo session'
              }
              detail={
                authEnforced
                  ? `${SUPABASE_URL} · GoTrue (email + password) · every request re-verifies the session`
                  : 'AUTH_MODE=demo — a clearly labeled local recruiter session; no real credentials involved.'
              }
            />
            <StatusRow
              icon={Brain}
              label="AI / LLM"
              ok={llmOk}
              value={llmOk ? `configured (${OPENAI_CHAT_MODEL})` : 'demo mode'}
              detail={
                llmOk
                  ? `Embeddings: ${OPENAI_EMBEDDING_MODEL}`
                  : 'Extraction, analysis and questions use deterministic demo adapters, labeled as such in every response.'
              }
            />
            <StatusRow
              icon={FileText}
              label="Document service"
              ok={serviceOk}
              value={serviceOk ? `running (v${service.data?.version})` : 'not running'}
              detail={
                serviceOk
                  ? `${service.data?.pdf_library} · ai_mode=${service.data?.ai_mode} — uploads fall back to the Node parser (unpdf) when this is down`
                  : `Could not reach ${AI_SERVICE_URL}/health (${service.detail}). Start it with npm run service.`
              }
            />
            <StatusRow
              icon={HardDrive}
              label="Resume storage"
              ok
              value="server filesystem"
              detail={`storage/resumes/ (gitignored, never served publicly) · limit ${MAX_RESUME_SIZE_MB} MB · PDF magic-byte + content validation`}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Environment variables" subtitle="From .env.local (gitignored) — secrets are never exposed to the client" />
          <CardBody>
            <div className="table-scroll rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="px-4 py-2.5 font-medium">Variable</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Value</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {envRows.map(([name, value, note, set]) => (
                    <tr key={name}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-700">{name}</td>
                      <td className={`px-4 py-2.5 text-[13px] ${set ? 'text-slate-700' : 'text-slate-400'}`}>{value}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Copy <code className="rounded bg-slate-100 px-1 font-mono">.env.example</code> to{' '}
              <code className="rounded bg-slate-100 px-1 font-mono">.env.local</code> to configure your own
              environment. <code className="rounded bg-slate-100 px-1 font-mono">.env.local</code> is gitignored.
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Commands" subtitle="Everything can be run locally" />
          <CardBody>
            <div className="rounded-xl bg-slate-950 px-4 py-3.5 font-mono text-[12px] leading-relaxed text-slate-100">
              <p className="text-slate-500"># data layer</p>
              <p>npm run db:migrate <span className="text-slate-500">// create schema (idempotent)</span></p>
              <p>npm run db:seed <span className="text-slate-500">// load synthetic demo data</span></p>
              <p className="mt-2 text-slate-500"># services</p>
              <p>npm run dev <span className="text-slate-500">// Next.js on :3000</span></p>
              <p>npm run service <span className="text-slate-500">// Python document service on :8000</span></p>
              <p className="mt-2 text-slate-500"># verification</p>
              <p>npm test <span className="text-slate-500">// unit + integration tests</span></p>
              <p>npm run eval:search <span className="text-slate-500">// P@5 / R@5 / MRR over judged queries</span></p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security posture" subtitle="How this build handles untrusted input and secrets" />
          <CardBody className="space-y-2.5 text-[13px] leading-relaxed text-slate-600">
            <p className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
              Secrets live only in <code className="rounded bg-slate-100 px-1 font-mono text-xs">.env.local</code> on
              the server. The client receives no database URL, API key or service token.
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
              Uploaded PDFs are untrusted: validated by size + magic bytes, parsed without executing anything, and
              never served back to the browser.
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
              Database access uses parameterized queries only; errors returned to clients are generic and logged
              server-side.
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
              Candidate code is never executed — assessments use static checks plus human review.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
