import getRepo from '@/lib/repo';
import { ok, requireUser, validate, handleRouteError } from '@/lib/api';
import { assessmentCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const repo = await getRepo();
    const assessments = await repo.listAssessments();
    return ok({ items: assessments });
  } catch (err) {
    return handleRouteError(err, 'GET /api/assessments');
  }
}

export async function POST(request) {
  try {
    await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(assessmentCreateSchema, body);
    if (!valid) return error;
    const repo = await getRepo();
    const assessment = await repo.createAssessment({ ...data, executionMode: 'manual_review' });
    await repo.logAudit({
      action: 'assessment.create',
      entityType: 'assessment',
      entityId: assessment.id,
      metadata: { title: assessment.title },
    });
    return ok(assessment, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/assessments');
  }
}
