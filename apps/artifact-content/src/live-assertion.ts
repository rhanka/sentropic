import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseContentHost } from '@sentropic/artifacts/content/routing';
import { podName } from '../../../api/src/services/artifacts/live/pods';
import type { LiveProxyPorts, LiveRoute } from './live';

/**
 * A-LIVE §8.2 live edge for a host-owned pages domain (W9 / M4-E).
 * The host (immo's content host) evaluates the reader gate (owner or invitee, code rights, live consent),
 * strips browser credentials, and forwards with ONE signed assertion per live session. This edge never
 * evaluates the gate itself and never forwards the assertion or any credential to Vite.
 */
export const ASSERTION_HEADER = 'x-live-host-assertion';
export const MIN_KEY_BYTES = 32;
export const MAX_ASSERTION_SECONDS = 3600;
const MAX_SKEW_SECONDS = 30;

export interface LiveAssertionClaims {
  v: 1; kid: string; host: string; artifactId: string; storageScopeId: string; sessionId: string;
  generation: number; routeEpoch: number; podUid: string; podName: string; sourceRevision: number;
  principalId: string; role: 'binding_owner' | 'invitee'; invitationId: string; invitationEpoch: number; invitationExp: number;
  iat: number; exp: number;
}
const FIELDS: Record<keyof LiveAssertionClaims, 'string' | 'number'> = {
  v: 'number', kid: 'string', host: 'string', artifactId: 'string', storageScopeId: 'string', sessionId: 'string',
  generation: 'number', routeEpoch: 'number', podUid: 'string', podName: 'string', sourceRevision: 'number',
  principalId: 'string', role: 'string', invitationId: 'string', invitationEpoch: 'number', invitationExp: 'number', iat: 'number', exp: 'number',
};
const mac = (key: Uint8Array, body: string) => createHmac('sha256', key).update(`v1.${body}`).digest();

export function signLiveAssertion(claims: LiveAssertionClaims, key: Uint8Array): string {
  if (key.length < MIN_KEY_BYTES) throw new Error('Live assertion key must contain at least 32 bytes');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `v1.${body}.${mac(key, body).toString('base64url')}`;
}
const INVITATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Owner claims carry no invitation; an invitee claim must name a live invitation that outlasts the assertion. */
function validRole(c: LiveAssertionClaims, now: number) {
  if (c.role === 'binding_owner') return c.invitationId === '' && c.invitationEpoch === 0 && c.invitationExp === 0;
  return c.role === 'invitee' && INVITATION_ID.test(c.invitationId) && c.invitationEpoch >= 1
    && c.invitationExp > now && c.exp <= c.invitationExp;
}
export interface VerifyOptions { key(kid: string): Uint8Array | undefined; now(): number }
export function verifyLiveAssertion(token: string, options: VerifyOptions): LiveAssertionClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || token.length > 2048) return;
  let claims: LiveAssertionClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || claims.v !== 1
      || Object.keys(claims).sort().join() !== Object.keys(FIELDS).sort().join()
      || Object.entries(FIELDS).some(([name, type]) => typeof claims[name as keyof LiveAssertionClaims] !== type)) return;
  } catch { return; }
  const key = options.key(claims.kid);
  if (!key || key.length < MIN_KEY_BYTES) return;
  const given = Buffer.from(parts[2], 'base64url'); const expected = mac(key, parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return;
  const now = options.now() / 1000;
  if (!validRole(claims, now)) return;
  if (claims.exp <= now || claims.iat > now + MAX_SKEW_SECONDS || claims.exp - claims.iat > MAX_ASSERTION_SECONDS) return;
  return claims;
}

/** In-memory revocation state pushed by the host/controller; watchers close live sockets immediately. */
export function createLiveFences() {
  const floors = new Map<string, { generation: number; routeEpoch: number }>();
  const invitationFloors = new Map<string, number>(); // `${artifactId}/${invitationId}` -> minimum live epoch
  const revoked = new Map<string, number>(); // `${artifactId}/${sessionId}` -> forget-after (ms)
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
  return {
    isCurrent: (route: LiveRoute) => !stale(route),
    revoke(input: { artifactId: string; sessionId: string; forgetAfter?: number }) {
      const now = Date.now();
      for (const [key, until] of revoked) if (until <= now) revoked.delete(key);
      revoked.set(`${input.artifactId}/${input.sessionId}`, input.forgetAfter ?? now + MAX_ASSERTION_SECONDS * 1000);
      sweep(input.artifactId);
    },
    /** Invitation revocation: the host bumps the epoch; every older assertion and open socket for it is refused/closed. */
    revokeInvitation(input: { artifactId: string; invitationId: string; epoch: number }) {
      const id = `${input.artifactId}/${input.invitationId}`;
      invitationFloors.set(id, Math.max(input.epoch, invitationFloors.get(id) ?? 0));
      sweep(input.artifactId);
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

export interface HostAssertionLiveOptions {
  /** One entry per host-owned pages domain; only the listed key ids may assert for it. */
  hosts: { pagesDomain: string; keyIds: string[] }[];
  key(kid: string): Uint8Array | undefined;
  fences: LiveFences;
  /** The host's staged-source / dependency manifest check. */
  admittedPath: LiveProxyPorts['admittedPath'];
  now?: () => number; fetch?: typeof fetch;
}
export function createHostAssertionLive(options: HostAssertionLiveOptions): LiveProxyPorts & Required<Pick<LiveProxyPorts, 'origin'>> {
  const now = options.now ?? Date.now;
  const domainFor = (host: string) => options.hosts.find(entry => parseContentHost(host, entry.pagesDomain));
  const origin = (host: string) => {
    const entry = domainFor(host); return entry ? parseContentHost(host, entry.pagesDomain) : undefined;
  };
  return {
    origin, fetch: options.fetch, now,
    async authorize(request: Request, artifactId: string): Promise<LiveRoute | undefined> {
      const values = request.headers.get(ASSERTION_HEADER);
      if (!values || values.includes(',')) return; // duplicate headers are joined with a comma
      const url = new URL(request.url); const entry = domainFor(url.host);
      if (!entry || origin(url.host)?.id !== artifactId) return;
      const claims = verifyLiveAssertion(values, { key: options.key, now });
      if (!claims || !entry.keyIds.includes(claims.kid) || claims.host !== url.host.toLowerCase()
        || claims.artifactId !== artifactId || claims.podName !== podName(claims)) return;
      const route: LiveRoute = { storageScopeId: claims.storageScopeId, artifactId, sessionId: claims.sessionId,
        generation: claims.generation, routeEpoch: claims.routeEpoch, podUid: claims.podUid, podName: claims.podName,
        expiresAt: (claims.role === 'invitee' ? Math.min(claims.exp, claims.invitationExp) : claims.exp) * 1000,
        sourceRevision: claims.sourceRevision, principalId: claims.principalId, role: claims.role,
        ...(claims.role === 'invitee' ? { invitationId: claims.invitationId, invitationEpoch: claims.invitationEpoch } : {}) };
      return options.fences.isCurrent(route) ? route : undefined;
    },
    current: async route => options.fences.isCurrent(route),
    admittedPath: options.admittedPath,
    watch: (route, revoke) => options.fences.watch(route, revoke),
  };
}
