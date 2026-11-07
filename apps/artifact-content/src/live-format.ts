import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A-LIVE §8.2 live edge wire format (W9 / M4-E), pure and dependency-free so the host (immo), the controller
 * (Sentropic API) and `artifact-content` sign and verify with the same code. Three HMAC-SHA256 message kinds, each
 * with its own MAC-bound prefix so none can be replayed as another:
 * - `v1` host assertion (immo → artifact-content), on every live request and websocket upgrade;
 * - `c1` host control (immo → artifact-content): session or invitation revocation;
 * - `f1` controller fence (Sentropic API → artifact-content): generation and route-epoch floor.
 */
export const ASSERTION_HEADER = 'x-live-host-assertion';
export const CONTROL_HEADER = 'x-live-host-control';
export const FENCE_HEADER = 'x-live-controller-fence';
export const MIN_KEY_BYTES = 32;
export const MAX_ASSERTION_SECONDS = 3600;
export const MAX_CONTROL_SECONDS = 300;
export const MAX_SKEW_SECONDS = 30;

export interface LiveAssertionClaims {
  v: 1; kid: string; host: string; artifactId: string; storageScopeId: string; sessionId: string;
  generation: number; routeEpoch: number; podUid: string; podName: string; sourceRevision: number;
  principalId: string; role: 'binding_owner' | 'invitee'; invitationId: string; invitationEpoch: number; invitationExp: number;
  iat: number; exp: number;
}
/** Host revocation; `epoch` is the invitation's new floor: every assertion below it is refused. */
export interface LiveControlClaims {
  v: 1; kid: string; host: string; artifactId: string; op: 'revoke_session' | 'revoke_invitation';
  sessionId: string; invitationId: string; epoch: number; iat: number; exp: number;
}
/** Controller fence: routes below this generation, or below this route epoch within it, are refused. */
export interface LiveFenceClaims { v: 1; kid: string; artifactId: string; generation: number; routeEpoch: number; iat: number; exp: number }
export interface VerifyOptions { key(kid: string): Uint8Array | undefined; now(): number }

type Signed = { v: 1; kid: string; iat: number; exp: number };
type Fields<T> = Record<keyof T, 'string' | 'number'>;
const ASSERTION_FIELDS: Fields<LiveAssertionClaims> = {
  v: 'number', kid: 'string', host: 'string', artifactId: 'string', storageScopeId: 'string', sessionId: 'string',
  generation: 'number', routeEpoch: 'number', podUid: 'string', podName: 'string', sourceRevision: 'number',
  principalId: 'string', role: 'string', invitationId: 'string', invitationEpoch: 'number', invitationExp: 'number', iat: 'number', exp: 'number',
};
const CONTROL_FIELDS: Fields<LiveControlClaims> = {
  v: 'number', kid: 'string', host: 'string', artifactId: 'string', op: 'string', sessionId: 'string',
  invitationId: 'string', epoch: 'number', iat: 'number', exp: 'number',
};
const FENCE_FIELDS: Fields<LiveFenceClaims> = {
  v: 'number', kid: 'string', artifactId: 'string', generation: 'number', routeEpoch: 'number', iat: 'number', exp: 'number',
};
const mac = (key: Uint8Array, prefix: string, body: string) => createHmac('sha256', key).update(`${prefix}.${body}`).digest();
function sign(prefix: string, claims: Signed, key: Uint8Array) {
  if (key.length < MIN_KEY_BYTES) throw new Error('Live key must contain at least 32 bytes');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${prefix}.${body}.${mac(key, prefix, body).toString('base64url')}`;
}
function verify<T extends Signed>(prefix: string, fields: Fields<T>, maxSeconds: number, token: string, options: VerifyOptions) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== prefix || token.length > 2048) return;
  let claims: T;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || claims.v !== 1
      || Object.keys(claims).sort().join() !== Object.keys(fields).sort().join()
      || Object.entries(fields).some(([name, type]) => {
        const value = claims[name as keyof T];
        return typeof value !== type || (type === 'number' && (!Number.isSafeInteger(value) || (value as number) < 0));
      })) return;
  } catch { return; }
  const key = options.key(claims.kid);
  if (!key || key.length < MIN_KEY_BYTES) return;
  const given = Buffer.from(parts[2], 'base64url'); const expected = mac(key, prefix, parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return;
  const now = options.now() / 1000;
  if (claims.exp <= now || claims.iat > now + MAX_SKEW_SECONDS || claims.exp - claims.iat > maxSeconds) return;
  return claims;
}
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Owner claims carry no invitation; an invitee claim must name a live invitation that outlasts the assertion. */
function validRole(c: LiveAssertionClaims, now: number) {
  if (c.role === 'binding_owner') return c.invitationId === '' && c.invitationEpoch === 0 && c.invitationExp === 0;
  return c.role === 'invitee' && ID.test(c.invitationId) && c.invitationEpoch >= 1
    && c.invitationExp > now && c.exp <= c.invitationExp;
}
function validControl(c: LiveControlClaims) {
  if (c.op === 'revoke_session') return ID.test(c.sessionId) && c.invitationId === '' && c.epoch === 0;
  return c.op === 'revoke_invitation' && ID.test(c.invitationId) && c.epoch >= 1 && c.sessionId === '';
}
export const signLiveAssertion = (claims: LiveAssertionClaims, key: Uint8Array) => sign('v1', claims, key);
export const signLiveControl = (claims: LiveControlClaims, key: Uint8Array) => sign('c1', claims, key);
export const signLiveFence = (claims: LiveFenceClaims, key: Uint8Array) => sign('f1', claims, key);
export function verifyLiveAssertion(token: string, options: VerifyOptions): LiveAssertionClaims | undefined {
  const claims = verify('v1', ASSERTION_FIELDS, MAX_ASSERTION_SECONDS, token, options);
  return claims && validRole(claims, options.now() / 1000) ? claims : undefined;
}
export function verifyLiveControl(token: string, options: VerifyOptions): LiveControlClaims | undefined {
  const claims = verify('c1', CONTROL_FIELDS, MAX_CONTROL_SECONDS, token, options);
  return claims && validControl(claims) ? claims : undefined;
}
export function verifyLiveFence(token: string, options: VerifyOptions): LiveFenceClaims | undefined {
  const claims = verify('f1', FENCE_FIELDS, MAX_CONTROL_SECONDS, token, options);
  return claims && claims.generation >= 1 ? claims : undefined;
}
