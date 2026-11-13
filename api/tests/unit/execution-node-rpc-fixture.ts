import { createServer } from 'node:http';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';
import { createCustodyAuthority, createCustodyRpc, CUSTODY_RPC_BASE, signCustodyRpc } from '../../src/services/artifacts/live/execution-node-rpc';
import { createBuilderMount } from '../../src/services/artifacts/live/builder-mount';
import { createExecutionNodeBackend, type ExecutionNodeInputs } from '../../src/services/artifacts/live/execution-node-backend';
import type { LiveRuntime } from '../../src/services/artifacts/live/records';
import { authorizeLive, type LiveActor } from '../../src/services/artifacts/live/authorize';
import type { LivePorts } from '../../src/services/artifacts/live/ports';
import { fakeExecutionNode, sandboxSpec, session } from './execution-node-fake';
import { usePortsAvailability } from '../../../apps/sandbox-node/src/network-policy';

export async function custodyRpcFixture() {
  // This fake runtime has no runsc binary; explicitly enable its transport tests.
  usePortsAvailability(() => true);
  const sockets = new Set<Socket>();
  const upstream = createServer((_req, res) => { res.writeHead(200); res.write('sandbox-stream'); });
  upstream.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  upstream.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as { port: number }).port;
  const fake = await fakeExecutionNode(async () => ({ hostname: '127.0.0.1', port: upstreamPort }));
  await fake.adapter.heartbeat();
  const key = { storageScopeId: 'workspace', artifactId: 'artifact' };
  let runtime = { ...key, phase: 'LIVE', ownerId: 'principal', sessionId: 'session', generation: 1,
    leaseEpoch: 1, rowVersion: 1, routeEpoch: 1, podName: 'subject', sourceRevision: 'revision',
    appliedRevision: 'revision', podUid: null } as unknown as LiveRuntime;
  const values = new Map<string, unknown>();
  const backend = createExecutionNodeBackend(fake.adapter, {
    async read<T>(id: string) { return structuredClone(values.get(id)) as T | undefined; },
    async update<T, R>(id: string, change: (value: T | undefined) => { next?: T; result: R }) {
      const result = change(structuredClone(values.get(id)) as T | undefined);
      if (result.next) values.set(id, structuredClone(result.next)); return result.result;
    },
  }, { tenant: () => 'sentropic', provision: async () => {
    const s = session(); return { session: s, spec: { ...sandboxSpec(s), network: 'ports', profile: 'node-22' } };
  }, worker: { live: async () => ({ revision: 'revision', routeEpoch: 1 }) } } as unknown as ExecutionNodeInputs);
  runtime.podUid = (await backend.pods.ensure(key, runtime)).uid;
  await backend.worker.live(runtime);
  const route = { ...key, sessionId: runtime.sessionId, generation: 1, routeEpoch: 1,
    podName: runtime.podName, podUid: runtime.podUid!, sourceRevision: 'revision', principalId: 'principal', expiresAt: Date.now() + 60_000 };
  const rpcKey = { kid: 'synthetic', key: Buffer.alloc(32, 7) };
  let invitationEpoch = 1;
  const invitationExpiry = Date.now() + 60_000;
  const invitations = { current: async () => ({ epoch: invitationEpoch, expiresAt: invitationExpiry }) };
  const store = { async read() { return { runtime: structuredClone(runtime) } as never; },
    async active() { return [{ key, ownerId: runtime.ownerId, phase: runtime.phase }]; } };
  const binding = async () => ({ generation: 1, ownerId: 'principal', healthy: true });
  const rpc = createCustodyRpc({ key: rpcKey, node: fake.adapter, now: fake.now,
    resolve: createCustodyAuthority({ store, invitations, binding, session: r => backend.custody(r) }) });
  const mount = createBuilderMount({ api: rpc as never, authenticate: () => null,
    requireService: async () => { throw new Error('custody_must_authenticate_itself'); } });
  const api = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const response = await mount.request(`http://internal${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const subject = { kind: 'live' as const, route };
  const call = async (operation: string, subjectValue: unknown = subject, sign = true) => {
    const path = `${CUSTODY_RPC_BASE}/${operation}`; const body = JSON.stringify({ subject: subjectValue });
    return fetch(apiUrl + path, { method: 'POST', body, signal: AbortSignal.timeout(500), headers: sign
      ? { 'X-Custody-Rpc': signCustodyRpc(rpcKey, path, body) } : {} });
  };
  const open = (token: string, headers: Record<string, string> = {}, path = '/v1/ports/5173/') => request(new URL(path, fake.config.url), {
    ca: fake.tls.ca, ...fake.tls.dataPlane, agent: false,
    headers: { 'x-tenant-id': 'sentropic', 'x-expected-physical-uid': route.podUid, 'x-custody-token': token, ...headers },
  });
  return { fake, route, subject, backend, call, open,
    async grant(actor: LiveActor) {
      return { kind: 'live' as const, route: { ...await authorizeLive({ store, binding, invitations, now: Date.now } as unknown as LivePorts,
        key, actor, 'read'), expiresAt: route.expiresAt } };
    },
    revokeGuest() { invitationEpoch++; },
    activity() { runtime = { ...runtime, rowVersion: runtime.rowVersion + 1, lastAccessAt: Date.now() }; },
    stop() { runtime = { ...runtime, phase: 'QUIESCING', routeEpoch: runtime.routeEpoch + 1 }; },
    async close() {
      usePortsAvailability(() => false);
      for (const socket of sockets) socket.destroy(); api.closeAllConnections();
      await Promise.all([fake.close(), new Promise<void>(resolve => upstream.close(() => resolve())),
        new Promise<void>(resolve => api.close(() => resolve()))]);
    },
  };
}
