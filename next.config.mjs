/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg uses dynamic requires that must stay external to the server bundle
  serverExternalPackages: ['pg'],
  experimental: {
    // The client router cache only covers the remaining RSC transitions (the
    // login/signup handoff and post-mutation router.push/router.refresh calls).
    // App navigation is a full document load served by the edge response cache,
    // so this is a small safety detail rather than the main caching layer.
    // Mutations call router.refresh(), and sign-out performs a hard navigation,
    // so entries cannot outlive a change or a session; bounded at 15 s anyway.
    staleTimes: { dynamic: 15, static: 180 },
  },
};

export default nextConfig;

// Registers the Wrangler platform proxy so `next dev` can see Cloudflare
// bindings. No-op outside of Wrangler-managed environments.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
