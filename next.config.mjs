/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg uses dynamic requires that must stay external to the server bundle
  serverExternalPackages: ['pg'],
};

export default nextConfig;

// Registers the Wrangler platform proxy so `next dev` can see Cloudflare
// bindings. No-op outside of Wrangler-managed environments.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
