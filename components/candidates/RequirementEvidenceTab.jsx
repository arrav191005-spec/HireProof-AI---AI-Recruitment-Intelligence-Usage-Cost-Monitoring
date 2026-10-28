'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageCircleQuestionMark, UserPlus, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { EvidenceBadge, StageBadge, JobStatusBadge } from '@/components/ui/Badge';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import { evidenceExplanations } from '@/components/evidence/EvidenceCard';

function SourceLine({ source, candidateId }) {
  if (!source?.length) return null;
  const first = source[0];
  if (first.excerpt) {
    return (
      <p className="mt-1 text-xs text-slate-600">
        <FileText size={12} className="mr-1 inline text-slate-400" aria-hidden="true" />
        “{first.excerpt.length > 160 ? `${first.excerpt.slice(0, 160)}…` : first.excerpt}”{' '}
        <Link href={`/candidates/${candidateId}#evidence-${first.evidenceId}`} className="font-medium text-brand-700 hover:underline">
          source
        </Link>
      </p>
    );
  }
  if (first.detail) return <p className="mt-1 text-xs text-slate-600">{first.detail}</p>;
  return null;
}

function InterviewPanel({ candidateId, jobId, requirements }) {
  const [skill, setSkill] = useState(requirements[0]?.skill ?? '');
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const [open, setOpen] = useState(false);

  const generate = async () => {
    setState({ loading: true, error: null, data: null });
    setOpen(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interview-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, skill, count: 3 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? `Generation failed (${res.status})`);
      setState({ loading: false, error: null, data: body.data ?? body });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={`iq-${jobId}`} className="text-[13px] font-medium text-slate-700">
            Interview preparation
          </label>
          <Select id={`iq-${jobId}`} className="mt-1.5" value={skill} onChange={(e) => setSkill(e.target.value)}>
            {requirements.map((r) => (
              <option key={`${r.category}-${r.skill}`} value={r.skill}>
                {r.skill} ({r.category})
              </option>
            ))}
          </Select>
        </div>
        <Button size="md" onClick={generate} disabled={state.loading || !skill}>
          {state.loading ? <Spinner size={14} /> : <MessageCircleQuestionMark size={15} />} Generate questions
        </Button>
        {open && (
          <Button size="md" variant="ghost" onClick={() => setOpen(false)}>Hide</Button>
        )}
      </div>

      {state.error && <div className="mt-3"><InlineAlert tone="error">{state.error}</InlineAlert></div>}

      {open && state.data && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">{state.data.modeLabel}</p>
          <ol className="space-y-2">
            {state.data.questions.map((q, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[13px]">
                <p className="font-medium text-slate-800">
                  {i + 1}. {q.text}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {q.groundedIn ? (
                    <>Grounded in: “{q.groundedIn}”</>
                  ) : (
                    <span className="text-amber-700">No source excerpt available — verify with the candidate.</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Questions are drafted only from located evidence for this requirement. Nothing here is
            auto-sent to the candidate, and no answer is scored automatically.
          </p>
        </div>
      )}
    </div>
  );
}

// Requirement-evidence tab: per-job requirement matrix + pipeline + interview prep.
export default function RequirementEvidenceTab({
  candidateId,
  jobMatrices,
  applications,
  pipelineJobs,
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState(null);

  const add = async (jobId) => {
    setAdding(jobId);
    setError(null);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, jobId, stage: 'applied' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Could not add to pipeline (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(null);
    }
  };

  if (jobMatrices.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No relevant jobs yet"
        description="Create an open job and its requirements — evidence for this candidate will be matched against them here."
        action={<Button href="/jobs/new" size="sm">Create job</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {jobMatrices.map(({ job, rows }) => {
        const applied = applications.find((a) => a.jobId === job.id);
        const requirements = rows.map((r) => r.requirement);
        return (
          <Card key={job.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs/${job.id}`} className="hover:text-brand-700 hover:underline">
                    {job.title}
                  </Link>
                  <JobStatusBadge status={job.status} />
                  {applied && <StageBadge stage={applied.stage} />}
                </span>
              }
              subtitle={
                applied
                  ? `In pipeline since ${new Date(applied.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : 'Not in this pipeline yet'
              }
              actions={
                !applied ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={adding === job.id}
                    onClick={() => add(job.id)}
                  >
                    {adding === job.id ? <Spinner size={13} /> : <UserPlus size={14} />} Add to pipeline
                  </Button>
                ) : null
              }
            />
            <CardBody className="space-y-4">
              <div className="table-scroll rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th scope="col" className="px-4 py-2.5 font-medium">Requirement</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Evidence status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.map(({ requirement: req, status, source }) => (
                      <tr key={`${job.id}-${req.category}-${req.skill}`}>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {req.skill}
                          <div className="mt-0.5 text-xs font-normal text-slate-500">
                            {req.minYears != null ? `${req.minYears}+ yr expected` : 'no year bar'}
                            {req.note ? ` · ${req.note}` : ''}
                          </div>
                          <SourceLine source={source} candidateId={candidateId} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">{req.category}</td>
                        <td className="px-4 py-3">
                          <EvidenceBadge status={status} />
                          <p className="mt-1 max-w-xs text-xs leading-snug text-slate-400">
                            {evidenceExplanations[status]}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <InterviewPanel candidateId={candidateId} jobId={job.id} requirements={requirements} />
            </CardBody>
          </Card>
        );
      })}

      {pipelineJobs.length > 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-600">
          <span className="font-medium text-slate-700">Other open jobs: </span>
          {pipelineJobs.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ' · '}
              <button type="button" className="text-brand-700 hover:underline" onClick={() => add(j.id)}>
                {j.title}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
