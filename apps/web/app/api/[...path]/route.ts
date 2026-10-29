import type { NextRequest } from 'next/server';

import { proxyToApi } from '@/lib/api-proxy';

// Every /api/* call from the browser is forwarded to the API service (see lib/api-proxy.ts).
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handler(req: NextRequest, ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  return proxyToApi(req, path);
}

export { handler as DELETE, handler as GET, handler as PATCH, handler as POST, handler as PUT };
