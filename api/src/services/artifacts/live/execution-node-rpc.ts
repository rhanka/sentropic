import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { canonicalNodeJson, nodeHash, type ExecutionNodeAdapter, type NodeSession } from './execution-node-adapter';
import { issueNodeCustody } from './execution-node-custody';
import type { ControllerFenceKey } from './live-fence';
import type { LivePorts, LiveStore } from './ports';
import type { LiveKey, LiveRuntime } from './records';
import { liveRevision } from './records';
import { liveRole } from './authorize';

export const CUSTODY_RPC_BASE = '/api/v1/artifacts/builder/v1/custody';
export const custodyRpcPath = (path: string) => path === `${CUSTODY_RPC_BASE}/issue` || path === `${CUSTODY_RPC_BASE}/watch`;
type Route = LiveKey & { sessionId: string; generation: number; routeEpoch: number; podUid: string;
  podName: string; sourceRevision: string; principalId?: string; expiresAt: number;
  role?: string; invitationId?: string; invitationEpoch?: number; invitationExp?: number };
export type CustodySubject = { kind: 'live'; route: Route } | { kind: 'supervisor'; podName: string };
export function signCustodyRpc(key: ControllerFenceKey, path: string, body: string, now = Date.now()) {
  const timestamp = String(now);
  const mac = createHmac('sha256', key.key).update(`custody-rpc.v1\nPOST\n${path}\n${timestamp}\n${nodeHash(body)}`).digest('base64url');
  return `${key.kid}:${timestamp}:${mac}`;
}
function authenticated(key: ControllerFenceKey, path: string, body: string, header: string, now: number) {
  const parts = header.split(':'); const timestamp = parts[1] ?? '';
  if (parts.length !== 3 || parts[0] !== key.kid || !/^\d{13}$/.test(timestamp)
    || Math.abs(now - Number(timestamp)) > 5000) return false;
  const expected = Buffer.from(signCustodyRpc(key, path, body, Number(timestamp)));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
const revoked = () => { throw new Error('custody_revoked'); };
/** Resolve every request from durable current state, including every watch poll on every replica. */
export function createCustodyAuthority(options: {
  store: Pick<LiveStore, 'read' | 'active'>;
  session(runtime: LiveRuntime): Promise<NodeSession>;
  binding(key: LiveKey): Promise<{ generation: number; ownerId: string }>;
  invitations: LivePorts['invitations'];
  now?: () => number;
}) {
  return async (subject: CustodySubject) => {
    let key: LiveKey;
    if (subject?.kind === 'live' && subject.route && typeof subject.route.artifactId === 'string'
      && typeof subject.route.storageScopeId === 'string') key = subject.route;
    else if (subject?.kind === 'supervisor' && typeof subject.podName === 'string') {
      const found: LiveKey[] = [];
      for (const active of await options.store.active()) {
        if ((await options.store.read(active.key))?.runtime.podName === subject.podName) found.push(active.key);
      }
      if (found.length !== 1) return revoked(); key = found[0]!;
    } else return revoked();
    const authority = async () => {
      let expiresAt = subject.kind === 'live' ? subject.route.expiresAt : null;
      const runtime = (await options.store.read(key))?.runtime;
      const binding = await options.binding(key);
      if (!runtime || !runtime.podUid || binding.ownerId !== runtime.ownerId || binding.generation !== runtime.generation
        || !['REVIVING', 'LIVE', 'BUILD_PROVISIONING', 'BUILD_QUEUED', 'BUILDING'].includes(runtime.phase)) return revoked();
      if (subject.kind === 'live') {
        const route = subject.route;
        if (runtime.phase !== 'LIVE' || !Number.isFinite(route.expiresAt) || route.expiresAt <= (options.now ?? Date.now)()
          || !route.principalId || runtime.appliedRevision === null || route.sourceRevision !== liveRevision(runtime.appliedRevision)
          || !['sessionId', 'generation', 'routeEpoch', 'podName'].every(field =>
            route[field as keyof Route] === runtime[field as keyof LiveRuntime]) || route.podUid !== runtime.podUid) return revoked();
        const fence = await options.invitations.current(key, runtime.generation);
        try {
          const role = liveRole(runtime, binding as Parameters<typeof liveRole>[1], {
            principalId: route.principalId,
            invitation: route.role === 'invitee' && route.invitationId ? { id: route.invitationId,
              epoch: route.invitationEpoch!, expiresAt: route.invitationExp! * 1000 } : undefined,
          }, 'read', (options.now ?? Date.now)(), fence.epoch);
          if (role === 'invitee' && (!Number.isFinite(route.invitationExp) || fence.expiresAt === null
            || fence.expiresAt <= (options.now ?? Date.now)())) return revoked();
        } catch { return revoked(); }
        if (route.role === 'invitee') expiresAt = Math.min(expiresAt!, route.invitationExp! * 1000, fence.expiresAt!);
      }
      const grant = subject.kind === 'live' ? subject.route : null;
      return { runtime, value: { owner: binding.ownerId, principal: grant?.principalId ?? binding.ownerId,
        role: grant?.role ?? 'binding_owner', invitationId: grant?.invitationId ?? '',
        invitationEpoch: grant?.invitationEpoch ?? 0, invitationExp: grant?.invitationExp ?? 0,
        sessionId: runtime.sessionId, generation: runtime.generation, routeEpoch: runtime.routeEpoch,
        physicalUid: runtime.podUid, sourceRevision: runtime.appliedRevision, expiresAt } };
    };
    const { runtime, value } = await authority();
    const session = await options.session(runtime);
    if (session.physicalUid !== runtime.podUid || session.ownership.principalId !== runtime.ownerId
      || session.ownership.generation !== runtime.generation || session.ownership.sessionId !== runtime.sessionId) return revoked();
    // Read again after remote node I/O: stop/replacement racing resolution cannot mint an old lease.
    if (canonicalNodeJson((await authority()).value) !== canonicalNodeJson(value)) return revoked();
    const port = 5173; // Existing bootstrap multiplexes supervisor frames and live on the worker service port.
    return { session, port, expiresAt: value.expiresAt, version: nodeHash(canonicalNodeJson({ ...value, tenantId: session.ownership.tenantId,
      custodyEpoch: session.ownership.custodyEpoch, port })) };
  };
}
export function createCustodyRpc(options: {
  key: ControllerFenceKey; node: ExecutionNodeAdapter;
  resolve: ReturnType<typeof createCustodyAuthority>; now?: () => number;
}) {
  const app = new Hono(); const now = options.now ?? Date.now;
  app.use('/v1/custody/*', bodyLimit({ maxSize: 16 * 1024 }));
  app.post('/v1/custody/:operation', async c => {
    c.header('cache-control', 'private, no-store');
    const operation = c.req.param('operation');
    if (!['issue', 'watch'].includes(operation) || new URL(c.req.url).search) return c.json({ error: 'invalid_request' }, 400);
    const body = await c.req.text(); const path = `${CUSTODY_RPC_BASE}/${operation}`;
    if (!authenticated(options.key, path, body, c.req.header('X-Custody-Rpc') ?? '', now())) return c.json({ error: 'custody_revoked' }, 403);
    let subject: CustodySubject;
    try {
      const parsed = JSON.parse(body);
      if (!parsed || Object.keys(parsed).join() !== 'subject') throw new Error(); subject = parsed.subject;
    } catch { return c.json({ error: 'invalid_request' }, 400); }
    try {
      const resolved = await options.resolve(subject);
      if (operation === 'watch') return c.json({ version: resolved.version });
      const { session, port } = resolved;
      const issuedAt = now();
      const ttl = resolved.expiresAt === null ? 60_000 : Math.min(60_000, resolved.expiresAt - issuedAt);
      const signed = issueNodeCustody(options.node, session, session.ownership.principalId, session.ownership.custodyEpoch, ttl, issuedAt);
      return c.json({ tenantId: signed.claims.tenantId, principalId: signed.claims.principalId, physicalUid: session.physicalUid,
        custodyEpoch: signed.claims.custodyEpoch, port, token: signed.headers['X-Custody-Token'],
        issuedAt: signed.claims.issuedAt, deadlineAt: signed.claims.deadlineAt });
    } catch (error) {
      return error instanceof Error && error.message === 'custody_revoked'
        ? c.json({ error: 'custody_revoked' }, 403) : c.json({ error: 'custody_unavailable' }, 503);
    }
  });
  return app;
}
