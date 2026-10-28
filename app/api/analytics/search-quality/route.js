import { ok, requireUser, handleRouteError } from '@/lib/api';
import { runSearchEvaluation } from '@/lib/search/evaluation';
import { semanticAvailable } from '@/lib/search/semantic';

export const dynamic = 'force-dynamic';

let lastRun = null;

// GET — return the most recent evaluation run, or `null` (UI shows setup state).
export async function GET() {
  try {
    await requireUser();
    return ok({
      lastRun,
      semanticEnabled: await semanticAvailable(),
      datasetInfo: {
        location: 'tests/search-eval.json',
        note: 'Judged against the synthetic demo corpus. Run the evaluation to compute metrics.',
      },
    });
  } catch (err) {
    return handleRouteError(err, 'GET /api/analytics/search-quality');
  }
}

// POST — actually run the evaluation now.
export async function POST() {
  try {
    await requireUser();
    lastRun = await runSearchEvaluation(5);
    return ok(lastRun);
  } catch (err) {
    return handleRouteError(err, 'POST /api/analytics/search-quality');
  }
}
