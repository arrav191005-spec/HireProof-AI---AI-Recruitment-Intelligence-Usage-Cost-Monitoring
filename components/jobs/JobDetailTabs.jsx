'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Tabs from '@/components/ui/Tabs';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { EvidenceBadge, StageBadge, jobStatusMeta } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Field';
import { EmptyState, InlineAlert, Spinner } from '@/components/ui/Feedback';
import { Search, Sparkles, Wand2, Check, Users, FileText } from 'lucide-react';

function statusTone(s) {
  return jobStatusMeta[s]?.tone ?? 'gray';
}

function RequirementsTab({ requirements, applications, evidenceByCandidate }) {
  return (
    <div className="table-scroll rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-400">
            <th scope="col" className="px-4 py-3 font-medium">Skill</th>
            <th scope="col" className="px-4 py-3 font-medium">Category</th>
            <th scope="col" className="px-4 py-3 font-medium">Min years</th>
            <th scope="col" className="px-4 py-3 font-medium">Candidate coverage</th>
            <th scope="col" className="px-4 py-3 font-medium">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {requirements.map((req, i) => {
            const covered = applications.filter((a) =>
              (evidenceByCandidate[a.candidateId] ?? []).some(
                (ev) => ev.skill.toLowerCase() === req.skill.toLowerCase() && (ev.status === 'supporting' || ev.status === 'assessment')
              )
            ).length;
            return (
              <tr key={`${req.category}-${req.skill}-${i}`}>
                <td className="px-4 py-3 font-medium text-slate-800">{req.skill}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${req.category === 'required' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
                    {req.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{req.minYears ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <Users size={14} className="text-slate-400" aria-hidden="true" />
                    {covered} of {applications.length} in pipeline with supporting evidence
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{req.note ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PipelineTab({ applications }) {
  const [stages, setStages] = useState(Object.fromEntries(applications.map((a) => [a.id, a.stage])));
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  const changeStage = async (appId, stage) => {
    setSavingId(appId);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error('Update failed');
      setStages((s) => ({ ...s, [appId]: stage }));
    } catch {
      setError('Could not update the stage. Try again.');
    } finally {
      setSavingId(null);
    }
  };

  if (applications.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No candidates in the pipeline yet"
        description="Use candidate search to find people matching this job's requirements, then add them from their profile."
        action={<Button href="/search" variant="secondary" size="sm"><Search size={14} /> Search candidates</Button>}
      />
    );
  }
  return (
    <div>
      {error && <div className="mb-3"><InlineAlert tone="error">{error}</InlineAlert></div>}
      <div className="table-scroll rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <th scope="col" className="px-4 py-3 font-medium">Candidate</th>
              <th scope="col" className="px-4 py-3 font-medium">Headline</th>
              <th scope="col" className="px-4 py-3 font-medium">Stage</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Profile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {applications.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-medium text-slate-800">{a.candidate?.fullName ?? a.candidateId}</td>
                <td className="px-4 py-3 text-slate-600">{a.candidate?.headline}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={stages[a.id] ?? a.stage}
                      onChange={(e) => changeStage(a.id, e.target.value)}
                      disabled={savingId === a.id}
                      aria-label={`Stage for ${a.candidate?.fullName}`}
                      className="w-40 py-1.5 text-xs"
                    >
                      {['applied', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected'].map((s) => (
                        <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                      ))}
                    </Select>
                    {savingId === a.id && <Spinner size={14} />}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/candidates/${a.candidateId}`} className="text-brand-700 hover:underline">Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Stage changes are recorded in the audit log. The platform never rejects a candidate automatically.
      </p>
    </div>
  );
}

function AnalysisTab({ job }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState({});
  const router = useRouter();

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/analyze`, { method: 'POST' });
      if (!res.ok) throw new Error('Analysis failed');
      setAnalysis(await res.json());
    } catch {
      setError('Could not analyze the description. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const applySuggestion = async (s) => {
    const addition = `\n\n[Clarification] ${s.target}: ${s.suggestion}`;
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: job.description + addition }),
    });
    if (res.ok) {
      setApplied((a) => ({ ...a, [s.id]: true }));
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <InlineAlert tone="info" title="Review-only suggestions">
        Analysis identifies skills, ambiguities and clarification options. Nothing is rewritten or
        published automatically — you explicitly choose what to apply.
      </InlineAlert>

      {!analysis && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
          <Sparkles className="text-slate-300" size={28} aria-hidden="true" />
          <p className="text-sm text-slate-500">
            Run an analysis to detect skills and ambiguities in this job description.
          </p>
          <Button onClick={run} disabled={loading}>
            {loading ? <><Spinner size={14} /> Analyzing…</> : <><Wand2 size={15} /> Analyze description</>}
          </Button>
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">{analysis.modeLabel}</p>
          <Card>
            <CardHeader title="Detected skills" subtitle={`From title + description + requirement fields`} />
            <CardBody className="flex flex-wrap gap-2">
              {analysis.detectedSkills.length === 0 ? (
                <p className="text-sm text-slate-500">No known skills detected — consider naming the technologies explicitly.</p>
              ) : (
                analysis.detectedSkills.map((s) => (
                  <span key={s} className="rounded-lg bg-brand-50 px-2.5 py-1 text-[13px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">{s}</span>
                ))
              )}
            </CardBody>
          </Card>

          {analysis.ambiguities?.length > 0 && (
            <Card>
              <CardHeader title="Ambiguities" subtitle="Wording that may confuse candidates or weaken evidence matching" />
              <CardBody>
                <ul className="space-y-3">
                  {analysis.ambiguities.map((a, i) => (
                    <li key={i} className="flex gap-3 text-[13px]">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                      <div>
                        {a.skill && <span className="font-medium text-slate-800">{a.skill}: </span>}
                        <span className="text-slate-600">{a.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {analysis.suggestions?.length > 0 && (
            <Card>
              <CardHeader title="Clarification suggestions" subtitle="Apply individually — each edit is explicit and reversible in the description" />
              <CardBody className="space-y-3">
                {analysis.suggestions.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="text-[13px]">
                      <p className="font-medium text-slate-800">{s.target}</p>
                      <p className="mt-0.5 text-slate-600">{s.suggestion}</p>
                    </div>
                    {applied[s.id] ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-teal-700"><Check size={14} /> Added</span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => applySuggestion(s)}>Add to description</Button>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Button variant="secondary" size="sm" onClick={run} disabled={loading}>
            {loading ? <Spinner size={14} /> : 'Re-run analysis'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function JobDetailTabs({ job, requirements, applications, evidenceByCandidate = {} }) {
  const [currentStatus, setCurrentStatus] = useState(job.status);
  const [savingStatus, setSavingStatus] = useState(false);
  const router = useRouter();

  const changeStatus = async (status) => {
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setCurrentStatus(status);
        router.refresh();
      }
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <Tabs
      tabs={[
        { id: 'overview', label: 'Overview' },
        { id: 'requirements', label: 'Requirements', count: requirements.length },
        { id: 'pipeline', label: 'Pipeline', count: applications.length },
        { id: 'analysis', label: 'Analysis' },
      ]}
    >
      {(tab) => (
        <>
          {tab.id === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Description" actions={
                  <label className="flex items-center gap-2 text-[13px] text-slate-500">
                    Status
                    <Select value={currentStatus} onChange={(e) => changeStatus(e.target.value)} disabled={savingStatus} className="w-32 py-1.5 text-xs" aria-label="Job status">
                      <option value="draft">Draft</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </label>
                } />
                <CardBody>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{job.description || 'No description yet.'}</p>
                </CardBody>
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Details" />
                  <CardBody>
                    <dl className="space-y-3 text-sm">
                      {[
                        ['Department', job.department],
                        ['Location', job.location],
                        ['Employment type', job.employmentType],
                        ['Experience range', job.experienceMin != null || job.experienceMax != null ? `${job.experienceMin ?? 0}–${job.experienceMax ?? '+'} years` : '—'],
                        ['Created', new Date(job.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
                        ['Created by', job.createdBy],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-4">
                          <dt className="text-slate-500">{label}</dt>
                          <dd className="text-right font-medium text-slate-800">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Find candidates" />
                  <CardBody className="space-y-3">
                    <Button href={`/search?jobId=${job.id}`} className="w-full">
                      <Search size={15} /> Search with these requirements
                    </Button>
                    <p className="text-xs leading-relaxed text-slate-500">
                      Runs search pre-loaded with this job's {requirements.filter((r) => r.category === 'required').length} required
                      and {requirements.filter((r) => r.category === 'preferred').length} preferred skills, showing per-requirement
                      evidence for every result.
                    </p>
                  </CardBody>
                </Card>
              </div>
            </div>
          )}
          {tab.id === 'requirements' && <RequirementsTab requirements={requirements} applications={applications} evidenceByCandidate={evidenceByCandidate} />}
          {tab.id === 'pipeline' && <PipelineTab applications={applications} />}
          {tab.id === 'analysis' && <AnalysisTab job={job} />}
        </>
      )}
    </Tabs>
  );
}
