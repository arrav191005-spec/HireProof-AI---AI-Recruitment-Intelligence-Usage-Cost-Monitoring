import getRepo from '@/lib/repo';
import { ok, requireUser, validate, handleRouteError } from '@/lib/api';
import { searchEventSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// POST /api/search/event — best-effort search history.
//
// Candidate ranking runs in the browser (see components/search/SearchClient),
// so this is the only search-related request the UI makes. It is intentionally
// excluded from page-cache invalidation in worker.js: a history write must not
// force every cached page to re-render on the Workers Free plan.
export async function POST(request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(searchEventSchema, body);
    if (!valid) return error;
    const repo = await getRepo();
    const event = await repo.recordSearchEvent({
      query: data.query,
      mode: data.mode,
      resultCount: data.resultCount,
    });
    return ok({ event });
  } catch (err) {
    return handleRouteError(err, 'POST /api/search/event');
  }
}
