import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { applicationStageSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// PATCH /api/applications/:id — move a candidate through the pipeline.
export async function PATCH(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(applicationStageSchema, body);
    if (!valid) return error;
    const app = await repo.updateApplicationStage(id, data.stage);
    if (!app) return fail(404, 'Application not found');
    await repo.logAudit({ action: 'application.stage', entityType: 'application', entityId: id, metadata: { stage: data.stage } });
    return ok(app);
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/applications/:id');
  }
}
