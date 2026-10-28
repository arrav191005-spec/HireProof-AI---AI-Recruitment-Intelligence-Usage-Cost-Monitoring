import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui/Feedback';
import Badge, { JobStatusBadge, StageBadge, evidenceStatusMeta } from '@/components/ui/Badge';
import CandidateProfileTabs from '@/components/candidates/CandidateProfileTabs';
import { requirementStatusFor } from '@/lib/search/engine';

export const dynamic = 'force-dynamic';

export default async function CandidateProfilePage({ params }) {
  const { id } = await params;
  const repo = await getRepo();
  const candidate = await repo.getCandidate(id);
  if (!candidate) notFound();

  const [evidence, submissions, applications, jobsResult, corpus] = await Promise.all([
    repo.getCandidateEvidence(id),
    repo.getCandidateSubmissions(id),
    repo.getCandidateApplications(id),
    repo.listJobs({ pageSize: 50 }),
    repo.searchCorpus(),
  ]);

  const entry = corpus.find((e) => e.candidate.id === id) ?? null;

  // Requirement-level evidence per relevant job, computed with the same
  // function the search engine uses (one source of truth for status logic).
  const relevantJobs = jobsResult.items.filter(
    (j) => j.status === 'open' || applications.some((a) => a.jobId === j.id)
  );
  const jobMatrices = relevantJobs.map((job) => {
    const requirements = [
      ...job.requiredSkills.map((r) => ({ ...r, category: 'required' })),
      ...job.preferredSkills.map((r) => ({ ...r, category: 'preferred' })),
    ];
    return {
      job: { id: job.id, title: job.title, status: job.status },
      rows: requirements.map((req) => ({
        requirement: req,
        ...(entry ? requirementStatusFor(entry, req.skill) : { status: 'not_established', source: [] }),
      })),
    };
  });

  const statusCounts = Object.fromEntries(
    Object.keys(evidenceStatusMeta).map((s) => [s, evidence.filter((e) => e.status === s).length])
  );

  const pending = jobsResult.items.filter((j) => !applications.some((a) => a.jobId === j.id));

  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Candidates', href: '/candidates' }, { label: candidate.fullName }]} />}
        title={candidate.fullName}
        description={candidate.headline}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={candidate.status === 'active' ? 'green' : 'gray'} dot>{candidate.status}</Badge>
            <Badge tone="blue">{candidate.source}</Badge>
          </div>
        }
      />

      <CandidateProfileTabs
        candidate={candidate}
        evidence={evidence}
        statusCounts={statusCounts}
        submissions={submissions}
        applications={applications}
        jobMatrices={jobMatrices}
        pipelineJobs={pending.map((j) => ({ id: j.id, title: j.title }))}
      />
    </>
  );
}
