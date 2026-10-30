import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/Feedback';
import { Briefcase, Users, GitPullRequestArrow, Clock, Activity, BarChart3 } from 'lucide-react';
import Link from '@/components/ui/NoPrefetchLink';
import { LazyActivityTrendChart, LazyFunnelChart } from '@/components/dashboard/DeferredCharts';
import { LazyEvidenceStatusChart } from '@/components/analytics/DeferredCharts';
import SearchQualityPanel from '@/components/analytics/SearchQualityPanel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Analytics' };

function Kpi({ icon: Icon, label, value, sub, href }) {
  const body = (
    <CardBody className="flex items-start gap-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>}
      </div>
    </CardBody>
  );
  return (
    <Card className="h-full transition-shadow hover:shadow-(--shadow-pop)">
      {href ? <Link href={href} className="block h-full">{body}</Link> : body}
    </Card>
  );
}

export default async function AnalyticsPage() {
  const repo = await getRepo();
  const s = await repo.analyticsSummary();

  const stageTotal = Object.values(s.byStage).reduce((a, b) => a + b, 0);
  const established =
    (s.evidenceByStatus.supporting ?? 0) + (s.evidenceByStatus.assessment ?? 0);
  const awaiting = (s.evidenceByStatus.needs_review ?? 0) + (s.evidenceByStatus.claimed ?? 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Operational metrics from the live data — every chart counts actual records, nothing is modelled or estimated."
        actions={
          <Button href="/search" variant="secondary" size="md">
            <BarChart3 size={15} /> Evaluate search
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Briefcase} label="Open jobs" value={s.openJobs} sub={`${s.totalJobs} jobs total`} href="/jobs" />
        <Kpi icon={Users} label="Candidates" value={s.totalCandidates} sub="Profiles in the pool" href="/candidates" />
        <Kpi
          icon={GitPullRequestArrow}
          label="Applications"
          value={s.totalApplications}
          sub={`${stageTotal} across all stages`}
        />
        <Kpi
          icon={Clock}
          label="Awaiting review"
          value={s.pendingReviews}
          sub="Evidence + assessment decisions"
          href="/candidates?evidenceStatus=needs_review"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Activity trend"
            subtitle="Applications, searches and uploads over the last 6 weeks (Monday-anchored)"
          />
          <CardBody>
            <LazyActivityTrendChart data={s.weeks} />
            <p className="mt-2 text-xs text-slate-400">
              {s.searchesLast30d} search{s.searchesLast30d === 1 ? '' : 'es'} recorded in total.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Application funnel"
            subtitle="Current stage distribution — stages move only by human decision"
            actions={
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                {stageTotal} total
              </span>
            }
          />
          <CardBody>
            <LazyFunnelChart byStage={s.byStage} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Evidence by status"
            subtitle="How the candidate pool is actually substantiated"
            actions={
              <span className="rounded-lg bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700">
                {established} located in a source
              </span>
            }
          />
          <CardBody>
            <LazyEvidenceStatusChart evidenceByStatus={s.evidenceByStatus} />
            {awaiting > 0 && (
              <div className="mt-3">
                <InlineAlert tone="warning" title={`${awaiting} record${awaiting === 1 ? '' : 's'} need human judgment`}>
                  Claims and ambiguous records are never counted as verified skill. Review them from the{' '}
                  <Link href="/candidates?evidenceStatus=needs_review" className="font-medium underline underline-offset-2">
                    review queue
                  </Link>
                  .
                </InlineAlert>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Data honesty" subtitle="What these metrics are — and are not" />
          <CardBody className="space-y-2.5 text-[13px] leading-relaxed text-slate-600">
            <p>
              <strong className="text-slate-800">Counts are exact.</strong> Every number on this page is a direct
              count of stored records — no projections, no modelled figures, no synthetic growth curves.
            </p>
            <p>
              <strong className="text-slate-800">No auto-reject signals.</strong> Stage distributions reflect
              recruiter actions only. Missing evidence never reduces a candidate&apos;s standing and is shown as
              “not established”.
            </p>
            <p>
              <strong className="text-slate-800">Search is evaluated, not asserted.</strong> The evaluation below
              runs the judged query set through the live engine and reports whatever it actually scores.
            </p>
            <p className="text-xs text-slate-400">
              Demo datasets and live uploads are stored together in this development build; a production
              deployment would partition environments (see README — Known limitations).
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <SearchQualityPanel />
      </div>
    </>
  );
}
