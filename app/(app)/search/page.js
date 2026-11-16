import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import SearchClient from '@/components/search/SearchClient';
import { semanticAvailable } from '@/lib/search/semantic';
import { toClientCorpus, skillVocabulary } from '@/lib/search/client-corpus';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const repo = await getRepo();

  // One cold render per user/token; worker.js caches the document for 15
  // minutes. Everything the browser needs to rank a search is embedded here,
  // so typing a query never calls the CPU-expensive POST /api/search route.
  const [jobsPage, corpus, history, backendInfo, apiSemanticEnabled] = await Promise.all([
    repo.listJobs({ pageSize: 50 }),
    repo.searchCorpus(),
    repo.recentSearchEvents(8),
    repo.getBackendInfo(),
    semanticAvailable(),
  ]);

  const clientCorpus = toClientCorpus(corpus);
  const jobs = jobsPage.items.map((j) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    requirements: [
      ...(j.requiredSkills ?? []).map((r) => ({
        skill: r.skill,
        category: 'required',
        minYears: r.minYears ?? null,
        note: r.note ?? null,
      })),
      ...(j.preferredSkills ?? []).map((r) => ({
        skill: r.skill,
        category: 'preferred',
        minYears: r.minYears ?? null,
        note: r.note ?? null,
      })),
    ],
  }));

  return (
    <>
      <PageHeader
        title="Candidate Search"
        description="Describe who you're looking for in plain language. Every result shows which requirements have supporting evidence — and which remain unestablished."
      />
      <SearchClient
        initialQuery={params.q ?? ''}
        initialJobId={params.jobId ?? ''}
        jobs={jobs}
        allSkills={skillVocabulary(clientCorpus)}
        corpus={clientCorpus}
        initialHistory={history}
        backend={backendInfo.backend}
        apiSemanticEnabled={apiSemanticEnabled}
      />
    </>
  );
}
