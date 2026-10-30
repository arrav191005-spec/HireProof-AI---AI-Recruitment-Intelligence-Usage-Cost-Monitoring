// Link wrapper with prefetching disabled.
//
// Why: on Cloudflare Workers Free (10 ms CPU/request) every prefetch is a full
// worker invocation that runs the target page's data queries. Loading the
// dashboard used to fire RSC prefetches for the whole sidebar (/jobs,
// /candidates, /assessments, …) — ~1.4 s of CPU in one burst — which heated
// the isolate until the next navigation was killed with Error 1102. Prefetching
// pages the user has not asked for is exactly the kind of eager loading this
// app avoids. Client-side navigation still works normally: clicking fetches the
// RSC payload once, and `experimental.staleTimes.dynamic` keeps it cached for
// 15 s afterwards.
import Link from 'next/link';

export default function NoPrefetchLink(props) {
  // Callers may still opt in explicitly by passing prefetch={true}.
  return <Link prefetch={false} {...props} />;
}
