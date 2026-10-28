import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { jobUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const job = await repo.getJob(id);
    if (!job) return fail(404, 'Job not found');
    const requirements = await repo.getJobRequirements(id);
    const applications = await repo.getJobApplications(id);
    return ok({ ...job, requirements, applications });
  } catch (err) {
    return handleRouteError(err, 'GET /api/jobs/:id');
  }
}

export async function PATCH(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const existing = await repo.getJob(id);
    if (!existing) return fail(404, 'Job not found');
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(jobUpdateSchema, body);
    if (!valid) return error;
    const job = await repo.updateJob(id, data);
    await repo.logAudit({ action: 'job.update', entityType: 'job', entityId: id, metadata: { fields: Object.keys(data) } });
    return ok(job);
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/jobs/:id');
  }
}
