import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui/Feedback';
import Badge from '@/components/ui/Badge';
import AssessmentDetailTabs from '@/components/assessments/AssessmentDetailTabs';

export const dynamic = 'force-dynamic';

const difficultyTone = { easy: 'green', medium: 'amber', hard: 'navy' };

export default async function AssessmentDetailPage({ params }) {
  const { id } = await params;
  const repo = await getRepo();
  const assessment = await repo.getAssessment(id);
  if (!assessment) notFound();

  const { items: candidates } = await repo.listCandidates({ pageSize: 50, sort: 'name' });

  return (
    <>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Skill Assessments', href: '/assessments' }, { label: assessment.title }]} />}
        title={assessment.title}
        description={`${assessment.skill} · ${assessment.timeLimitMinutes} minutes`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={difficultyTone[assessment.difficulty] ?? 'gray'}>{assessment.difficulty}</Badge>
            <Badge tone={assessment.status === 'published' ? 'green' : 'gray'} dot>{assessment.status}</Badge>
            <Badge tone="slate">{assessment.executionMode === 'static_checks' ? 'static checks only' : assessment.executionMode}</Badge>
          </div>
        }
      />
      <AssessmentDetailTabs
        assessment={assessment}
        candidates={candidates.map((c) => ({ id: c.id, fullName: c.fullName, headline: c.headline }))}
      />
    </>
  );
}
