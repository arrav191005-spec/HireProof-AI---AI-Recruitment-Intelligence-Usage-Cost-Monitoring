import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { submissionReviewSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// PATCH /api/assessments/:id/submissions/:subId — recruiter review of a
// submission: decision status, optional score, reviewer note. The static-check
// results are immutable history; only the human decision is updated.
export async function PATCH(request, { params }) {
  try {
    const user = await requireUser();
    const { id, subId } = await params;
    const repo = await getRepo();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(submissionReviewSchema, body);
    if (!valid) return error;

    const submissions = await repo.listSubmissions({ assessmentId: id });
    const existing = submissions.find((s) => s.id === subId);
    if (!existing) return fail(404, 'Submission not found');

    const patch = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.score !== undefined) patch.score = data.score;
    if (data.reviewerNote !== undefined) {
      patch.result = { ...(existing.result ?? {}), reviewerNote: data.reviewerNote, reviewedBy: user.name };
    }

    const updated = await repo.updateSubmission(subId, patch);
    await repo.logAudit({
      action: 'assessment.review',
      entityType: 'assessment',
      entityId: id,
      metadata: { submissionId: subId, status: data.status ?? existing.status, reviewer: user.name },
    });
    return ok(updated);
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/assessments/:id/submissions/:subId');
  }
}
