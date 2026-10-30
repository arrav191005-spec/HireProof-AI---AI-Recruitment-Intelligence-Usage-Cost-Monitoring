/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg uses dynamic requires that must stay external to the server bundle
  serverExternalPackages: ['pg'],
  experimental: {
    // Client-side router cache: back-navigation and revisits within 15 s reuse
    // the already-fetched RSC payload instead of invoking the Worker again —
    // on the free plan every avoided request is 10 ms of CPU not spent.
    // Safe here because all 12 mutation sites call router.refresh() and
    // sign-out performs a hard navigation (window.location), which drops the
    // entire client cache — cached entries cannot outlive a change or a
    // session. Bounded at 15 s regardless.
    staleTimes: { dynamic: 15, static: 180 },
  },
};

export default nextConfig;

// Registers the Wrangler platform proxy so `next dev` can see Cloudflare
// bindings. No-op outside of Wrangler-managed environments.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
