import { createPublicKey, type KeyObject } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { LookupFunction } from 'node:net';
import { SUPERVISOR_PATH } from '../../../api/src/services/artifacts/live/bootstrap-server';
import { MAX_FRAME_BYTES, MAX_REPLY_BYTES, openFrame, SIGNATURE_BYTES } from '../../../api/src/services/artifacts/live/supervisor-frame';
import { DEFAULT_BUILDER_NAMESPACE } from './live';

/** Pod hop bound: above the API's 320 s command bound, so the API side always gives up first. */
export const RELAY_UPSTREAM_TIMEOUT_MS = 330_000;
const POD_PORT = 5173;
const POD = /^artifact-[a-f0-9]{40}$/;
const NAMESPACE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const KEYS_ENV = 'APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS';
const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export interface SupervisorRelayOptions {
  /** Supervisor frame public keys (Ed25519); two during a rotation. No secret: frames are verified, never signed here. */
  publicKeys: readonly KeyObject[];
  /** Per-environment worker namespace of the pods' :5173 Service. */
  namespace: string;
  now?: () => number;
  /** Test seam for the pod hop: Service DNS resolution and port. */
  upstream?: { port?: number; lookup?: LookupFunction };
}
type Forwarded = { status: 200; body: Uint8Array<ArrayBuffer> } | { status: 403 | 502 };

/**
 * A-LIVE §8.1 supervisor relay: artifact-content is the workers' only ingress. Before touching the pod, a request needs
 * a valid pod name, an octet-stream body of 65 bytes to 2 MiB (413 otherwise) and a W3 frame verified with a configured
 * public key whose fence names that same pod (else an empty 403). The same bytes then go to the pod Service with no
 * other header, over node:http with no client timeout but the 330 s bound (the pod replies only when a command ends);
 * the API client closing aborts it. No queue: concurrent frames to one pod are allowed. Nothing about a frame is logged.
 */
export function createSupervisorRelay(options: SupervisorRelayOptions) {
  if (!options.publicKeys.length || options.publicKeys.some(key => key.type !== 'public' || key.asymmetricKeyType !== 'ed25519')) {
    throw new Error(`${KEYS_ENV} must hold Ed25519 public keys`);
  }
  if (!NAMESPACE.test(options.namespace)) throw new Error('Invalid supervisor relay builder namespace');
  const now = options.now ?? Date.now;
  const port = options.upstream?.port ?? POD_PORT;

  async function read(request: Request): Promise<Buffer | undefined> {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (!(declared <= MAX_FRAME_BYTES)) return undefined;
    const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_FRAME_BYTES) { await reader.cancel().catch(() => undefined); return undefined; }
      chunks.push(chunk.value);
    }
    return size > SIGNATURE_BYTES ? Buffer.concat(chunks) : undefined;
  }
  function forward(podName: string, frame: Buffer, signal: AbortSignal) {
    return new Promise<Forwarded>(resolve => {
      let settled = false;
      const abort = () => done({ status: 502 });
      const timer = setTimeout(abort, RELAY_UPSTREAM_TIMEOUT_MS);
      const outgoing = httpRequest({ hostname: `${podName}.${options.namespace}.svc.cluster.local`, port, method: 'POST',
        path: SUPERVISOR_PATH, agent: false, lookup: options.upstream?.lookup,
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(frame.length) } }, response => {
        if (response.statusCode !== 200) { done({ status: response.statusCode === 403 ? 403 : 502 }); return; }
        if (Number(response.headers['content-length'] ?? 0) > MAX_REPLY_BYTES) { done({ status: 502 }); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_REPLY_BYTES) done({ status: 502 }); else chunks.push(chunk);
        });
        response.once('end', () => {
          if (size > MAX_REPLY_BYTES) return done({ status: 502 });
          const body = new Uint8Array(size); let at = 0;
          for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
          done({ status: 200, body });
        });
        response.once('close', () => { if (!response.complete) done({ status: 502 }); });
      });
      function done(result: Forwarded) {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        outgoing.destroy(); resolve(result);
      }
      signal.addEventListener('abort', abort, { once: true });
      outgoing.once('error', () => done({ status: 502 }));
      if (signal.aborted) abort(); else outgoing.end(frame);
    });
  }
  return {
    async relay(request: Request, podName: string): Promise<Response> {
      if (request.method !== 'POST') return empty(404);
      if (!POD.test(podName) || request.headers.get('content-type') !== 'application/octet-stream') return empty(403);
      // A client that leaves while its frame is read gets nothing back; no detail is surfaced.
      const frame = await read(request).catch(() => null);
      if (frame === null) return empty(502);
      if (!frame) return empty(413);
      const at = now();
      const body = options.publicKeys.map(key => openFrame(key, frame, at)).find(Boolean);
      if (!body || body.fence.podName !== podName) return empty(403);
      const result = await forward(podName, frame, request.signal);
      if (result.status !== 200) return empty(result.status);
      return new Response(result.body, { status: 200, headers: { 'content-type': 'application/octet-stream',
        'content-length': String(result.body.byteLength), 'cache-control': 'no-store' } });
    },
  };
}
export type SupervisorRelay = ReturnType<typeof createSupervisorRelay>;

/**
 * Composes the relay from configuration (README « Supervisor relay »). Absent `APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED=1`
 * there is no relay; it does not depend on `APP_ARTIFACT_LIVE_ENABLED` or `APP_ARTIFACT_CONTENT_ENABLED`. An invalid
 * key list or namespace refuses startup.
 */
export function supervisorRelayFromEnv(env: NodeJS.ProcessEnv) {
  if (env.APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED !== '1') return undefined;
  const entries = (env[KEYS_ENV] ?? '').split(/\s+/).filter(Boolean);
  if (entries.length < 1 || entries.length > 2 || new Set(entries).size !== entries.length) {
    throw new Error(`${KEYS_ENV} must hold one or two distinct keys`);
  }
  const publicKeys = entries.map(entry => {
    let key: KeyObject | undefined;
    try { if (BASE64.test(entry)) key = createPublicKey({ key: Buffer.from(entry, 'base64'), format: 'der', type: 'spki' }); } catch { /* invalid */ }
    if (!key || key.asymmetricKeyType !== 'ed25519' || key.export({ type: 'spki', format: 'der' }).toString('base64') !== entry) {
      throw new Error(`${KEYS_ENV} has an invalid entry`);
    }
    return key;
  });
  const namespace = env.APP_ARTIFACT_LIVE_BUILDER_NAMESPACE?.trim() || DEFAULT_BUILDER_NAMESPACE;
  if (!NAMESPACE.test(namespace)) throw new Error('Invalid supervisor relay builder namespace');
  return createSupervisorRelay({ publicKeys, namespace });
}
