'use client';

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const COLORS = { applications: '#2578eb', searches: '#0d9488', uploads: '#8b5cf6' };

export default function ActivityTrendChart({ data }) {
  if (!data?.length) return null;
  return (
    <div className="h-64 w-full" role="img" aria-label="Weekly recruitment activity chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            {Object.entries(COLORS).map(([key, color]) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, boxShadow: '0 4px 12px rgba(15,33,55,0.08)' }}
            labelFormatter={(l) => `Week of ${l}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="applications" stroke={COLORS.applications} fill="url(#grad-applications)" strokeWidth={2} />
          <Area type="monotone" dataKey="searches" stroke={COLORS.searches} fill="url(#grad-searches)" strokeWidth={2} />
          <Area type="monotone" dataKey="uploads" stroke={COLORS.uploads} fill="url(#grad-uploads)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
