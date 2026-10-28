import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { evidenceReviewSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// PATCH /api/evidence/:id — recruiter review of an evidence record.
export async function PATCH(request, { params }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(evidenceReviewSchema, body);
    if (!valid) return error;
    const updated = await repo.updateEvidence(id, { status: data.status, notes: data.notes, reviewedBy: user.name });
    if (!updated) return fail(404, 'Evidence not found');
    await repo.logAudit({
      action: 'evidence.review',
      entityType: 'candidate',
      entityId: updated.candidateId,
      metadata: { evidenceId: id, decision: data.status, reviewer: user.name },
    });
    return ok(updated);
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/evidence/:id');
  }
}
