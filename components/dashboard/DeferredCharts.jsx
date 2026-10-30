'use client';
//
// Recharts trees are client-interactive but were previously server-rendered —
// on the Workers free plan (10 ms CPU/request) their SSR + RSC payload was the
// single biggest CPU cost on the dashboard. Loading them client-side moves
// that work into the browser; the chunk itself is served from static assets
// (immutable cache), not from worker CPU. The skeleton keeps the exact chart
// height so nothing shifts when the chart mounts.
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

export const LazyActivityTrendChart = dynamic(() => import('./ActivityTrendChart'), {
  ssr: false,
  loading: () => skeleton('Loading activity chart'),
});

export const LazyFunnelChart = dynamic(() => import('./FunnelChart'), {
  ssr: false,
  loading: () => skeleton('Loading funnel chart'),
});
