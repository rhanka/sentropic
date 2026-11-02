import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { ReceiverRefusal, relayRefusal } from './errors';
import type {
  BoundContext,
  BrowserSession,
  EventAckStore,
  PreparedTunnel,
  SessionContentReceiverPorts,
  SourcePrincipal,
  TunnelRegistry,
} from './ports';
import { createSessionContentReceiver, type SessionContentReceiver } from './receiver';

/**
 * R-7 fail-closed fake-A double for consumer tests — FIXTURE ONLY, never wired in product.
 * It sits behind the same public ports as the real receiver but refuses every source-gap
 * authority instead of always-allowing: approvedTarget/registry stay null, the endpoint
 * authority authenticates only the fixture installation, and unknown tunnels refuse.
 */

export const FAKE_A_INSTANCE_ID = 'fake-a-instance';
export const FAKE_A_AUDIENCE = 'fake-a-audience';
export const FAKE_SOURCE_HEADER = 'x-fake-a-source-credential';
export const FAKE_SOURCE_CREDENTIAL = 'fake-a-source-credential';

export const fakeAPrincipal: SourcePrincipal = {
  sourceId: 'fake-source-1',
  ownerId: 'owner-1',
  keyId: 'fake-source-key-1',
  audience: FAKE_A_AUDIENCE,
};

/** Default bound carrier: tests override with `bound:` (pass `bound: null` to test the unbound refusal). */
const DEFAULT_BOUND: BoundContext = {
  sessionRef: { originInstanceId: 'mesh-b', sessionId: 'source-session-1', incarnation: 'inc-1' },
  stage: 'bound',
  engineKind: 'cli',
  lane: 'lifecycle',
  circuitId: 'circuit-1',
  descriptorDigest: 'd'.repeat(64),
  targetDigest: 'a'.repeat(64),
  visibility: 'activated',
  sourceAck: true,
};

export interface FakeAOptions {
  readonly binding?: SessionContentReceiverPorts['resolveBinding'];
  readonly bound?: BoundContext | null;
  readonly tunnels?: TunnelRegistry;
  readonly handlers?: SessionContentReceiverPorts['handlers'];
  readonly eventAckStore?: EventAckStore;
  readonly now?: () => number;
  /** Browser cookie session for the view-family routes; null keeps every browser route refused. */
  readonly browserSession?: BrowserSession | null;
}

/** Default fake-A browser session (first-party cookie, same-origin). */
export const FAKE_A_BROWSER_SESSION: BrowserSession = {
  userId: 'owner-1',
  sid: 'sid-1',
  originOk: true,
};

export const createFakeATunnelRegistry = (tunnels: readonly PreparedTunnel[] = []): TunnelRegistry => {
  const state = new Map(tunnels.map((t) => [t.tunnelId, { ...t }]));
  return {
    lookup: (tunnelId) => state.get(tunnelId) ?? null,
    consume: (tunnelId, now) => {
      const tunnel = state.get(tunnelId);
      if (!tunnel) return { refusal: 'relay_scope_refused' };
      if (now > tunnel.expiresAt) return { refusal: 'relay_grant_expired' };
      if (tunnel.consumed) return { refusal: 'relay_stale_generation' };
      state.set(tunnelId, { ...tunnel, consumed: true });
      return { tunnel: { ...tunnel, consumed: true } };
    },
  };
};

/** In-memory ACK store: commits are atomic per call; a failing commit throws and yields no ACK. */
export const createFakeAEventAckStore = (options: { readonly failCommits?: boolean } = {}): EventAckStore & {
  readonly commits: readonly string[];
} => {
  const commits: string[] = [];
  const commit = (kind: string, digest: string) => {
    if (options.failCommits) throw relayRefusal('relay_unavailable', true);
    commits.push(`${kind}:${digest}`);
    return { ackDigest: createHash('sha256').update(`${kind}:${digest}`).digest('hex') };
  };
  return {
    commits,
    commitActivation: (input) => ({ ...commit('activation', input.requestDigest), authorityRevision: 2, gaps: [] }),
    commitEvents: (input) => ({ ...commit('events', input.requestDigest), admittedThrough: 1, gaps: [] }),
    commitProjection: (input) => ({ ...commit('projection', input.requestDigest) }),
    commitChat: (input) => ({ ...commit('chat', input.requestDigest) }),
  };
};

export const createFakeASessionContentReceiver = (options: FakeAOptions = {}): SessionContentReceiver & {
  readonly ports: SessionContentReceiverPorts;
  readonly handlerCalls: readonly string[];
} => {
  const handlerCalls: string[] = [];
  const handlers: SessionContentReceiverPorts['handlers'] = Object.fromEntries(
    Object.entries(options.handlers ?? {}).map(([id, handler]) => [id, async (c: Context, ctx) => {
      handlerCalls.push(id);
      return handler(c, ctx);
    }]),
  );
  const ports: SessionContentReceiverPorts = {
    now: options.now ?? (() => 1_793_520_000_000),
    approvedTarget: null, // source-gap: refused, never filled
    endpointAuthority: {
      authenticateInstallation: async (request) => {
        const header = request.headers.get('x-fake-a-installation');
        if (header !== FAKE_A_INSTANCE_ID) return null;
        return { instanceId: FAKE_A_INSTANCE_ID, audience: FAKE_A_AUDIENCE };
      },
    },
    sourceAuthHeaders: [FAKE_SOURCE_HEADER],
    verifySourceCredential: async (name, value) =>
      (name === FAKE_SOURCE_HEADER && value === FAKE_SOURCE_CREDENTIAL ? fakeAPrincipal : null),
    resolveBinding: options.binding ?? (async (bindingId) => bindingId === 'binding-1' ? {
      bindingId: 'binding-1', ownerId: fakeAPrincipal.ownerId, tenantId: 'tenant-1',
      workspaceId: 'workspace-1', sourceSessionId: 'source-session-1', targetDigest: 'a'.repeat(64),
    } : null),
    resolveBoundContext: () => ('bound' in options ? options.bound : DEFAULT_BOUND) ?? null,
    tunnels: options.tunnels ?? createFakeATunnelRegistry(),
    resolveBrowserSession: async () => options.browserSession ?? null, // null: browser routes refuse
    eventAckStore: options.eventAckStore ?? createFakeAEventAckStore(),
    registry: null, // source-gap: refused, never filled
    handlers,
    purposeCurrent: async () => true,
    policySupplementAccepted: true,
  };
  const receiver = createSessionContentReceiver(ports);
  return { ...receiver, ports, handlerCalls };
};

export { ReceiverRefusal };
