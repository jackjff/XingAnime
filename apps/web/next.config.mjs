/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiBaseUrl = (process.env.INTERNAL_API_BASE_URL ?? 'http://api:4000').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${apiBaseUrl}/api/:path*` }];
  }
};

export default nextConfig;