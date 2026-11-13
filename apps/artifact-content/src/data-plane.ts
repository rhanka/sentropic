import { request, type RequestOptions } from 'node:https';
import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import type { ClientRequest } from 'node:http';
import type { LiveRoute } from './live';
import { combineAbortSignals } from './abort-signals';

/** Resolved by the API from authenticated host authority, never from browser headers. */
export type CustodySubject = { kind: 'live'; route: LiveRoute } | { kind: 'supervisor'; podName: string };
export interface CustodyLease {
  tenantId: 'sentropic' | 'immo'; principalId: string; physicalUid: string;
  custodyEpoch: number; port: number;
  /** Opaque agent-verifiable signed token. The edge neither signs nor re-encodes it. */
  token: string; issuedAt: string; deadlineAt: string;
}
export function isCustodyLease(value: unknown): value is CustodyLease {
  if (!value || typeof value !== 'object') return false;
  const lease = value as Record<string, unknown>;
  return ['tenantId', 'principalId', 'physicalUid', 'token', 'issuedAt', 'deadlineAt']
    .every(name => typeof lease[name] === 'string')
    && typeof lease.custodyEpoch === 'number' && typeof lease.port === 'number';
}
/** S1-B0a supplies authoritative resolution, signing and immediate revocation notification. */
export interface CustodyIssuer {
  issue(subject: CustodySubject, signal: AbortSignal): Promise<CustodyLease>;
  watch(subject: CustodySubject, revoke: () => void): () => void;
}
export const custodyRefused = () => new Response(JSON.stringify({ error: 'custody_revoked' }), {
  status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});
export class CustodyRevoked extends Error { constructor() { super('custody_revoked'); } }
export interface DataPlaneHop {
  open(path: string, options: RequestOptions): ClientRequest;
  /** A renewal ends the old WS so Vite reconnects with fresh custody; it never extends an admitted token. */
  guard(close: () => void, websocket?: boolean): () => void;
  valid(): boolean;
  dispose(): void;
}
export interface DataPlaneTransport {
  prepare(subject: CustodySubject, signal?: AbortSignal): Promise<DataPlaneHop>;
}

export function dataPlaneFromEnv(env: NodeJS.ProcessEnv, issuer?: CustodyIssuer): DataPlaneTransport | undefined {
  const backend = env.APP_ARTIFACT_SANDBOX_BACKEND ?? 'k8s';
  if (backend === 'k8s') return undefined;
  if (backend !== 'execution-node') throw new Error('Invalid APP_ARTIFACT_SANDBOX_BACKEND');
  if (!issuer) throw new Error('Execution-node custody issuer required');
  let base: URL;
  try { base = new URL(env.SANDBOX_NODE_URL ?? ''); } catch { throw new Error('Invalid SANDBOX_NODE_URL'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Invalid SANDBOX_NODE_URL');
  }
  const pem = (name: string) => {
    const value = env[name] ?? '';
    if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${name} required as base64 PEM`);
    return Buffer.from(value, 'base64');
  };
  const tls = { cert: pem('SANDBOX_MTLS_DATA_PLANE_CERT_B64'), key: pem('SANDBOX_MTLS_DATA_PLANE_KEY_B64'),
    ca: pem('SANDBOX_MTLS_CA_CERT_B64'), minVersion: 'TLSv1.3' as const, rejectUnauthorized: true };
  try {
    createSecureContext(tls);
    if (!new X509Certificate(tls.cert).subject.split('\n').includes('CN=data-plane:artifact-content')) throw new Error();
  } catch { throw new Error('Invalid execution-node data-plane TLS credentials'); }
  return {
    async prepare(subject, signal = AbortSignal.timeout(10_000)) {
      let revoked = false; const listeners = new Set<() => void>();
      const issuance = new AbortController();
      const revoke = () => { revoked = true; issuance.abort(); for (const close of listeners) close(); };
      const unwatch = issuer.watch(subject, revoke);
      let disposed = false;
      const dispose = () => { if (!disposed) { disposed = true; unwatch(); } };
      const issuingSignal = combineAbortSignals([signal, issuance.signal]);
      let lease: CustodyLease;
      let onAbort = () => {};
      try {
        lease = await Promise.race([issuer.issue(subject, issuingSignal), new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new CustodyRevoked());
          issuingSignal.addEventListener('abort', onAbort, { once: true });
          if (issuingSignal.aborted) onAbort();
        })]);
      } catch { dispose(); throw new CustodyRevoked(); }
      finally { issuingSignal.removeEventListener('abort', onAbort); }
      let issued: number; let deadline: number;
      try {
        if (!isCustodyLease(lease)) throw new CustodyRevoked();
        issued = Date.parse(lease.issuedAt); deadline = Date.parse(lease.deadlineAt);
        if (revoked || signal.aborted || !['sentropic', 'immo'].includes(lease.tenantId) || !lease.principalId
        || !/^[A-Za-z0-9-]{1,128}$/.test(lease.physicalUid) || !Number.isSafeInteger(lease.custodyEpoch) || lease.custodyEpoch < 0
        || !Number.isInteger(lease.port) || lease.port < 1 || lease.port > 65535
        || !lease.token || /[\r\n]/.test(lease.token) || !Number.isFinite(issued) || !Number.isFinite(deadline)
        || issued > Date.now() || deadline <= Date.now() || deadline <= issued || deadline - issued > 60_000) {
          throw new CustodyRevoked();
        }
      } catch { dispose(); throw new CustodyRevoked(); }
      return {
        valid: () => !revoked && Date.now() < deadline,
        dispose,
        open(path, options) {
          if (revoked || Date.now() >= deadline) throw new CustodyRevoked();
          if (!path.startsWith('/') || path.startsWith('//') || /[\r\n#]/.test(path)) throw new CustodyRevoked();
          const url = new URL(base); url.pathname = `/v1/ports/${lease.port}${path.split('?')[0]}`;
          if (!url.pathname.startsWith(`/v1/ports/${lease.port}/`)) throw new CustodyRevoked();
          url.search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
          return request(url, { ...options, ...tls, agent: false, headers: { ...options.headers,
            'x-tenant-id': lease.tenantId, 'x-expected-physical-uid': lease.physicalUid, 'x-custody-token': lease.token } });
        },
        guard(close, websocket = false) {
          listeners.add(close);
          // A bounded WS reconnect starts renewal before deadline; no unsupported in-band renewal protocol.
          const renewAt = websocket ? deadline - Math.min(1000, (deadline - issued) / 5) : deadline;
          const timer = setTimeout(close, Math.max(0, renewAt - Date.now())); timer.unref();
          if (revoked || signal.aborted || Date.now() >= deadline) close();
          return () => { clearTimeout(timer); listeners.delete(close); };
        },
      };
    },
  };
}
