'use client';

// Student verification workflow. This is the temporary Next.js shell for the
// eventual standalone React client; it talks directly to FastAPI (no Next.js
// API routes) and attaches the Supabase access token as a bearer credential.
// It never receives a server-side GitHub token or database credential.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/NoPrefetchLink';
import Button from '@/components/ui/Button';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import { Field, Input, Textarea } from '@/components/ui/Field';
import Badge from '@/components/ui/Badge';
import { getSupabaseBrowserClient, supabaseBrowserConfigured } from '@/lib/supabase/client';
import {
  ShieldCheck, Github, Play, RefreshCw, FolderPlus, AlertTriangle,
  CheckCircle2, Clock, ExternalLink, Lock,
} from 'lucide-react';

const API_BASE = (process.env.NEXT_PUBLIC_VERIFICATION_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const TECHNOLOGIES = ['JavaScript', 'TypeScript', 'React', 'Python', 'FastAPI', 'PostgreSQL', 'Java', 'Spring Boot'];
const ACTIVE = new Set(['pending', 'running']);

const RUN_STATUS = {
  pending: { label: 'Queued', tone: 'amber' },
  running: { label: 'Inspecting repository', tone: 'blue' },
  completed: { label: 'Completed', tone: 'green' },
  unavailable: { label: 'Unavailable', tone: 'amber' },
  failed: { label: 'Failed', tone: 'gray' },
};

const EVIDENCE_STATUS = {
  supporting: { label: 'Supporting evidence', tone: 'green' },
  partial: { label: 'Partial evidence', tone: 'blue' },
  not_established: { label: 'Not established', tone: 'slate' },
  conflicting: { label: 'Conflicting signals', tone: 'amber' },
  needs_review: { label: 'Needs review', tone: 'amber' },
  unavailable: { label: 'Unavailable', tone: 'gray' },
};

const ERROR_CODES = {
  not_found_or_inaccessible: 'GitHub could not find this public repository, or it is private.',
  inaccessible: 'GitHub denied access to this repository.',
  rate_limited: 'GitHub rate limit reached. The worker will retry within its bounded budget.',
  github_unavailable: 'GitHub was temporarily unavailable.',
  limit_exceeded: 'The collection limit was reached before evidence could be gathered.',
  response_limit: 'The repository response exceeded the safe processing limit.',
  invalid_metadata: 'GitHub returned repository metadata the verifier could not accept.',
  retry_exhausted: 'The retry budget was exhausted without a successful verification.',
  internal_error: 'The worker could not complete this verification.',
};

class ApiError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function friendlyError(error) {
  if (!(error instanceof ApiError)) {
    return `Verification service unavailable at ${API_BASE}. Start the FastAPI service and check NEXT_PUBLIC_VERIFICATION_API_URL.`;
  }
  if (error.status === 401) return 'Your Supabase session is no longer valid. Sign in again.';
  if (error.status === 403) return 'This account is not authorized for student verification.';
  if (error.status === 429) {
    const retry = error.retryAfter ? ` Try again in about ${Math.max(1, Math.ceil(Number(error.retryAfter) / 60))} minute(s).` : ' Try again later.';
    return `A per-student verification limit was reached.${retry}`;
  }
  if (error.status === 404) return 'Project or verification not found.';
  if (error.status === 409) return 'A different verification is already active for this project. Wait for it to finish.';
  if (error.status === 422) return 'Check the GitHub URL and selected technology claims.';
  return error.message;
}

function StatusBadge({ status }) {
  const meta = RUN_STATUS[status] || { label: status || 'Unknown', tone: 'gray' };
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

function EvidenceStatusBadge({ status }) {
  const meta = EVIDENCE_STATUS[status] || { label: status || 'Unknown', tone: 'gray' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function shorten(value, size = 12) {
  return value ? `${value.slice(0, size)}…` : '—';
}

function SetupNotice() {
  return (
    <InlineAlert tone="warning" title="Live Supabase authentication is required">
      <p>
        This page calls FastAPI directly with a real Supabase access token. The current build has no
        live Supabase project configured, so no verification request can be made here. Demo mode is
        not authentication and never fabricates a student identity.
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Create a development Supabase project and enable email/password Auth.</li>
        <li>
          Set <code className="rounded bg-white/70 px-1">NEXT_PUBLIC_SUPABASE_URL</code>,{' '}
          <code className="rounded bg-white/70 px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>,{' '}
          <code className="rounded bg-white/70 px-1">AUTH_MODE=supabase</code> and{' '}
          <code className="rounded bg-white/70 px-1">NEXT_PUBLIC_AUTH_MODE=supabase</code>.
        </li>
        <li>
          Start FastAPI with <code className="rounded bg-white/70 px-1">SUPABASE_AUTH_ISSUER=https://&lt;ref&gt;.supabase.co/auth/v1</code>,{' '}
          <code className="rounded bg-white/70 px-1">SUPABASE_JWT_AUDIENCE=authenticated</code> and the
          browser-safe <code className="rounded bg-white/70 px-1">SUPABASE_PUBLISHABLE_KEY</code>.
        </li>
        <li>
          Use the isolated development database credentials from <code className="rounded bg-white/70 px-1">.env.dev.local</code> and set{' '}
          <code className="rounded bg-white/70 px-1">VERIFICATION_ENABLED=true</code> only there.
        </li>
      </ol>
      <p className="mt-2">Never put a Supabase service-role key or a GitHub token in a NEXT_PUBLIC_* variable.</p>
    </InlineAlert>
  );
}

export default function StudentVerification() {
  const configured = supabaseBrowserConfigured() && process.env.NEXT_PUBLIC_AUTH_MODE === 'supabase';
  const [auth, setAuth] = useState({ state: configured ? 'loading' : 'unconfigured', session: null });
  const [identityHint, setIdentityHint] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectForm, setProjectForm] = useState({ name: '', summary: '' });
  const [repoUrl, setRepoUrl] = useState('');
  const [claims, setClaims] = useState(['React', 'FastAPI']);
  const [report, setReport] = useState(null);
  const [reportVersion, setReportVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) throw new ApiError(503, 'Live Supabase authentication is not configured.');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new ApiError(401, 'Sign in required.');
    const send = async (token) => {
      try {
        return await fetch(API_BASE + path, {
          ...options,
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
          },
        });
      } catch {
        throw new ApiError(0, 'Verification service unavailable.');
      }
    };
    let response = await send(session.access_token);
    if (response.status === 401) {
      const { data } = await supabase.auth.refreshSession();
      if (data?.session?.access_token) response = await send(data.session.access_token);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(response.status, payload?.detail || 'Request failed.', response.headers.get('retry-after'));
    }
    return payload;
  }, []);

  useEffect(() => {
    if (!configured) return undefined;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAuth({ state: data.session ? 'ready' : 'signed-out', session: data.session });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAuth({ state: session ? 'ready' : 'signed-out', session });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured]);

  const loadProjects = useCallback(async (selectId = null) => {
    const rows = await request('/api/v2/candidates/me/projects');
    setProjects(rows);
    setSelectedProjectId((current) => {
      if (selectId && rows.some((project) => project.id === selectId)) return selectId;
      if (current && rows.some((project) => project.id === current)) return current;
      return rows[0]?.id ?? null;
    });
    return rows;
  }, [request]);

  useEffect(() => {
    if (auth.state !== 'ready') return undefined;
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        try {
          await request('/api/v2/accounts/student', { method: 'POST' });
        } catch (identityError) {
          if (identityError instanceof ApiError && identityError.status === 503) {
            if (active) setIdentityHint('FastAPI cannot confirm the Supabase email yet. Set SUPABASE_PUBLISHABLE_KEY (browser-safe) in the FastAPI environment.');
          } else if (!(identityError instanceof ApiError) || identityError.status !== 409) {
            throw identityError;
          }
        }
        try {
          const me = await request('/api/v2/candidates/me');
          if (!active) return;
          setCandidate(me);
          setNeedsProfile(false);
          setIdentityHint(null);
          await loadProjects();
        } catch (candidateError) {
          if (candidateError instanceof ApiError && candidateError.status === 404) {
            if (active) setNeedsProfile(true);
          } else {
            throw candidateError;
          }
        }
      } catch (loadError) {
        if (active) setError(friendlyError(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [auth.state, request, loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setReport(null);
      return undefined;
    }
    let active = true;
    setReport(null);
    request(`/api/v2/candidates/me/projects/${selectedProjectId}/verification`)
      .then((value) => { if (active) setReport(value); })
      .catch((loadError) => {
        if (!active) return;
        if (loadError instanceof ApiError && loadError.status === 404) setReport(null);
        else setError(friendlyError(loadError));
      });
    return () => { active = false; };
  }, [selectedProjectId, reportVersion, request]);

  useEffect(() => {
    if (!selectedProjectId || !report || !ACTIVE.has(report.status)) return undefined;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const latest = await request(`/api/v2/candidates/me/projects/${selectedProjectId}/verification`);
        if (!active) return;
        setReport(latest);
        if (latest.status === 'completed') setNotice('Verification completed.');
      } catch (pollError) {
        if (!active) return;
        if (!(pollError instanceof ApiError) || pollError.status !== 404) {
          setError(friendlyError(pollError));
        }
      }
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [selectedProjectId, report, request]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  async function onCreateProfile(event) {
    event.preventDefault();
    setBusy('profile');
    setError(null);
    try {
      const me = await request('/api/v2/candidates/me', {
        method: 'POST',
        body: JSON.stringify({ full_name: profileName.trim() }),
      });
      setCandidate(me);
      setNeedsProfile(false);
      setProfileName('');
      await loadProjects();
    } catch (createError) {
      setError(friendlyError(createError));
    } finally {
      setBusy('');
    }
  }

  async function onCreateProject(event) {
    event.preventDefault();
    setBusy('project');
    setError(null);
    setNotice(null);
    try {
      const created = await request('/api/v2/candidates/me/projects', {
        method: 'POST',
        body: JSON.stringify({ name: projectForm.name.trim(), summary: projectForm.summary.trim() }),
      });
      setProjectForm({ name: '', summary: '' });
      await loadProjects(created.id);
      setNotice('Project registered.');
    } catch (createError) {
      setError(friendlyError(createError));
    } finally {
      setBusy('');
    }
  }

  async function onStartVerification(event) {
    event.preventDefault();
    if (!selectedProjectId) return;
    setBusy('verify');
    setError(null);
    setNotice(null);
    try {
      await request(`/api/v2/candidates/me/projects/${selectedProjectId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ repository_url: repoUrl.trim(), claims }),
      });
      setNotice('Verification queued. The worker will collect bounded, commit-pinned evidence.');
      setReportVersion((value) => value + 1);
    } catch (startError) {
      setError(friendlyError(startError));
      if (startError instanceof ApiError && startError.status === 409) {
        setReportVersion((value) => value + 1);
      }
    } finally {
      setBusy('');
    }
  }

  function toggleClaim(claim) {
    setClaims((current) => (
      current.includes(claim) ? current.filter((item) => item !== claim) : [...current, claim]
    ));
  }

  if (!configured) {
    return (
      <div className="space-y-4">
        <SetupNotice />
        <Card>
          <CardBody>
            <p className="text-[13px] text-slate-600">
              Demo mode remains synthetic-only. Run <code className="rounded bg-slate-100 px-1">node database/dev/provision-dev-database.js</code>{' '}
              for the isolated database, then configure a development Supabase project as described above.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (auth.state === 'loading') {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Checking your Supabase session…</div>;
  }

  if (auth.state === 'signed-out') {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={Lock}
            title="Sign in with Supabase"
            description="Student verification uses your verified Supabase identity. No demo identity is substituted."
            action={<Button as={Link} href="/login?next=/verification">Sign in</Button>}
          />
        </CardBody>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Resolving your student identity…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
        <ShieldCheck size={15} className="text-brand-600" aria-hidden />
        <span>Identity verified by Supabase Auth, then resolved by FastAPI.</span>
        {candidate && <Badge tone="navy">{candidate.full_name}</Badge>}
      </div>

      {error && (
        <InlineAlert tone="error" title="Verification action failed">
          <p>{error}</p>
          <button type="button" onClick={() => setError(null)} className="mt-2 font-medium underline underline-offset-2">
            Dismiss
          </button>
        </InlineAlert>
      )}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {identityHint && needsProfile && (
        <InlineAlert tone="warning" title="Identity mapping needs provider configuration">
          <p>{identityHint}</p>
        </InlineAlert>
      )}

      {needsProfile ? (
        <Card className="max-w-xl">
          <CardHeader title="Create your student profile" subtitle="This creates a candidate record owned by your verified Supabase subject." />
          <CardBody>
            <form onSubmit={onCreateProfile} className="space-y-4">
              <Field label="Full name" htmlFor="student-name">
                <Input
                  id="student-name"
                  required
                  maxLength={120}
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder="Your name"
                />
              </Field>
              <Button type="submit" disabled={busy === 'profile' || !profileName.trim()}>
                {busy === 'profile' ? <Spinner size={14} /> : null}
                {busy === 'profile' ? 'Creating…' : 'Create student profile'}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-5">
            <Card>
              <CardHeader
                title="Projects"
                subtitle="Register a project you own, then attach a public GitHub repository."
                actions={<Badge tone="gray">{projects.length}</Badge>}
              />
              <CardBody className="space-y-4">
                {projects.length === 0 ? (
                  <EmptyState icon={FolderPlus} title="No projects yet" description="Create your first project below." className="py-6" />
                ) : (
                  <div className="space-y-2">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => setSelectedProjectId(project.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                          project.id === selectedProjectId
                            ? 'border-brand-300 bg-brand-50 text-brand-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span className="truncate font-medium">{project.name || `Project ${project.id}`}</span>
                        <span className="ml-3 shrink-0 text-[11px] text-slate-400">#{project.id}</span>
                      </button>
                    ))}
                  </div>
                )}

                <form onSubmit={onCreateProject} className="space-y-3 border-t border-slate-100 pt-4">
                  <Field label="New project name" htmlFor="project-name">
                    <Input
                      id="project-name"
                      required
                      maxLength={120}
                      value={projectForm.name}
                      onChange={(event) => setProjectForm((form) => ({ ...form, name: event.target.value }))}
                      placeholder="Capstone API"
                    />
                  </Field>
                  <Field label="Summary" htmlFor="project-summary" hint="optional">
                    <Textarea
                      id="project-summary"
                      rows={2}
                      maxLength={2000}
                      value={projectForm.summary}
                      onChange={(event) => setProjectForm((form) => ({ ...form, summary: event.target.value }))}
                      placeholder="What the project does"
                    />
                  </Field>
                  <Button type="submit" variant="secondary" size="sm" disabled={busy === 'project' || !projectForm.name.trim()}>
                    {busy === 'project' ? <Spinner size={14} /> : <FolderPlus size={14} aria-hidden />}
                    {busy === 'project' ? 'Registering…' : 'Register project'}
                  </Button>
                </form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Request verification"
                subtitle={selectedProject ? `For ${selectedProject.name || `project #${selectedProject.id}`}` : 'Select a project first.'}
              />
              <CardBody>
                <form onSubmit={onStartVerification} className="space-y-4">
                  <Field label="Public GitHub repository" htmlFor="repository-url" hint="https://github.com/owner/repository">
                    <Input
                      id="repository-url"
                      required
                      maxLength={230}
                      value={repoUrl}
                      onChange={(event) => setRepoUrl(event.target.value)}
                      placeholder="https://github.com/psf/requests"
                      autoComplete="off"
                    />
                  </Field>
                  <fieldset>
                    <legend className="text-[13px] font-medium text-slate-700">Technology claims</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TECHNOLOGIES.map((technology) => {
                        const checked = claims.includes(technology);
                        return (
                          <label
                            key={technology}
                            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              checked
                                ? 'border-brand-300 bg-brand-50 text-brand-800'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleClaim(technology)}
                            />
                            {technology}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="submit"
                      disabled={!selectedProjectId || busy === 'verify' || claims.length === 0 || (report && ACTIVE.has(report.status))}
                    >
                      {busy === 'verify' ? <Spinner size={14} /> : <Play size={14} aria-hidden />}
                      {busy === 'verify' ? 'Submitting…' : 'Start verification'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setReportVersion((value) => value + 1)}
                    >
                      <RefreshCw size={13} aria-hidden /> Refresh report
                    </Button>
                  </div>
                  {report && ACTIVE.has(report.status) && (
                    <p className="text-[12px] text-slate-500">A verification is already active; status refreshes automatically every 5 seconds.</p>
                  )}
                </form>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Verification report"
              subtitle="Commit-pinned observations from a bounded, non-executing GitHub inspection."
              actions={report ? <StatusBadge status={report.status} /> : null}
            />
            <CardBody>
              {!selectedProject ? (
                <EmptyState icon={Github} title="No project selected" description="Register or select a project to see its verification report." />
              ) : !report ? (
                <EmptyState
                  icon={Clock}
                  title="No verification yet"
                  description="Submit a public GitHub repository and at least one technology claim to queue a run."
                />
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-[12px] text-slate-600 sm:grid-cols-2">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Repository</p>
                      <a
                        href={report.repository_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 break-all text-brand-700 hover:underline"
                      >
                        {report.repository_url} <ExternalLink size={11} aria-hidden />
                      </a>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Commit</p>
                      <p className="mt-1 font-mono text-[12px] text-slate-700">{report.commit_sha || 'not pinned yet'}</p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Requested</p>
                      <p className="mt-1">{new Date(report.requested_at).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Finished</p>
                      <p className="mt-1">{report.finished_at ? new Date(report.finished_at).toLocaleString() : '—'}</p>
                    </div>
                  </div>

                  {ACTIVE.has(report.status) && (
                    <InlineAlert tone="info">
                      {report.status === 'pending'
                        ? 'Queued in PostgreSQL. The verification worker has not leased this job yet.'
                        : 'The worker is inspecting a bounded set of public repository files. No repository code is executed.'}
                    </InlineAlert>
                  )}

                  {report.error_code && (
                    <InlineAlert tone="warning" title="Verification unavailable">
                      <p>{ERROR_CODES[report.error_code] || 'The verification could not be completed.'}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">sanitized code: {report.error_code}</p>
                    </InlineAlert>
                  )}

                  {report.evidence.length === 0 ? (
                    <EmptyState
                      icon={ShieldCheck}
                      title={report.status === 'completed' ? 'No evidence rows' : 'Evidence pending'}
                      description={report.status === 'completed' ? 'The run completed without stored findings.' : 'Findings appear after the worker completes.'}
                    />
                  ) : (
                    <ul className="space-y-3">
                      {report.evidence.map((item) => (
                        <li key={item.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[14px] font-semibold text-slate-900">{item.claim}</p>
                            <EvidenceStatusBadge status={item.status} />
                          </div>
                          <p className="mt-2 text-[13px] leading-5 text-slate-600">{item.explanation}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            {item.file_path && <span className="font-mono">{item.file_path}</span>}
                            {item.commit_sha && <span className="font-mono">{shorten(item.commit_sha)}</span>}
                            {item.source_url && /^https:\/\/github\.com\//.test(item.source_url) && (
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                              >
                                View commit-pinned source <ExternalLink size={10} aria-hidden />
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="border-t border-slate-100 pt-3 text-[11px] leading-5 text-slate-400">
                    A finding is a deterministic observation about repository content, not proof of authorship or
                    functionality. The verifier never clones or executes candidate code.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
