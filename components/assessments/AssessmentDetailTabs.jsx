'use client';

import { useState } from 'react';
import Link from '@/components/ui/NoPrefetchLink';
import { useRouter } from 'next/navigation';
import Tabs from '@/components/ui/Tabs';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Field, Textarea, Select, Input } from '@/components/ui/Field';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import { ClipboardCheck, Send, CheckCircle2, AlertTriangle, Play, Eye } from 'lucide-react';

const statusTone = {
  completed: 'green',
  manual_review: 'amber',
  pending: 'gray',
  failed: 'slate',
};

const STARTER_CODE = `function summarizeOrders(orders) {
  // Return { totalCount, completedCount, revenueByCustomer }
  // - revenueByCustomer: sum of totals for COMPLETED orders only
  // - ignore orders without a numeric total
}
`;

// ---------------------------------------------------------------------------
// Task tab
// ---------------------------------------------------------------------------
function TaskTab({ assessment }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="Task" />
          <CardBody className="space-y-4">
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{assessment.description}</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Instructions</p>
              <p className="whitespace-pre-line font-mono text-[13px] leading-relaxed text-slate-700">{assessment.instructions}</p>
            </div>
          </CardBody>
        </Card>

        {assessment.testCases?.length > 0 && (
          <Card>
            <CardHeader
              title="Test cases"
              subtitle="Documented expectations — referenced by reviewers, not executed automatically"
            />
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="px-5 py-3 font-medium">Case</th>
                    <th scope="col" className="px-4 py-3 font-medium">Input</th>
                    <th scope="col" className="px-4 py-3 font-medium">Expected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assessment.testCases.map((tc, i) => (
                    <tr key={i}>
                      <td className="px-5 py-3 font-medium text-slate-800">{tc.name}</td>
                      <td className="px-4 py-3"><code className="text-xs text-slate-600">{tc.input}</code></td>
                      <td className="px-4 py-3"><code className="text-xs text-slate-600">{tc.expected}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Execution policy" />
          <CardBody className="space-y-2 text-[13px] text-slate-600">
            <p>
              <strong>Mode:</strong> {assessment.executionMode === 'static_checks' ? 'Static checks + human review' : assessment.executionMode}
            </p>
            <p>
              Submitted code is <strong>not executed</strong> in this build. Reviewers see deterministic
              checks (function defined, suspicious patterns, expected entry points) plus the raw code.
            </p>
            <p className="text-xs text-slate-500">
              A production deployment must run candidate code in an isolated sandbox with CPU/memory
              limits, timeouts, no network, no filesystem and no secrets.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Metadata" />
          <CardBody>
            <dl className="space-y-2.5 text-sm">
              {[
                ['Skill', assessment.skill],
                ['Difficulty', assessment.difficulty],
                ['Time limit', `${assessment.timeLimitMinutes} min`],
                ['Status', assessment.status],
                ['Created', new Date(assessment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submissions tab (review workflow)
// ---------------------------------------------------------------------------
function SubmissionCard({ submission, assessmentId }) {
  const router = useRouter();
  const [status, setStatus] = useState(submission.status);
  const [score, setScore] = useState(submission.score ?? '');
  const [note, setNote] = useState(submission.result?.reviewerNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const checks = submission.result?.staticChecks ?? { passed: [], warnings: [] };
  const tests = submission.result?.testCaseResults ?? [];
  const seeded = submission.executionMode === 'demo_data';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/submissions/${submission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          score: score === '' ? null : Number(score),
          reviewerNote: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Save failed (${res.status})`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/candidates/${submission.candidateId}`} className="hover:text-brand-700 hover:underline">
              {submission.candidate?.fullName ?? submission.candidateId}
            </Link>
            <Badge tone={statusTone[status] ?? 'gray'} dot>{status.replace('_', ' ')}</Badge>
            {seeded && <Badge tone="slate">seeded demo result</Badge>}
          </span>
        }
        subtitle={`Submitted ${new Date(submission.submittedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${submission.candidate?.headline ?? ''}`}
      />
      <CardBody className="space-y-4">
        {submission.result?.executionNotice && (
          <InlineAlert tone="info">{submission.result.executionNotice}</InlineAlert>
        )}

        {tests.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recorded test results (from the secure-runner demo dataset)
            </p>
            <ul className="space-y-1.5">
              {tests.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  {t.passed ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                  )}
                  <span className={t.passed ? 'text-slate-700' : 'text-amber-800'}>{t.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3">
            <p className="mb-1.5 text-xs font-semibold text-teal-800">Static checks passed ({checks.passed.length})</p>
            <ul className="space-y-1">
              {checks.passed.length === 0 && <li className="text-xs text-teal-700">None</li>}
              {checks.passed.map((p, i) => (
                <li key={i} className="text-xs text-teal-800">✓ {p}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-1.5 text-xs font-semibold text-amber-800">Flags ({checks.warnings.length})</p>
            <ul className="space-y-1">
              {checks.warnings.length === 0 && <li className="text-xs text-amber-700">None</li>}
              {checks.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-800">! {w}</li>
              ))}
            </ul>
          </div>
        </div>

        {submission.result?.code && (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setShowCode((s) => !s)}>
              <Eye size={13} /> {showCode ? 'Hide code' : 'View submitted code'}
            </Button>
            {showCode && (
              <pre className="scroll-thin mt-2 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-xs leading-relaxed text-slate-100">
                {submission.result.code}
              </pre>
            )}
          </div>
        )}

        <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
          <Field label="Decision" htmlFor={`st-${submission.id}`}>
            <Select id={`st-${submission.id}`} value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
              <option value="pending">Pending</option>
              <option value="manual_review">Manual review</option>
              <option value="completed">Completed</option>
              <option value="failed">Did not meet bar</option>
            </Select>
          </Field>
          <Field label="Score (0–100, optional)" htmlFor={`sc-${submission.id}`}>
            <Input id={`sc-${submission.id}`} type="number" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} disabled={saving} placeholder="—" />
          </Field>
          <Field label="Reviewer note" htmlFor={`rn-${submission.id}`}>
            <Input id={`rn-${submission.id}`} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="Rationale…" />
          </Field>
        </div>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {saved && <InlineAlert tone="success">Review saved.</InlineAlert>}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Spinner size={13} /> : <CheckCircle2 size={13} />} Save review
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function SubmissionsTab({ assessment }) {
  const submissions = assessment.submissions ?? [];
  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="No submissions yet"
        description="Record one from the Submit tab — for demo purposes you can attach code on behalf of a demo candidate."
      />
    );
  }
  return (
    <div className="space-y-4">
      <p className="px-1 text-xs text-slate-500">
        {submissions.length} submission{submissions.length === 1 ? '' : 's'} — each result is stored with its
        static-check history; decisions here are human-reviewed.
      </p>
      {submissions.map((s) => (
        <SubmissionCard key={s.id} submission={s} assessmentId={assessment.id} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-submission tab
// ---------------------------------------------------------------------------
function SubmitTab({ assessment, candidates }) {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState('');
  const [code, setCode] = useState(assessment.skill === 'JavaScript' ? STARTER_CODE : '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!candidateId) {
      setError('Choose a candidate.');
      return;
    }
    if (!code.trim()) {
      setError('Paste the submitted code (or answers).');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/assessments/${assessment.id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? `Submission failed (${res.status})`);
      setResult(body.data ?? body);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <InlineAlert tone="warning" title="Demo submission path">
        In a real deployment candidates submit through their own authenticated portal. This panel
        exists so the review workflow can be demonstrated end-to-end with synthetic data.
      </InlineAlert>

      <Card>
        <CardHeader title="Record a submission" />
        <CardBody>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Candidate" htmlFor="s-cand" hint="required">
              <Select id="s-cand" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">Select a demo candidate…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName} — {c.headline}</option>
                ))}
              </Select>
            </Field>
            <Field label="Code / answers" htmlFor="s-code">
              <div className="mb-1.5">
                <Button variant="secondary" size="xs" type="button" onClick={() => setCode(STARTER_CODE)}>
                  <Play size={12} /> Load starter template
                </Button>
              </div>
              <Textarea
                id="s-code"
                rows={10}
                className="font-mono text-[13px]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="// paste submitted code"
              />
            </Field>
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner size={15} /> : <Send size={15} />} Submit for static checks
            </Button>
          </form>
        </CardBody>
      </Card>

      {result && (
        <Card className="border-teal-200">
          <CardHeader title="Static-check result" subtitle="Queued for human review — code was NOT executed" />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-teal-700">✓ {result.result?.staticChecks?.passed?.length ?? 0} checks passed</span>
              <span className="text-amber-700">! {result.result?.staticChecks?.warnings?.length ?? 0} flags</span>
            </div>
            {(result.result?.staticChecks?.warnings ?? []).map((w, i) => (
              <p key={i} className="text-[13px] text-amber-800">! {w}</p>
            ))}
            <p className="text-[13px] text-slate-600">{result.result?.executionNotice}</p>
            <Link href={`/candidates/${candidateId}`} className="text-sm font-medium text-brand-700 hover:underline">
              Open candidate profile →
            </Link>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function AssessmentDetailTabs({ assessment, candidates }) {
  const submissionCount = assessment.submissions?.length ?? 0;
  return (
    <Tabs
      tabs={[
        { id: 'task', label: 'Task' },
        { id: 'submissions', label: 'Submissions', count: submissionCount },
        { id: 'submit', label: 'Record submission' },
      ]}
    >
      {(tab) => (
        <>
          {tab.id === 'task' && <TaskTab assessment={assessment} />}
          {tab.id === 'submissions' && <SubmissionsTab assessment={assessment} />}
          {tab.id === 'submit' && <SubmitTab assessment={assessment} candidates={candidates} />}
        </>
      )}
    </Tabs>
  );
}
