import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@dash/shared'],
  reactStrictMode: true,
};

export default nextConfig;
