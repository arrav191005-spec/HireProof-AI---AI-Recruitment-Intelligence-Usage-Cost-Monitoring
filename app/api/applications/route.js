import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { applicationCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// POST /api/applications — place a candidate into a job's pipeline.
// Creating an application never implies a hiring decision; stage changes are
// manual and audited (see PATCH /api/applications/:id).
export async function POST(request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(applicationCreateSchema, body);
    if (!valid) return error;
    const repo = await getRepo();

    const candidate = await repo.getCandidate(data.candidateId);
    if (!candidate) return fail(404, 'Candidate not found');
    const job = await repo.getJob(data.jobId);
    if (!job) return fail(404, 'Job not found');

    const existing = (await repo.getJobApplications(data.jobId)).find((a) => a.candidateId === data.candidateId);
    if (existing) return ok(existing, { created: false, message: 'Already in this pipeline' });

    const application = await repo.createApplication({
      candidateId: data.candidateId,
      jobId: data.jobId,
      stage: data.stage,
    });
    await repo.logAudit({
      action: 'application.create',
      entityType: 'application',
      entityId: application.id,
      metadata: { candidateId: data.candidateId, jobId: data.jobId, by: user.name },
    });
    return ok(application, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/applications');
  }
}
