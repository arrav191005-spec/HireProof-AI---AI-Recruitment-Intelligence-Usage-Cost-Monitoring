// Status badges — the shared visual language for evidence and workflow status.

const badgeStyles = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';

const toneClasses = {
  gray: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  green: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200',
  blue: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  slate: 'bg-white text-slate-500 ring-1 ring-inset ring-slate-300',
  navy: 'bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-100',
};

export const evidenceStatusMeta = {
  claimed: { label: 'Candidate claimed', tone: 'gray' },
  supporting: { label: 'Supporting evidence', tone: 'green' },
  assessment: { label: 'Assessment evidence', tone: 'blue' },
  not_established: { label: 'Not established', tone: 'slate' },
  needs_review: { label: 'Needs review', tone: 'amber' },
};

export const jobStatusMeta = {
  draft: { label: 'Draft', tone: 'gray' },
  open: { label: 'Open', tone: 'green' },
  closed: { label: 'Closed', tone: 'slate' },
};

export const stageMeta = {
  applied: { label: 'Applied', tone: 'gray' },
  screening: { label: 'Screening', tone: 'blue' },
  assessment: { label: 'Assessment', tone: 'navy' },
  interview: { label: 'Interview', tone: 'amber' },
  offer: { label: 'Offer', tone: 'green' },
  hired: { label: 'Hired', tone: 'green' },
  rejected: { label: 'Not moving forward', tone: 'slate' },
};

export default function Badge({ tone = 'gray', className = '', children, dot = false }) {
  return (
    <span className={`${badgeStyles} ${toneClasses[tone] ?? toneClasses.gray} ${className}`}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function EvidenceBadge({ status }) {
  const meta = evidenceStatusMeta[status];
  if (!meta) return <Badge tone="gray">{status}</Badge>;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function JobStatusBadge({ status }) {
  const meta = jobStatusMeta[status] ?? { label: status, tone: 'gray' };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function StageBadge({ stage }) {
  const meta = stageMeta[stage] ?? { label: stage, tone: 'gray' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
