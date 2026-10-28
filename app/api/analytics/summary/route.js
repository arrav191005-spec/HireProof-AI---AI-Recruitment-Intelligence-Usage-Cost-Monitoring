import getRepo from '@/lib/repo';
import { ok, requireUser, handleRouteError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const repo = await getRepo();
    const summary = await repo.analyticsSummary();
    return ok(summary);
  } catch (err) {
    return handleRouteError(err, 'GET /api/analytics/summary');
  }
}
