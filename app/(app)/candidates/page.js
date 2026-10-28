import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { EmptyState, Breadcrumbs, InlineAlert } from '@/components/ui/Feedback';
import { EvidenceBadge } from '@/components/ui/Badge';
import { Users, MapPin, Plus, Upload, ClipboardCheck, X } from 'lucide-react';
import Link from 'next/link';
import CandidateFilters from '@/components/candidates/CandidateFilters';

export const dynamic = 'force-dynamic';

const evidenceFilterLabels = {
  claimed: 'Candidate claimed',
  supporting: 'Supporting evidence',
  assessment: 'Assessment evidence',
  not_established: 'Not established',
  needs_review: 'Needs review',
};

export default async function CandidatesPage({ searchParams }) {
  const params = await searchParams;
  const repo = await getRepo();
  const q = params.q ?? '';
  const skill = params.skill ?? '';
  const minYears = params.minYears ?? '';
  const maxYears = params.maxYears ?? '';
  const sort = params.sort ?? 'recent';
  const evidenceStatus = params.evidenceStatus ?? '';
  const page = Number(params.page ?? 1);

  const { items, total, pageCount } = await repo.listCandidates({
    q, skill, minYears, maxYears, evidenceStatus, sort, page, pageSize: 10,
  });

  const allSkills = [...new Set(
    (await repo.searchCorpus()).flatMap((e) => e.skills.map((s) => s.skill))
  )].sort();

  // Per-page evidence + assessment rollup (bounded by page size)
  const rollups = {};
  await Promise.all(
    items.map(async (c) => {
      const [evidence, submissions] = await Promise.all([
        repo.getCandidateEvidence(c.id),
        repo.getCandidateSubmissions(c.id),
      ]);
      rollups[c.id] = {
        supportCount: evidence.filter((e) => e.status === 'supporting' || e.status === 'assessment').length,
        pendingReview: evidence.filter((e) => e.status === 'needs_review' || e.status === 'claimed').length,
        completedAssessments: submissions.filter((s) => s.status === 'completed').length,
        totalEvidence: evidence.length,
      };
    })
  );

  const baseParams = { q, skill, minYears, maxYears, sort, evidenceStatus };
  const queryParams = (extra = {}, omit = []) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...baseParams, ...extra })) {
      if (omit.includes(k) || !v) continue;
      if (k === 'sort' && v === 'recent') continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <>
      <PageHeader
        title="Candidates"
        description="Every profile with skills, evidence status and assessment history."
        actions={
          <>
            <Button href="/candidates/upload" variant="secondary">
              <Upload size={15} /> Upload resume
            </Button>
            <Button href="/search">
              <Plus size={15} /> Search with criteria
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <CandidateFilters
          allSkills={allSkills}
          initial={{ q, skill, minYears, maxYears, sort, evidenceStatus }}
        />
        {evidenceStatus && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">Filtered by evidence status:</span>
            <span className="inline-flex items-center gap-1.5">
              <EvidenceBadge status={evidenceStatus} />
              <Link
                href={queryParams({}, ['evidenceStatus', 'page'])}
                className="text-xs text-slate-500 hover:text-brand-700 hover:underline"
                aria-label="Clear evidence status filter"
              >
                <X size={12} aria-hidden="true" className="inline" /> Clear
              </Link>
            </span>
          </div>
        )}
      </Card>

      <div className="mt-4">
        {items.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title={q || skill || evidenceStatus ? 'No candidates match these filters' : 'No candidates yet'}
              description={
                q || skill || evidenceStatus
                  ? 'Try different keywords or clear some filters.'
                  : 'Upload a resume to create the first profile — extraction results are always reviewed before saving.'
              }
              action={
                q || skill || evidenceStatus ? (
                  <Button href="/candidates" size="sm" variant="secondary">Clear filters</Button>
                ) : (
                  <Button href="/candidates/upload" size="sm"><Upload size={14} /> Upload resume</Button>
                )
              }
            />
          </Card>
        ) : (
          <Card>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="px-5 py-3 font-medium">Candidate</th>
                    <th scope="col" className="px-4 py-3 font-medium">Skills</th>
                    <th scope="col" className="px-4 py-3 font-medium">Exp.</th>
                    <th scope="col" className="px-4 py-3 font-medium">Evidence</th>
                    <th scope="col" className="px-4 py-3 font-medium">Assessments</th>
                    <th scope="col" className="px-4 py-3 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((c) => {
                    const r = rollups[c.id] ?? {};
                    return (
                      <tr key={c.id} className="group transition-colors hover:bg-slate-50/70">
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/candidates/${c.id}`}
                            className="font-medium text-slate-900 group-hover:text-brand-700 group-hover:underline underline-offset-2"
                          >
                            {c.fullName}
                          </Link>
                          <p className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{c.headline}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {(c.skills ?? []).slice(0, 3).map((s) => (
                              <span key={`${c.id}-${s.skill}`} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                {s.skill}
                              </span>
                            ))}
                            {(c.skills ?? []).length > 3 && (
                              <span className="text-xs text-slate-400">+{c.skills.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">{c.yearsExperience ?? '—'} yr</td>
                        <td className="px-4 py-3.5">
                          {r.pendingReview > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                              {r.pendingReview} to review
                            </span>
                          ) : (
                            <span className="text-slate-500">{r.supportCount ?? 0} supporting</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 text-slate-600">
                            <ClipboardCheck size={13} className="text-slate-400" aria-hidden="true" />
                            {r.completedAssessments ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={13} className="text-slate-400" aria-hidden="true" /> {c.location}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-slate-400">
          {total} candidate{total === 1 ? '' : 's'}
          {pageCount > 1 && <> · page {page} of {pageCount}</>}
          {' '}· synthetic demo data mixed with your uploads
        </p>
        {pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-1">
            {page > 1 && (
              <Link href={queryParams({ page: page - 1 })} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                ← Previous
              </Link>
            )}
            {page < pageCount && (
              <Link href={queryParams({ page: page + 1 })} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                Next →
              </Link>
            )}
          </nav>
        )}
      </div>

      <div className="mt-4">
        <InlineAlert tone="info" title="Decision support only">
          HireProof never auto-rejects or ranks people down for missing information — “not established”
          always means the records do not say, not that the candidate lacks the skill.
        </InlineAlert>
      </div>
    </>
  );
}
