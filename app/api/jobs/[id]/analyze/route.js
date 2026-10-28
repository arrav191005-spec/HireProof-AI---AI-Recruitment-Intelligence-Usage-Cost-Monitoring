import getRepo from '@/lib/repo';
import { ok, fail, requireUser, handleRouteError } from '@/lib/api';
import { analyzeJobDescription } from '@/lib/ai-client';

export const dynamic = 'force-dynamic';

// POST /api/jobs/:id/analyze — job-description analysis.
// Demo mode: deterministic heuristic analysis, clearly labeled.
// With an LLM key configured: the same shape is produced by the provider
// (see lib/ai-client.js); suggestions are always review-only and never
// auto-apply edits to the job.
export async function POST(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const job = await repo.getJob(id);
    if (!job) return fail(404, 'Job not found');
    const analysis = await analyzeJobDescription(job);
    await repo.logAudit({ action: 'job.analyze', entityType: 'job', entityId: id, metadata: { mode: analysis.mode } });
    return ok(analysis);
  } catch (err) {
    return handleRouteError(err, 'POST /api/jobs/:id/analyze');
  }
}
