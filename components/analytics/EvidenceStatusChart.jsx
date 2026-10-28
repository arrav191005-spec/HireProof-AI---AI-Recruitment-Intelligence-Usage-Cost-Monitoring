'use client';

import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { evidenceStatusMeta } from '@/components/ui/Badge';

const ORDER = ['claimed', 'supporting', 'assessment', 'not_established', 'needs_review'];

// Same status colours the rest of the UI uses for these five values.
const STATUS_COLORS = {
  claimed: '#94a3b8',
  supporting: '#0d9488',
  assessment: '#2578eb',
  not_established: '#475569',
  needs_review: '#f59e0b',
};

// Distribution of evidence records by status — the product's core vocabulary,
// shown as honest counts instead of one opaque "match" number.
export default function EvidenceStatusChart({ evidenceByStatus }) {
  const data = ORDER.map((status) => ({
    status: evidenceStatusMeta[status]?.label ?? status,
    short: status === 'not_established' ? 'not est.' : status.replace('_', ' '),
    count: evidenceByStatus?.[status] ?? 0,
    fill: STATUS_COLORS[status],
  }));
  const total = data.reduce((a, b) => a + b.count, 0);

  return (
    <div>
      <div className="h-56 w-full" role="img" aria-label="Evidence records by status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="short"
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.12)' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
              formatter={(value, _name, props) => [value, `${props.payload.status} records`]}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={34}>
              {data.map((d) => (
                <Cell key={d.status} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-2 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.fill }} aria-hidden="true" />
            <span className="font-medium">{d.status}</span>
            <span className="text-slate-400">· {d.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        {total} evidence record{total === 1 ? '' : 's'} — every one links to its source excerpt.
      </p>
    </div>
  );
}
