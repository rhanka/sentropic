import { createHash, createHmac } from 'node:crypto';
import { CustodyRevoked, type CustodySubject } from './data-plane';
import { combineAbortSignals } from './abort-signals';

export const CUSTODY_RPC_PATH = '/api/v1/artifacts/builder/v1/custody/';

/** Same controller service identity as live fences; no browser credential or signing private key. */
export function custodyRpcFromEnv(env: NodeJS.ProcessEnv) {
  let base: URL;
  try { base = new URL(env.APP_ARTIFACT_CUSTODY_API_URL ?? ''); } catch { throw new Error('Invalid APP_ARTIFACT_CUSTODY_API_URL'); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid APP_ARTIFACT_CUSTODY_API_URL');
  const ids = (env.APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS ?? '').split(/[\s,]+/).filter(Boolean);
  const entries = (env.APP_ARTIFACT_LIVE_CONTROLLER_KEYS ?? '').split(/[\s,]+/).filter(Boolean);
  const ring = new Map<string, Buffer>();
  for (const entry of entries) {
    const at = entry.indexOf('='); const kid = entry.slice(0, at); const material = entry.slice(at + 1);
    if (at < 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(kid) || ring.has(kid) || !/^[A-Za-z0-9_-]+$/.test(material)
      || Buffer.from(material, 'base64url').length < 32) throw new Error('Invalid custody controller key ring');
    ring.set(kid, Buffer.from(material, 'base64url'));
  }
  if (!ids.length || ids.some(id => !ring.has(id))) throw new Error('Custody controller service key required');
  const kid = ids[0]; const key = ring.get(kid)!;
  return async (operation: 'issue' | 'watch', subject: CustodySubject, signal: AbortSignal): Promise<unknown> => {
    const pathname = `${CUSTODY_RPC_PATH}${operation}`;
    const body = JSON.stringify({ subject });
    if (Buffer.byteLength(body) > 16_384) throw new CustodyRevoked();
    const timestamp = String(Date.now());
    const digest = createHash('sha256').update(body).digest('hex');
    const mac = createHmac('sha256', key).update(`custody-rpc.v1\nPOST\n${pathname}\n${timestamp}\n${digest}`).digest('base64url');
    try {
      const response = await fetch(new URL(pathname, base), { method: 'POST', redirect: 'error',
        signal: combineAbortSignals([signal, AbortSignal.timeout(500)]),
        headers: { 'content-type': 'application/json', 'x-custody-rpc': `${kid}:${timestamp}:${mac}` }, body });
      if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new CustodyRevoked(); }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.length;
        if (length > 16_384) { await reader.cancel(); throw new CustodyRevoked(); }
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new CustodyRevoked(); }
  };
}
export type CustodyRpc = ReturnType<typeof custodyRpcFromEnv>;
