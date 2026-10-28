import getRepo, { getBackendInfo } from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { searchRequestSchema } from '@/lib/validation';
import { searchCandidates, parseQuery } from '@/lib/search/engine';
import { semanticAvailable } from '@/lib/search/semantic';

export const dynamic = 'force-dynamic';

// GET /api/search — recent search history (for the search page's history list).
export async function GET() {
  try {
    await requireUser();
    const repo = await getRepo();
    const history = await repo.recentSearchEvents(8);
    return ok({ history });
  } catch (err) {
    return handleRouteError(err, 'GET /api/search');
  }
}

// POST /api/search — natural-language candidate search.
//
// Ranking is transparent: each result exposes its score components. When no
// embedding provider is configured the mode is "keyword+requirement" — this is
// reported honestly in the response and the UI never labels it semantic.
export async function POST(request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(searchRequestSchema, body);
    if (!valid) return error;
    const repo = await getRepo();

    let job = null;
    let jobRequirements = null;
    if (data.jobId) {
      job = await repo.getJob(data.jobId);
      if (!job) return fail(404, 'Job not found');
      jobRequirements = await repo.getJobRequirements(data.jobId);
    }

    const corpus = await repo.searchCorpus();
    const semantic = await semanticAvailable();
    const { results, parsed, mode } = searchCandidates(corpus, {
      query: data.query,
      jobId: data.jobId,
      jobRequirements,
      filters: data.filters,
    });

    const total = results.length;
    const pageCount = Math.max(1, Math.ceil(total / data.pageSize));
    const page = Math.min(data.page, pageCount);
    const pageResults = results.slice((page - 1) * data.pageSize, page * data.pageSize);

    if (data.query) {
      await repo.recordSearchEvent({
        query: data.query,
        mode: semantic ? 'hybrid' : 'keyword+requirement',
        resultCount: total,
      });
    }

    return ok(
      {
        results: pageResults,
        parsedQuery: parsed,
        job: job ? { id: job.id, title: job.title, requirements: jobRequirements } : null,
      },
      {
        mode: semantic ? 'hybrid (semantic + keyword)' : 'keyword + requirement evidence (semantic search not configured)',
        semanticEnabled: semantic,
        total,
        page,
        pageCount,
        backend: (await getBackendInfo()).backend,
      }
    );
  } catch (err) {
    return handleRouteError(err, 'POST /api/search');
  }
}
