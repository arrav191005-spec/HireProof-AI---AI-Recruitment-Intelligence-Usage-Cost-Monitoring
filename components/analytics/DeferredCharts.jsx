'use client';
//
// Client-only load for the analytics charts — same reasoning as
// components/dashboard/DeferredCharts.jsx: keep Recharts out of the server
// render so the Workers CPU budget goes to data, not chart markup.
import dynamic from 'next/dynamic';

function skeleton(label) {
  return (
    <div
      className="h-64 w-full animate-pulse rounded-xl bg-slate-100"
      role="img"
      aria-label={label}
    />
  );
}

export const LazyEvidenceStatusChart = dynamic(() => import('./EvidenceStatusChart'), {
  ssr: false,
  loading: () => skeleton('Loading evidence status chart'),
});
