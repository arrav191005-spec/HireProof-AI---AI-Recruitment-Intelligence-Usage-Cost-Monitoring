import getRepo from '@/lib/repo';
import PageHeader from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { JobStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Feedback';
import { Plus, Briefcase, Search, MapPin } from 'lucide-react';
import Link from 'next/link';
import JobsSearchBox from '@/components/jobs/JobsSearchBox';

export const dynamic = 'force-dynamic';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
];

export default async function JobsPage({ searchParams }) {
  const params = await searchParams;
  const status = params.status ?? 'all';
  const q = params.q ?? '';
  const repo = await getRepo();
  const { items, total } = await repo.listJobs({ status, q, pageSize: 50 });

  const appCounts = {};
  for (const job of items) {
    const apps = await repo.getJobApplications(job.id);
    appCounts[job.id] = apps.length;
  }

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Manage openings, requirements and pipelines."
        breadcrumbs={undefined}
        actions={
          <Button href="/jobs/new">
            <Plus size={15} /> Create job
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Filter jobs by status">
            {STATUS_TABS.map((tab) => {
              const active = status === tab.value;
              const href = `/jobs?status=${tab.value}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
              return (
                <Link
                  key={tab.value}
                  href={href}
                  role="tab"
                  aria-selected={active}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <JobsSearchBox initialQ={q} status={status} />
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title={q ? `No jobs match “${q}”` : 'No jobs here yet'}
            description={q ? 'Try a different search term.' : 'Create your first job opening to start collecting candidates.'}
            action={<Button href="/jobs/new" size="sm"><Plus size={14} /> Create job</Button>}
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="px-5 py-3 font-medium">Job</th>
                  <th scope="col" className="px-4 py-3 font-medium">Department</th>
                  <th scope="col" className="px-4 py-3 font-medium">Location</th>
                  <th scope="col" className="px-4 py-3 font-medium">Requirements</th>
                  <th scope="col" className="px-4 py-3 font-medium">Candidates</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((job) => (
                  <tr key={job.id} className="group transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-3.5">
                      <Link href={`/jobs/${job.id}`} className="font-medium text-slate-900 group-hover:text-brand-700 group-hover:underline underline-offset-2">
                        {job.title}
                      </Link>
                      <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-slate-400">{job.description}</p>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{job.department}</td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <span className="inline-flex items-center gap-1"><MapPin size={13} className="text-slate-400" /> {job.location}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      {job.requiredSkills.length} required{job.preferredSkills.length > 0 ? ` · ${job.preferredSkills.length} preferred` : ''}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{appCounts[job.id] ?? 0}</td>
                    <td className="px-4 py-3.5 text-right"><JobStatusBadge status={job.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 px-1 text-xs text-slate-400">{total} job{total === 1 ? '' : 's'} · synthetic demo data</p>
    </>
  );
}
