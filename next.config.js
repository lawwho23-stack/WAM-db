/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Turbopack rooted here. Without this, Next walks up and finds lockfiles
  // outside the project, which breaks module resolution warnings.
  turbopack: { root: __dirname },
};

module.exports = nextConfig;
