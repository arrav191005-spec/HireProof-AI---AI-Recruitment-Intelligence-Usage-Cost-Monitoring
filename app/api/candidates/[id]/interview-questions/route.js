import getRepo from '@/lib/repo';
import { ok, fail, requireUser, validate, handleRouteError } from '@/lib/api';
import { interviewQuestionsSchema } from '@/lib/validation';
import { generateInterviewQuestions } from '@/lib/ai-client';
import { skillMatchesRequirement } from '@/lib/search/engine';

export const dynamic = 'force-dynamic';

// POST /api/candidates/:id/interview-questions — generates questions for ONE
// requirement of a job, grounded only in evidence excerpts located on this
// candidate's record. If no evidence exists, the response says so explicitly
// instead of inventing experience.
export async function POST(request, { params }) {
  try {
    await requireUser();
    const { id } = await params;
    const repo = await getRepo();
    const body = await request.json().catch(() => null);
    const { ok: valid, data, error } = await validate(interviewQuestionsSchema, body);
    if (!valid) return error;

    const candidate = await repo.getCandidate(id);
    if (!candidate) return fail(404, 'Candidate not found');
    const job = await repo.getJob(data.jobId);
    if (!job) return fail(404, 'Job not found');

    const requirements = await repo.getJobRequirements(data.jobId);
    const requirement = requirements?.find((r) => skillMatchesRequirement(r.skill, data.skill));
    if (!requirement) return fail(422, 'That skill is not a requirement of this job');

    const evidence = (await repo.getCandidateEvidence(id)).filter((ev) =>
      skillMatchesRequirement(ev.skill, requirement.skill)
    );
    const excerpts = evidence.map((ev) => ev.excerpt).filter(Boolean).slice(0, 5);

    const generated = await generateInterviewQuestions({
      requirement,
      evidenceExcerpts: excerpts,
      count: data.count,
    });

    await repo.logAudit({
      action: 'interview_questions.generate',
      entityType: 'candidate',
      entityId: id,
      metadata: { jobId: data.jobId, skill: requirement.skill, mode: generated.mode, evidenceUsed: excerpts.length },
    });

    return ok({
      ...generated,
      requirement: { skill: requirement.skill, category: requirement.category },
      evidenceUsed: excerpts.length,
      evidenceIds: evidence.map((ev) => ev.id),
    });
  } catch (err) {
    return handleRouteError(err, 'POST /api/candidates/:id/interview-questions');
  }
}
