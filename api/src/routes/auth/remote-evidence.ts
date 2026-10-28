import { Hono } from 'hono';
import { RemoteAuthorityError, parseRemoteJson, remoteEvidenceRequestSchema,
  type RemoteEvidenceRequest } from '../../services/auth/remote-contract';

export interface RemoteEvidenceRoutePorts {
  expectedWorkload: string;
  authenticateWorkload(request: Request): Promise<{ workload: string } | null>;
  issue(request: RemoteEvidenceRequest): Promise<string>;
}
async function boundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 8192))
    throw new RemoteAuthorityError('oversize');
  const reader = request.body?.getReader();
  if (!reader) throw new RemoteAuthorityError('invalid_request');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > 8192) throw new RemoteAuthorityError('oversize');
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
export function createRemoteEvidenceRouter(options: { role: 'auth-idp' | 'product' } & Partial<RemoteEvidenceRoutePorts>) {
  return new Hono().post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (options.role !== 'auth-idp') return c.json({ error: 'authority_refused' }, 403);
    if (c.req.header('origin') || c.req.header('cookie')) return c.json({ error: 'origin_refused' }, 403);
    if (new URL(c.req.url).protocol !== 'https:') return c.json({ error: 'authority_refused' }, 403);
    try {
      const caller = await options.authenticateWorkload?.(c.req.raw);
      if (!caller) return c.json({ error: 'authentication_required' }, 401);
      if (!options.expectedWorkload || caller.workload !== options.expectedWorkload)
        return c.json({ error: 'authority_refused' }, 403);
      if (!options.issue) throw new RemoteAuthorityError('authority_unavailable');
      const bytes = await boundedBody(c.req.raw);
      let value: unknown;
      try { value = parseRemoteJson(bytes); }
      catch { throw new RemoteAuthorityError('invalid_request'); }
      const parsed = remoteEvidenceRequestSchema.safeParse(value);
      if (!parsed.success) throw new RemoteAuthorityError('invalid_request');
      const evidence = await options.issue(parsed.data);
      c.header('Content-Type', 'application/jwt');
      return c.body(evidence);
    } catch (error) {
      const code = error instanceof RemoteAuthorityError ? error.code : 'authority_unavailable';
      const status = code === 'invalid_request' ? 400 : code === 'authentication_required' ? 401
        : code === 'authority_refused' ? 403 : code === 'replay_refused' ? 409
          : code === 'expired' ? 410 : code === 'oversize' ? 413 : 503;
      return c.json({ error: code }, status);
    }
  });
}
