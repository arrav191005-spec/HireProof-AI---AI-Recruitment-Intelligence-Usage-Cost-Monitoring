import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { candidateUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const candidate = await repo.getCandidate(id);
    if (!candidate) return fail(404, 'Candidate not found');
    const [evidence, submissions, applications] = await Promise.all([
      repo.getCandidateEvidence(id),
      repo.getCandidateSubmissions(id),
      repo.getCandidateApplications(id),
    ]);
    return ok({ ...candidate, evidence, submissions, applications });
  } catch (err) {
    return handleRouteError(err, 'GET /api/candidates/:id');
  }
}

export async function PATCH(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const existing = await repo.getCandidate(id);
    if (!existing) return fail(404, 'Candidate not found');
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(candidateUpdateSchema, body);
    if (!valid) return error;
    const candidate = await repo.updateCandidate(id, data);
    await repo.logAudit({ action: 'candidate.update', entityType: 'candidate', entityId: id, metadata: { fields: Object.keys(data) } });
    return ok(candidate);
  } catch (err) {
    return handleRouteError(err, 'PATCH /api/candidates/:id');
  }
}
