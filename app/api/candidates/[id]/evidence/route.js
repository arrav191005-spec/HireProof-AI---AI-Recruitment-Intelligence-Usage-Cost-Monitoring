import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { evidenceCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// POST /api/candidates/:id/evidence — recruiter-added evidence with a source
// excerpt. Saved as source type "manual", extractor "human" so it is always
// distinguishable from extracted resume evidence.
export async function POST(request, { params }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const candidate = await repo.getCandidate(id);
    if (!candidate) return fail(404, 'Candidate not found');
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(evidenceCreateSchema, body);
    if (!valid) return error;

    const evidence = await repo.addEvidence({
      candidateId: id,
      skill: data.skill.trim(),
      excerpt: data.excerpt.trim(),
      sourceType: 'manual',
      sourceName: `Recruiter note (${user.name})`,
      status: 'supporting',
      extractor: 'human',
      notes: data.notes?.trim() || null,
    });
    await repo.logAudit({
      action: 'evidence.create',
      entityType: 'candidate',
      entityId: id,
      metadata: { evidenceId: evidence.id, skill: evidence.skill, reviewer: user.name },
    });
    return ok(evidence, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/candidates/:id/evidence');
  }
}
