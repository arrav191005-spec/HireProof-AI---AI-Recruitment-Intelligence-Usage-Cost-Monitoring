import getRepo, { getBackendInfo } from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { JobStatusBadge, EvidenceBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Feedback';
import Button from '@/components/ui/Button';
import {
  Briefcase, Users, ClipboardCheck, AlertTriangle, ArrowRight, Search,
  FileText, Activity, Plus,
} from 'lucide-react';
import Link from 'next/link';
import ActivityTrendChart from '@/components/dashboard/ActivityTrendChart';
import FunnelChart from '@/components/dashboard/FunnelChart';
import DemoModeBanner from '@/components/dashboard/DemoModeBanner';

export const dynamic = 'force-dynamic';

function KpiCard({ href, icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
    navy: 'bg-navy-50 text-navy-800',
  };
  return (
    <Link href={href} className="group block">
      <Card className="h-full transition-shadow group-hover:shadow-(--shadow-pop)">
        <CardBody className="flex items-start gap-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-500">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
            {sub && <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>}
          </div>
          <ArrowRight
            size={16}
            className="ml-auto mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-brand-600"
            aria-hidden="true"
          />
        </CardBody>
      </Card>
    </Link>
  );
}

export default async function OverviewPage() {
  const repo = await getRepo();
  const backend = await getBackendInfo();
  const [summary, jobsResult, activity, recentSearches] = await Promise.all([
    repo.analyticsSummary(),
    repo.listJobs({ status: 'open', pageSize: 5 }),
    repo.recentAuditLogs(8),
    repo.recentSearchEvents(5),
  ]);

  const relTime = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  return (
    <>
      <PageHeader
        title="Overview"
        description="Recruitment activity across jobs, candidates, evidence and assessments."
        actions={
          <>
            <Button href="/search" variant="secondary" size="md">
              <Search size={15} /> Search candidates
            </Button>
            <Button href="/jobs/new" size="md">
              <Plus size={15} /> Create job
            </Button>
          </>
        }
      />

      <DemoModeBanner backend={backend} />

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard href="/jobs?status=open" icon={Briefcase} label="Active job openings" value={summary.openJobs} sub={`${summary.totalJobs} total jobs`} />
        <KpiCard href="/candidates" icon={Users} label="Candidate profiles" value={summary.totalCandidates} sub="All sources" tone="teal" />
        <KpiCard href="/assessments" icon={ClipboardCheck} label="Completed assessments" value={summary.completedAssessments} sub={`${summary.searchesLast30d} searches run`} tone="navy" />
        <KpiCard href="/candidates?evidenceStatus=needs_review" icon={AlertTriangle} label="Evidence awaiting review" value={summary.pendingReviews} sub="Claims & ambiguous records" tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recruitment activity" subtitle="Applications, searches and resume uploads per week (demo data)" />
          <CardBody>
            <ActivityTrendChart data={summary.weeks} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pipeline funnel" subtitle={`${summary.totalApplications} applications across all jobs`} />
          <CardBody>
            <FunnelChart byStage={summary.byStage} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Active jobs"
            actions={<Button href="/jobs" variant="ghost" size="sm">All jobs <ArrowRight size={14} /></Button>}
          />
          {jobsResult.items.length === 0 ? (
            <EmptyState icon={Briefcase} title="No open jobs" description="Create a job to start collecting candidates and evidence." action={<Button href="/jobs/new" size="sm">Create job</Button>} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobsResult.items.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{job.department} · {job.location}</p>
                    </div>
                    <JobStatusBadge status={job.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          {activity.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                    {item.action === 'job.create' || item.action === 'job.update' ? <Briefcase size={12} /> :
                      item.action === 'resume.upload' ? <FileText size={12} /> :
                      item.action.startsWith('assessment') ? <ClipboardCheck size={12} /> :
                      item.action.startsWith('evidence') ? <AlertTriangle size={12} /> : <Activity size={12} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-slate-700">
                      <span className="font-medium">{item.action.split('.').pop()}</span>{' '}
                      {item.action.startsWith('evidence') ? (
                        <Link href={`/candidates/${item.entityId}`} className="text-brand-700 hover:underline">candidate record</Link>
                      ) : item.entityType === 'job' ? (
                        <Link href={`/jobs/${item.entityId}`} className="text-brand-700 hover:underline">job</Link>
                      ) : item.entityType === 'assessment' ? (
                        <Link href={`/assessments/${item.entityId}`} className="text-brand-700 hover:underline">assessment</Link>
                      ) : (
                        <span className="text-slate-500">{item.entityId}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{relTime(item.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Evidence status distribution"
            subtitle="How requirement evidence is currently distributed across all candidates"
          />
          <CardBody>
            <div className="flex flex-wrap gap-2.5">
              {Object.entries(summary.evidenceByStatus).map(([status, count]) => (
                <div key={status} className="flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <EvidenceBadge status={status} />
                  <span className="text-lg font-semibold text-slate-800">{count}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              “Not established” is informational only — missing evidence never reduces a candidate’s ranking or standing.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent searches" actions={<Button href="/search" variant="ghost" size="sm">Open search <ArrowRight size={14} /></Button>} />
          {recentSearches.length === 0 ? (
            <EmptyState icon={Search} title="No searches yet" description="Try the natural-language candidate search." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentSearches.map((se) => (
                <li key={se.id} className="px-5 py-3">
                  <Link href={`/search?q=${encodeURIComponent(se.query)}`} className="line-clamp-2 text-[13px] text-slate-700 hover:text-brand-700 hover:underline">
                    “{se.query}”
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-400">{se.resultCount} results · {se.mode}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
