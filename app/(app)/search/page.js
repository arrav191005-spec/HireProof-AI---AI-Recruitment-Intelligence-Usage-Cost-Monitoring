import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import SearchClient from '@/components/search/SearchClient';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const repo = await getRepo();
  const { items: jobs } = await repo.listJobs({ pageSize: 50 });
  // Filter vocabulary only — the full corpus is loaded per search POST in
  // /api/search, not on every page view.
  const allSkills = (await repo.listSkillVocab()).sort();

  return (
    <>
      <PageHeader
        title="Candidate Search"
        description="Describe who you're looking for in plain language. Every result shows which requirements have supporting evidence — and which remain unestablished."
      />
      <SearchClient
        initialQuery={params.q ?? ''}
        initialJobId={params.jobId ?? ''}
        jobs={jobs.map((j) => ({ id: j.id, title: j.title, status: j.status }))}
        allSkills={allSkills}
      />
    </>
  );
}
