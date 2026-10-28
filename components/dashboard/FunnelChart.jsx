'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';

const STAGE_COLORS = ['#94a3b8', '#60b4fa', '#3b96f6', '#1d61d8', '#0d9488', '#15803d'];

export default function FunnelChart({ byStage }) {
  const data = Object.entries(byStage ?? {}).map(([stage, count]) => ({ stage, count }));
  if (!data.length) return null;
  return (
    <div className="h-64 w-full" role="img" aria-label="Application funnel chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="stage"
            width={86}
            tick={{ fontSize: 12, fill: '#334155', textTransform: 'capitalize' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13 }}
            formatter={(value) => [value, 'Candidates']}
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
            {data.map((entry, i) => (
              <Cell key={entry.stage} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
