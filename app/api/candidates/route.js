import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { candidateCreateSchema } from '@/lib/validation';
import { readUploadMeta, writeUploadMeta } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireUser();
    const repo = await getRepo();
    const { searchParams } = new URL(request.url);
    const result = await repo.listCandidates({
      q: searchParams.get('q') ?? '',
      skill: searchParams.get('skill') ?? '',
      minYears: searchParams.get('minYears') ?? '',
      maxYears: searchParams.get('maxYears') ?? '',
      evidenceStatus: searchParams.get('evidenceStatus') ?? '',
      sort: searchParams.get('sort') ?? 'recent',
      page: Number(searchParams.get('page') ?? 1),
      pageSize: Math.min(50, Number(searchParams.get('pageSize') ?? 10)),
    });
    return ok(result);
  } catch (err) {
    return handleRouteError(err, 'GET /api/candidates');
  }
}

// Evidence status decision for extracted resume evidence: an excerpt we could
// actually locate in the document (page found) is "supporting" — a source
// detail was located. A mention we cannot anchor in the document stays
// "claimed". This matches how seeded resume evidence is labelled. Statuses the
// extractor set deliberately (e.g. needs_review) are preserved.
function evidenceStatusFor(extractionEv, location) {
  if (extractionEv.status && extractionEv.status !== 'claimed') return extractionEv.status;
  return location?.page != null ? 'supporting' : 'claimed';
}

/**
 * POST /api/candidates — commit a reviewed resume extraction.
 * The extraction itself lives server-side (written by POST /api/resumes);
 * this payload only carries what the reviewer confirmed or edited, and the
 * upload reference is single-use so one resume cannot be committed twice.
 */
export async function POST(request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(candidateCreateSchema, body);
    if (!valid) return error;

    const meta = await readUploadMeta(data.uploadId);
    if (!meta) return fail(404, 'That upload session is no longer available. Upload the resume again.');
    if (meta.consumedAt) return fail(409, 'This resume has already been reviewed and saved.');

    const ex = meta.extraction ?? {};
    const drop = new Set((data.dropSkills ?? []).map((s) => s.trim().toLowerCase()));

    const skills = (ex.skills ?? [])
      .filter((s) => !drop.has(String(s.skill).toLowerCase()))
      .map((s) => ({ skill: s.skill, years: s.years ?? null, level: s.level ?? null, source: 'resume' }));

    const evidence = (ex.evidence ?? [])
      .filter((e) => !drop.has(String(e.skill).toLowerCase()))
      .map((e) => {
        const location =
          e.page != null || e.section ? { page: e.page ?? null, section: e.section ?? null } : null;
        return {
          skill: e.skill,
          sourceType: 'resume',
          sourceId: meta.uploadId,
          sourceName: meta.filename,
          excerpt: e.excerpt,
          location,
          status: evidenceStatusFor(e, location),
          extractor: ex.via ?? 'unknown',
          notes: null,
        };
      });

    const payload = {
      fullName: data.fullName,
      headline: data.headline ?? ex.headline ?? 'Candidate (headline not found in resume)',
      email: data.email ?? null,
      location: data.location ?? null,
      yearsExperience: data.yearsExperience ?? null,
      currentCompany: data.currentCompany ?? firstCompany(ex),
      summary: data.summary ?? ex.summary ?? '',
      source: 'Resume upload',
      links: {},
      skills,
      experience: ex.experience ?? [],
      education: ex.education ?? [],
      // A skill the reviewer excluded must not reappear in project tech chips.
      projects: (ex.projects ?? []).map((p) => ({
        ...p,
        tech: Array.isArray(p.tech) ? p.tech.filter((t) => !drop.has(String(t).toLowerCase())) : p.tech,
      })),
      evidence,
      resume: {
        filename: meta.filename,
        mimeType: meta.mimeType,
        fileSize: meta.fileSize,
        pageCount: meta.pageCount,
        storagePath: meta.storagePath,
        uploadedAt: meta.uploadedAt,
        status: 'processed',
        sections: [],
      },
    };

    const repo = await getRepo();
    const candidate = await repo.createCandidateFromExtraction(payload);

    // Single-use: mark the review as consumed so double submits cannot create
    // duplicate profiles from the same upload.
    meta.consumedAt = new Date().toISOString();
    meta.candidateId = candidate.id;
    await writeUploadMeta(data.uploadId, meta);

    await repo.logAudit({
      action: 'candidate.create',
      entityType: 'candidate',
      entityId: candidate.id,
      metadata: {
        uploadId: meta.uploadId,
        filename: meta.filename,
        extractionMode: ex.via ?? null,
        skills: skills.length,
        evidence: evidence.length,
        reviewedBy: user.name,
      },
    });

    return ok(candidate, { created: true });
  } catch (err) {
    return handleRouteError(err, 'POST /api/candidates');
  }
}

function firstCompany(ex) {
  const company = ex.experience?.find((e) => e.company)?.company ?? null;
  return company || null;
}
