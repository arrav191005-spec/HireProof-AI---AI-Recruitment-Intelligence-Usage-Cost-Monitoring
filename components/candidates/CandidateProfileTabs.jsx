'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Tabs from '@/components/ui/Tabs';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Badge, { StageBadge } from '@/components/ui/Badge';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import {
  Mail, MapPin, Building2, Calendar, Github, Link2, Briefcase,
  GraduationCap, FolderGit2, FileText, ClipboardCheck, Pencil, CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import EvidenceTab from './EvidenceTab';
import RequirementEvidenceTab from './RequirementEvidenceTab';

const fmtBytes = (n) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function OverviewTab({ candidate, applications, onEdit }) {
  const hasResume = Boolean(candidate.resume);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader
            title="Summary"
            actions={
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <Pencil size={13} /> Edit profile
              </Button>
            }
          />
          <CardBody>
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">
              {candidate.summary || 'No summary yet.'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Work experience" subtitle={candidate.experience.length ? undefined : undefined} />
          {candidate.experience.length === 0 ? (
            <EmptyState icon={Briefcase} title="No experience entries extracted" description="Review the resume extraction to add roles." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {candidate.experience.map((e, i) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{e.title}</p>
                    <p className="text-xs text-slate-400">
                      {e.start ?? ''}{e.end ? ` – ${e.end}` : e.start ? ' – present' : ''}
                    </p>
                  </div>
                  <p className="text-[13px] text-slate-600">{e.company}</p>
                  {e.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{e.summary}</p>}
                  {Array.isArray(e.highlights) && e.highlights.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {e.highlights.map((h, hi) => (
                        <li key={hi} className="flex items-start gap-1.5 text-xs text-slate-500">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {candidate.projects.length > 0 && (
          <Card>
            <CardHeader title="Projects" />
            <ul className="divide-y divide-slate-100">
              {candidate.projects.map((p, i) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FolderGit2 size={15} className="text-slate-400" aria-hidden="true" />
                    <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                    {(p.link || p.url) && (
                      <a href={(p.link ?? p.url).startsWith('http') ? (p.link ?? p.url) : `https://${p.link ?? p.url}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
                        <Link2 size={12} className="mr-0.5 inline" aria-hidden="true" /> link
                      </a>
                    )}
                  </div>
                  {p.summary && <p className="mt-1 text-[13px] text-slate-600">{p.summary}</p>}
                  {Array.isArray(p.tech) && p.tech.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.tech.map((t) => (
                        <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {candidate.education.length > 0 && (
          <Card>
            <CardHeader title="Education" />
            <ul className="divide-y divide-slate-100">
              {candidate.education.map((e, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3.5">
                  <GraduationCap size={16} className="mt-0.5 text-slate-400" aria-hidden="true" />
                  <div>
                    {/* Stored shape is { school, degree, year }; tolerate the
                        alternate { institution, detail, start, end } shape too. */}
                    <p className="text-sm font-medium text-slate-900">
                      {e.school ?? e.institution ?? '—'}
                    </p>
                    <p className="text-[13px] text-slate-600">
                      {e.degree}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </p>
                    {(e.year || e.start || e.end) && (
                      <p className="text-xs text-slate-400">
                        {e.year ?? [e.start, e.end].filter(Boolean).join(' – ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-slate-500"><Mail size={13} aria-hidden="true" /> Email</dt>
                <dd className="truncate font-medium text-slate-800">
                  {candidate.email ? (
                    <a href={`mailto:${candidate.email}`} className="hover:text-brand-700 hover:underline">{candidate.email}</a>
                  ) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-slate-500"><MapPin size={13} aria-hidden="true" /> Location</dt>
                <dd className="font-medium text-slate-800">{candidate.location ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-slate-500"><Building2 size={13} aria-hidden="true" /> Current</dt>
                <dd className="truncate font-medium text-slate-800">{candidate.currentCompany ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-slate-500"><Calendar size={13} aria-hidden="true" /> Experience</dt>
                <dd className="font-medium text-slate-800">{candidate.yearsExperience ?? '—'} years</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Added</dt>
                <dd className="font-medium text-slate-800">{fmtDate(candidate.createdAt)}</dd>
              </div>
            </dl>
            {(candidate.links?.github || candidate.links?.portfolio) && (
              <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs">
                {candidate.links.github && (
                  <a href={`https://${candidate.links.github}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    <Github size={13} aria-hidden="true" /> {candidate.links.github}
                  </a>
                )}
                {candidate.links.portfolio && (
                  <a href={`https://${candidate.links.portfolio}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    <Link2 size={13} aria-hidden="true" /> {candidate.links.portfolio}
                  </a>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Skills" subtitle="As extracted — review evidence for verification status" />
          <CardBody>
            {candidate.skills.length === 0 ? (
              <p className="text-sm text-slate-500">No skills recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.map((s) => (
                  <span
                    key={`${s.candidateId}-${s.skill}`}
                    className="rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
                    title={`${s.years != null ? `${s.years} years · ` : ''}${s.level ?? ''} · source: ${s.source}`}
                  >
                    {s.skill}
                    {s.years != null && <span className="ml-1 font-normal text-brand-500">{s.years}y</span>}
                  </span>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Resume file" />
          <CardBody className="space-y-2 text-sm">
            {hasResume ? (
              <>
                <div className="flex items-start gap-2.5">
                  <FileText size={16} className="mt-0.5 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{candidate.resume.filename}</p>
                    <p className="text-xs text-slate-500">
                      {fmtBytes(candidate.resume.fileSize)} · {candidate.resume.pageCount ?? '?'} pages · uploaded {fmtDate(candidate.resume.uploadedAt)}
                    </p>
                  </div>
                </div>
                <Badge tone={candidate.resume.status === 'processed' ? 'green' : candidate.resume.status === 'failed' ? 'amber' : 'gray'} dot>
                  {candidate.resume.status}
                </Badge>
                <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                  <Info size={13} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
                  The original file is stored server-side (never publicly served) and its extracted text
                  is kept for evidence provenance. Uploaded documents are treated as untrusted content.
                </p>
              </>
            ) : (
              <p className="text-slate-500">
                No resume file attached — this profile comes from seeded demo data.{' '}
                <button type="button" className="text-brand-700 hover:underline" onClick={() => { window.location.href = '/candidates/upload'; }}>
                  Upload one
                </button>
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Applications" />
          {applications.length === 0 ? (
            <EmptyState icon={Briefcase} title="Not in any pipeline" description="Add from the Requirement evidence tab." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {applications.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link href={`/jobs/${a.jobId}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {a.job?.title ?? a.jobId}
                  </Link>
                  <StageBadge stage={a.stage} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assessments tab
// ---------------------------------------------------------------------------
function AssessmentsTab({ submissions }) {
  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No assessment submissions"
        description="This candidate has not completed a skill assessment yet."
        action={<Button href="/assessments" size="sm" variant="secondary">Browse assessments</Button>}
      />
    );
  }
  return (
    <div className="space-y-4">
      <InlineAlert tone="info" title="How results are produced">
        This environment never executes candidate code. Submissions receive deterministic static
        checks and are queued for human review — no score is auto-computed from running code.
      </InlineAlert>
      {submissions.map((sub) => {
        const checks = sub.result?.staticChecks ?? { passed: [], warnings: [] };
        return (
          <Card key={sub.id}>
            <CardHeader
              title={sub.assessment?.title ?? 'Assessment'}
              subtitle={`${sub.assessment?.skill ?? ''}${sub.assessment?.difficulty ? ` · ${sub.assessment.difficulty}` : ''} · submitted ${fmtDate(sub.submittedAt)}`}
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={sub.status === 'completed' ? 'green' : sub.status === 'manual_review' ? 'amber' : 'gray'} dot>
                    {sub.status.replace('_', ' ')}
                  </Badge>
                  {sub.score != null && <Badge tone="blue">Score {sub.score}</Badge>}
                </div>
              }
            />
            <CardBody className="space-y-3">
              <p className="text-xs text-slate-500">{sub.result?.executionNotice ?? 'Static checks only.'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3">
                  <p className="mb-1.5 text-xs font-semibold text-teal-800 inline-flex items-center gap-1">
                    <CheckCircle2 size={13} aria-hidden="true" /> Checks passed ({checks.passed.length})
                  </p>
                  {checks.passed.length === 0 ? (
                    <p className="text-xs text-teal-700">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {checks.passed.map((p, i) => (
                        <li key={i} className="text-xs text-teal-800">✓ {p}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <p className="mb-1.5 text-xs font-semibold text-amber-800 inline-flex items-center gap-1">
                    <AlertTriangle size={13} aria-hidden="true" /> Reviewer flags ({checks.warnings.length})
                  </p>
                  {checks.warnings.length === 0 ? (
                    <p className="text-xs text-amber-700">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {checks.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-800">! {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {sub.result?.reviewerNote && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Reviewer: {sub.result.reviewerNote}
                </p>
              )}
              {sub.result?.code && (
                <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    View submitted code
                  </summary>
                  <pre className="scroll-thin overflow-x-auto border-t border-slate-100 bg-slate-950 px-3 py-3 text-xs leading-relaxed text-slate-100">
                    {sub.result.code}
                  </pre>
                </details>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit profile dialog
// ---------------------------------------------------------------------------
function EditDialog({ candidate, open, onClose }) {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: candidate.fullName,
    headline: candidate.headline,
    email: candidate.email ?? '',
    location: candidate.location ?? '',
    currentCompany: candidate.currentCompany ?? '',
    yearsExperience: candidate.yearsExperience ?? '',
    summary: candidate.summary ?? '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (form.fullName.trim().length < 2) next.fullName = 'Name is required.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          headline: form.headline.trim(),
          email: form.email.trim() || null,
          location: form.location.trim() || null,
          currentCompany: form.currentCompany.trim() || null,
          yearsExperience: form.yearsExperience === '' ? null : Number(form.yearsExperience),
          summary: form.summary.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Save failed (${res.status})`);
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit profile"
      description="Correct extracted information. Changes are recorded in the audit log."
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" size="md" type="button" onClick={onClose}>Cancel</Button>
          <Button size="md" type="submit" form="edit-profile-form" disabled={saving}>
            {saving ? <Spinner size={14} /> : null} Save changes
          </Button>
        </>
      }
    >
      <form id="edit-profile-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="p-name" error={errors.fullName}>
            <Input id="p-name" data-autofocus value={form.fullName} onChange={set('fullName')} />
          </Field>
          <Field label="Headline" htmlFor="p-headline">
            <Input id="p-headline" value={form.headline} onChange={set('headline')} />
          </Field>
          <Field label="Email" htmlFor="p-email">
            <Input id="p-email" type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Location" htmlFor="p-location">
            <Input id="p-location" value={form.location} onChange={set('location')} />
          </Field>
          <Field label="Current company" htmlFor="p-company">
            <Input id="p-company" value={form.currentCompany} onChange={set('currentCompany')} />
          </Field>
          <Field label="Years of experience" htmlFor="p-years">
            <Input id="p-years" type="number" min="0" max="60" value={form.yearsExperience} onChange={set('yearsExperience')} />
          </Field>
        </div>
        <Field label="Summary" htmlFor="p-summary">
          <Textarea id="p-summary" rows={4} value={form.summary} onChange={set('summary')} />
        </Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab orchestrator
// ---------------------------------------------------------------------------
export default function CandidateProfileTabs({
  candidate,
  evidence,
  statusCounts,
  submissions,
  applications,
  jobMatrices,
  pipelineJobs,
}) {
  const [editing, setEditing] = useState(false);
  const pendingCount = statusCounts.needs_review + statusCounts.claimed;

  return (
    <>
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'evidence', label: 'Evidence', count: evidence.length },
          { id: 'requirements', label: 'Requirement evidence', count: jobMatrices.length },
          { id: 'assessments', label: 'Assessments', count: submissions.length },
        ]}
      >
        {(tab) => (
          <>
            {tab.id === 'overview' && <OverviewTab candidate={candidate} applications={applications} onEdit={() => setEditing(true)} />}
            {tab.id === 'evidence' && (
              <EvidenceTab candidateId={candidate.id} evidence={evidence} statusCounts={statusCounts} />
            )}
            {tab.id === 'requirements' && (
              <RequirementEvidenceTab
                candidateId={candidate.id}
                jobMatrices={jobMatrices}
                applications={applications}
                pipelineJobs={pipelineJobs}
              />
            )}
            {tab.id === 'assessments' && <AssessmentsTab submissions={submissions} />}
          </>
        )}
      </Tabs>

      <EditDialog candidate={candidate} open={editing} onClose={() => setEditing(false)} />

      {pendingCount > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          {pendingCount} evidence record{pendingCount === 1 ? '' : 's'} on this profile await human review.
        </p>
      )}
    </>
  );
}
