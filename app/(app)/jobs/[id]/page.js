import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui/Feedback';
import { JobStatusBadge } from '@/components/ui/Badge';
import JobDetailTabs from '@/components/jobs/JobDetailTabs';

export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }) {
  const { id } = await params;
  const repo = await getRepo();
  const job = await repo.getJob(id);
  if (!job) notFound();
  const [requirements, applications] = await Promise.all([
    repo.getJobRequirements(id),
    repo.getJobApplications(id),
  ]);
  const evidenceByCandidate = {};
  await Promise.all(
    applications.map(async (a) => {
      evidenceByCandidate[a.candidateId] = await repo.getCandidateEvidence(a.candidateId);
    })
  );

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Jobs', href: '/jobs' }, { label: job.title }]} />
        }
        title={job.title}
        description={`${job.department} · ${job.location} · ${job.employmentType}`}
        actions={<JobStatusBadge status={job.status} />}
      />
      <JobDetailTabs job={job} requirements={requirements} applications={applications} evidenceByCandidate={evidenceByCandidate} />
    </>
  );
}
