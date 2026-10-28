import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { submissionCreateSchema } from '@/lib/validation';
import { runStaticChecks } from '@/lib/assessments/static-checks';

export const dynamic = 'force-dynamic';

// POST /api/assessments/:id/submissions
//
// SECURITY: this build never executes candidate-submitted code. Submissions
// get deterministic static checks (regex/AST-free heuristics) and are queued
// for human review. A real deployment must route execution through an
// isolated sandbox service (see README — "Assessment execution").
export async function POST(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const assessment = await repo.getAssessment(id);
    if (!assessment) return fail(404, 'Assessment not found');
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(submissionCreateSchema, body);
    if (!valid) return error;
    const candidate = await repo.getCandidate(data.candidateId);
    if (!candidate) return fail(422, 'Unknown candidateId');

    const staticChecks = data.code
      ? runStaticChecks(data.code, assessment)
      : { passed: [], warnings: ['No code submitted'] };

    const submission = await repo.createSubmission({
      assessmentId: id,
      candidateId: data.candidateId,
      status: 'manual_review',
      executionMode: 'static_checks',
      result: {
        staticChecks,
        testCaseResults: [],
        reviewerNote: null,
        code: data.code ?? null,
        executionNotice:
          'Static checks only — this environment does not execute candidate code. Queued for human review.',
      },
    });
    await repo.logAudit({
      action: 'assessment.submit',
      entityType: 'assessment',
      entityId: id,
      metadata: { submissionId: submission.id, candidateId: data.candidateId },
    });
    return ok(submission, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/assessments/:id/submissions');
  }
}
