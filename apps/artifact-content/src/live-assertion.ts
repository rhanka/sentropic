import { parseContentHost } from '@sentropic/artifacts/content/routing';
import { podName } from '../../../api/src/services/artifacts/live/pods';
import {
  ASSERTION_HEADER, CONTROL_HEADER, FENCE_HEADER, MAX_ASSERTION_SECONDS, verifyLiveAssertion, verifyLiveControl, verifyLiveFence,
} from '@sentropic/artifacts/live-host';
import { LIVE_CONTROL_PATH, LIVE_FENCE_PATH, type LiveProxyPorts, type LiveRoute } from './live';

/**
 * A-LIVE §8.2 live edge for a host-owned pages domain (W9 / M4-E). The host (immo) evaluates the reader gate, strips
 * browser credentials and forwards with a signed assertion; this edge re-verifies it on every request, keeps the
 * session-bound record, and closes sockets when the host revokes or the controller fences. Nothing reaches Vite.
 */
/**
 * Revocation state pushed by the host/controller, plus the session-bound live authorization record (A-LIVE §8.2):
 * a session keeps one generation and one owner principal; an invitation binds one principal and one session, and
 * its highest admitted epoch is its floor. Watchers close live sockets immediately.
 */
export function createLiveFences(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const floors = new Map<string, { generation: number; routeEpoch: number }>();
  const invitationFloors = new Map<string, number>(); // `${artifactId}/${invitationId}` -> minimum live epoch
  const revoked = new Map<string, number>(); // `${artifactId}/${sessionId}` -> forget-after (ms)
  const sessions = new Map<string, { generation: number; ownerId?: string; until: number }>();
  const invitations = new Map<string, { sessionId: string; principalId: string; until: number }>();
  const watchers = new Map<string, Set<{ route: LiveRoute; close(): void }>>();
  const stale = (route: LiveRoute) => {
    const floor = floors.get(route.artifactId);
    const invitationFloor = route.invitationId ? invitationFloors.get(`${route.artifactId}/${route.invitationId}`) : undefined;
    return revoked.has(`${route.artifactId}/${route.sessionId}`)
      || (invitationFloor !== undefined && (route.invitationEpoch ?? 0) < invitationFloor) || (!!floor
      && (route.generation < floor.generation || (route.generation === floor.generation && route.routeEpoch < floor.routeEpoch)));
  };
  const sweep = (artifactId: string) => {
    for (const entry of [...(watchers.get(artifactId) ?? [])]) if (stale(entry.route)) { watchers.get(artifactId)!.delete(entry); entry.close(); }
  };
  const raiseInvitation = (artifactId: string, invitationId: string, epoch: number) => {
    const id = `${artifactId}/${invitationId}`;
    if (epoch > (invitationFloors.get(id) ?? 0)) { invitationFloors.set(id, epoch); sweep(artifactId); }
  };
  return {
    isCurrent: (route: LiveRoute) => !stale(route),
    /** Admits a host-asserted route against the session record; refuses anything inconsistent with it. */
    admit(route: LiveRoute) {
      const t = now();
      for (const map of [sessions, invitations]) for (const [id, entry] of map) if (entry.until <= t) map.delete(id);
      if (stale(route) || !route.principalId || !route.role) return false;
      const id = `${route.artifactId}/${route.sessionId}`;
      const session = sessions.get(id) ?? { generation: route.generation, until: route.expiresAt };
      if (session.generation !== route.generation) return false;
      if (route.role === 'binding_owner') {
        if (session.ownerId !== undefined && session.ownerId !== route.principalId) return false;
        session.ownerId = route.principalId;
      } else {
        const inviteKey = `${route.artifactId}/${route.invitationId}`; const bound = invitations.get(inviteKey);
        if (!route.invitationId || (bound && (bound.sessionId !== route.sessionId || bound.principalId !== route.principalId))) return false;
        invitations.set(inviteKey, { sessionId: route.sessionId, principalId: route.principalId,
          until: Math.max(bound?.until ?? 0, route.expiresAt) });
        raiseInvitation(route.artifactId, route.invitationId, route.invitationEpoch ?? 0);
      }
      session.until = Math.max(session.until, route.expiresAt); sessions.set(id, session);
      return true;
    },
    revoke(input: { artifactId: string; sessionId: string; forgetAfter?: number }) {
      const t = now();
      for (const [key, until] of revoked) if (until <= t) revoked.delete(key);
      revoked.set(`${input.artifactId}/${input.sessionId}`, input.forgetAfter ?? t + MAX_ASSERTION_SECONDS * 1000);
      sweep(input.artifactId);
    },
    /** Invitation revocation: the host bumps the epoch; every older assertion and open socket for it is refused/closed. */
    revokeInvitation(input: { artifactId: string; invitationId: string; epoch: number }) {
      raiseInvitation(input.artifactId, input.invitationId, input.epoch);
    },
    fence(input: { artifactId: string; generation: number; routeEpoch: number }) {
      const floor = floors.get(input.artifactId);
      if (!floor || input.generation > floor.generation || (input.generation === floor.generation && input.routeEpoch > floor.routeEpoch)) {
        floors.set(input.artifactId, { generation: input.generation, routeEpoch: input.routeEpoch });
      }
      sweep(input.artifactId);
    },
    watch(route: LiveRoute, close: () => void) {
      const entry = { route, close }; const set = watchers.get(route.artifactId) ?? new Set();
      watchers.set(route.artifactId, set); set.add(entry);
      return () => { set.delete(entry); };
    },
  };
}
export type LiveFences = ReturnType<typeof createLiveFences>;

const noStore = () => new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } });
export interface HostAssertionLiveOptions {
  /** One entry per host-owned pages domain; only the listed key ids may assert or revoke for it. */
  hosts: { pagesDomain: string; keyIds: string[] }[];
  key(kid: string): Uint8Array | undefined;
  /** The controller's own key ring: the only authority for generation and route-epoch fences. */
  controller: { keyIds: string[]; key(kid: string): Uint8Array | undefined };
  fences: LiveFences;
  /** The host's staged-source / dependency manifest check. */
  admittedPath: LiveProxyPorts['admittedPath'];
  now?: () => number; fetch?: typeof fetch;
}
type HostAssertionLive = LiveProxyPorts & Required<Pick<LiveProxyPorts, 'origin' | 'control' | 'fence'>>;
export function createHostAssertionLive(options: HostAssertionLiveOptions): HostAssertionLive {
  const now = options.now ?? Date.now;
  const domainFor = (host: string) => options.hosts.find(entry => parseContentHost(host, entry.pagesDomain));
  const origin = (host: string) => {
    const entry = domainFor(host); return entry ? parseContentHost(host, entry.pagesDomain) : undefined;
  };
  const single = (request: Request, header: string) => {
    const value = request.headers.get(header);
    return value && !value.includes(',') ? value : undefined; // duplicate headers join with a comma
  };
  /** One header value, from a listed key, scoped to this exact host and artifact. */
  function scoped(request: Request, artifactId: string, header: string) {
    const value = single(request, header); const url = new URL(request.url); const entry = domainFor(url.host);
    if (!value || !entry || origin(url.host)?.id !== artifactId) return;
    return { value, entry, host: url.host.toLowerCase(), url };
  }
  const post = (request: Request, path: string) => {
    const url = new URL(request.url); return request.method === 'POST' && url.pathname === path && !url.search;
  };
  return {
    origin, fetch: options.fetch, now,
    async authorize(request: Request, artifactId: string): Promise<LiveRoute | undefined> {
      const scope = scoped(request, artifactId, ASSERTION_HEADER);
      const claims = scope && verifyLiveAssertion(scope.value, { key: options.key, now });
      if (!scope || !claims || !scope.entry.keyIds.includes(claims.kid) || claims.host !== scope.host
        || claims.artifactId !== artifactId || claims.podName !== podName(claims)) return;
      const route: LiveRoute = { storageScopeId: claims.storageScopeId, artifactId, sessionId: claims.sessionId,
        generation: claims.generation, routeEpoch: claims.routeEpoch, podUid: claims.podUid, podName: claims.podName,
        expiresAt: (claims.role === 'invitee' ? Math.min(claims.exp, claims.invitationExp) : claims.exp) * 1000,
        sourceRevision: claims.sourceRevision, principalId: claims.principalId, role: claims.role,
        ...(claims.role === 'invitee' ? { invitationId: claims.invitationId, invitationEpoch: claims.invitationEpoch } : {}) };
      return options.fences.admit(route) ? route : undefined;
    },
    /** Host push path: session and invitation revocation, on the artifact's own pages-domain Host. */
    async control(request: Request, artifactId: string): Promise<Response | undefined> {
      const scope = scoped(request, artifactId, CONTROL_HEADER);
      if (!scope || !post(request, LIVE_CONTROL_PATH)) return;
      const c = verifyLiveControl(scope.value, { key: options.key, now });
      if (!c || !scope.entry.keyIds.includes(c.kid) || c.host !== scope.host || c.artifactId !== artifactId) return;
      if (c.op === 'revoke_session') options.fences.revoke({ artifactId, sessionId: c.sessionId });
      else options.fences.revokeInvitation({ artifactId, invitationId: c.invitationId, epoch: c.epoch });
      return noStore();
    },
    /** Controller push path: generation and route-epoch fences, on the internal service Host only. */
    async fence(request: Request): Promise<Response | undefined> {
      const value = single(request, FENCE_HEADER);
      const hostname = new URL(request.url).hostname.toLowerCase();
      if (!value || !post(request, LIVE_FENCE_PATH)
        || options.hosts.some(({ pagesDomain }) => hostname === pagesDomain || hostname.endsWith(`.${pagesDomain}`))) return;
      const f = verifyLiveFence(value, { key: options.controller.key, now });
      if (!f || !options.controller.keyIds.includes(f.kid)) return;
      options.fences.fence({ artifactId: f.artifactId, generation: f.generation, routeEpoch: f.routeEpoch });
      return noStore();
    },
    current: async route => options.fences.isCurrent(route),
    admittedPath: options.admittedPath,
    watch: (route, revoke) => options.fences.watch(route, revoke),
  };
}
