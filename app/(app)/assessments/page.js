import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState, InlineAlert } from '@/components/ui/Feedback';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { ClipboardCheck, Clock, Users, FileCode2 } from 'lucide-react';
import Link from 'next/link';
import AssessmentForm from '@/components/assessments/AssessmentForm';

export const dynamic = 'force-dynamic';

const difficultyTone = { easy: 'green', medium: 'amber', hard: 'navy' };

export default async function AssessmentsPage() {
  const repo = await getRepo();
  const assessments = await repo.listAssessments();

  return (
    <>
      <PageHeader
        title="Skill Assessments"
        description="Practical tasks with recorded results and reviewable evidence. Candidate code is never executed in this build."
        actions={<AssessmentForm />}
      />

      <InlineAlert tone="info" title="Execution policy">
        Submissions are analyzed with deterministic static checks and queued for human review. A
        production deployment would route execution to an isolated sandbox (see README — Assessment
        execution).
      </InlineAlert>

      <div className="mt-5">
        {assessments.length === 0 ? (
          <Card>
            <EmptyState
              icon={ClipboardCheck}
              title="No assessments yet"
              description="Create a task — or start from the JavaScript coding challenge template."
              action={<AssessmentForm triggerLabel="Create assessment" />}
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {assessments.map((a) => (
              <Card key={a.id} className="flex flex-col p-5 transition-shadow hover:shadow-(--shadow-pop)">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/assessments/${a.id}`}
                      className="text-[15px] font-semibold text-slate-900 hover:text-brand-700 hover:underline underline-offset-2"
                    >
                      {a.title}
                    </Link>
                    <p className="mt-0.5 text-[13px] text-slate-500">{a.description?.slice(0, 90)}{a.description?.length > 90 ? '…' : ''}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                    {a.skill}
                  </span>
                  <Badge tone={difficultyTone[a.difficulty] ?? 'gray'}>{a.difficulty}</Badge>
                  <Badge tone={a.status === 'published' ? 'green' : 'gray'} dot>{a.status}</Badge>
                  {a.executionMode && <Badge tone="slate">{a.executionMode.replace('_', ' ')}</Badge>}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={13} aria-hidden="true" /> {a.timeLimitMinutes} min
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={13} aria-hidden="true" /> {a.submissionCount} submission{a.submissionCount === 1 ? '' : 's'}
                  </span>
                  <Link href={`/assessments/${a.id}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                    Open <FileCode2 size={13} aria-hidden="true" />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 px-1 text-xs text-slate-400">
        {assessments.length} assessment{assessments.length === 1 ? '' : 's'} · seeded results are marked as demo data on each submission.
      </p>
    </>
  );
}
