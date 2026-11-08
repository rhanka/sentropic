import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { vi } from 'vitest';
import { POD } from '../../../api/tests/unit/artifacts-live/bootstrap-harness';
import type { LiveRuntime } from '../../../api/src/services/artifacts/live/records';
import { composeSupervisor } from '../../../api/src/services/artifacts/live/supervisor-composition';
import { sealFrame } from '../../../api/src/services/artifacts/live/supervisor-frame';
import { createRelaySupervisorChannel, SUPERVISOR_COMMAND_TIMEOUT_MS } from '../../../api/src/services/artifacts/live/supervisor-relay';
import type { createSupervisorRoute } from '../src/host';
import { startContentServer } from '../src/index';
import { createSupervisorRelay } from '../src/supervisor-relay';

export { POD };
export const NS = 'artifact-builders-test';
export const INTERNAL = 'artifact-content.sentropic-test.svc.cluster.local';
export const PATH = `/_live-supervisor/v1/${POD.podName}`;
export const baseDomain = 'preprod.sentropic.example';
export const keys = generateKeyPairSync('ed25519');
export const runtime = { generation: 1, sessionId: 's1', leaseEpoch: 1, routeEpoch: 1, ...POD } as LiveRuntime;
export const resolved: string[] = [];
/** Resolves every internal Service DNS name to the loopback test listeners and records the requested name. */
export const loopback: LookupFunction = (host, options, callback) => {
  resolved.push(host);
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
};
export const frame = (key: KeyObject = keys.privateKey, podName = POD.podName, id = 'f-1', now = Date.now()) => sealFrame(key, {
  v: 1, id, op: 'phase', fence: { generation: 1, sessionId: 's1', leaseEpoch: 1, routeEpoch: 1, podName, podUid: POD.podUid },
  issuedAt: now, expiresAt: now + 30_000, args: { phase: 'stopped' } });
export const replyTo = (body: Uint8Array) => Buffer.from(JSON.stringify({
  id: (JSON.parse(Buffer.from(body).subarray(64).toString('utf8')) as { id: string }).id, ok: true, data: { phase: 'stopped' } }));

export interface Seen { method?: string; url?: string; headers: IncomingMessage['headers']; body: Buffer; res: ServerResponse; closed: Promise<void> }
const open: Server[] = [];
export function cleanup() {
  vi.useRealTimers(); vi.unstubAllGlobals(); resolved.length = 0;
  for (const server of open.splice(0)) { server.closeAllConnections(); server.close(); }
}
/** Closes `server` after the test. */
export const own = (server: Server) => { open.push(server); return server; };
export const listen = async (server: Server) => {
  own(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};
/** Fake pod :5173 listener; `answer` runs once the whole frame is received (or never answers). */
export async function fakePod(answer: (seen: Seen) => void = () => undefined) {
  const seen: Seen[] = [];
  const port = await listen(createServer((req, res) => {
    const chunks: Buffer[] = [];
    const entry: Seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.alloc(0), res,
      closed: new Promise(resolve => res.once('close', () => resolve())) };
    seen.push(entry);
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { entry.body = Buffer.concat(chunks); answer(entry); });
  }));
  return { seen, port };
}
export const relayTo = (port: number, publicKeys = [keys.publicKey]) =>
  createSupervisorRelay({ publicKeys, namespace: NS, upstream: { port, lookup: loopback } });
export const post = (route: ReturnType<typeof createSupervisorRoute>, body: Uint8Array, init: { host?: string; path?: string;
  method?: string; headers?: Record<string, string> } = {}) => route(new Request(`https://${init.host ?? `${INTERNAL}:8791`}${init.path ?? PATH}`, {
  method: init.method ?? 'POST', body: init.method === 'GET' ? undefined : new Uint8Array(body),
  headers: { 'content-type': 'application/octet-stream', ...init.headers } }));
export const status = async (response: Promise<Response> | undefined) => {
  const value = await response;
  return value && { status: value.status, body: Buffer.from(await value.arrayBuffer()).toString() };
};
/** Lets real socket I/O and the simulated clock interleave until `promise` settles. */
export async function settle<T>(promise: Promise<T>) {
  let done = false; promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 2000 && !done; i++) { await new Promise(resolve => setImmediate(resolve)); await vi.advanceTimersByTimeAsync(1); }
  return promise;
}
export const until = async (check: () => boolean) => {
  for (let i = 0; i < 2000 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
};
/** Real content listener (relay only) and API-side supervisors composed over the relay channel, as service.ts does. */
export async function apiToListener(podPort: number) {
  const server = own(await startContentServer({ env: {}, hostname: '127.0.0.1', port: 0, supervisorRelay: relayTo(podPort) }));
  const baseUrl = `http://${INTERNAL}:${(server.address() as AddressInfo).port}`;
  const supervisor = (options: { key?: KeyObject; now?: () => number; id?: string } = {}) => composeSupervisor({
    key: { kid: 'sentropic-test-supervisor-1', key: options.key ?? keys.privateKey },
    channel: createRelaySupervisorChannel({ baseUrl, lookup: loopback }), now: options.now ?? Date.now,
    id: () => options.id ?? 'f-1', timeoutMs: SUPERVISOR_COMMAND_TIMEOUT_MS, sources: {
      source: async () => [], draft: async () => ({ files: [], deletes: [] }), dependencies: async function* () { /* none */ },
      candidate: async () => undefined } }).supervisor;
  return { baseUrl, supervisor };
}
