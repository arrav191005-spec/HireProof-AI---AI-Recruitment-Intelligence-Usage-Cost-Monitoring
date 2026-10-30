// Full-page link for app navigation.
//
// Why not next/link: RSC navigations are keyed by the source page's
// `next-router-state-tree`, so their cache entries cannot be shared or
// pre-warmed reliably — and on Workers Free every cache miss is an 80–800 ms
// render that drains the isolate's CPU bank. A document navigation has a
// stable URL, so the edge response cache (worker.js + middleware.js) serves it
// in 3–9 ms. The browser keeps the old page visible until the new HTML is
// ready, so the UX is a normal page load rather than a blank flash.
//
// `prefetch`/`replace`/`scroll` are Link-only props and are intentionally not
// forwarded to the anchor.
export default function NoPrefetchLink({ href, children, replace, scroll, prefetch, ...rest }) {
  const url = typeof href === 'string' ? href : href?.toString?.() ?? '#';
  return (
    <a href={url} {...rest}>
      {children}
    </a>
  );
}
