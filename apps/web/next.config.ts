import path from 'node:path';
import type { NextConfig } from 'next';

// Monorepo root (`next build` runs from apps/web). Standalone output traces dependencies from here.
const root = path.resolve(process.cwd(), '../..');

// Sent with every page in production. 'unsafe-inline' scripts are needed for Next's inline bootstrap.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone — what the Docker image runs. Only in the image build
  // (NEXT_OUTPUT_STANDALONE=1): copying the symlinked node_modules fails on Windows without Developer Mode.
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: root,
  turbopack: { root },
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@dash/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
