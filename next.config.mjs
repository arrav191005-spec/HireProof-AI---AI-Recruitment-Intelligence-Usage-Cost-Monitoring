/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg uses dynamic requires that must stay external to the server bundle
  serverExternalPackages: ['pg'],
};

export default nextConfig;
