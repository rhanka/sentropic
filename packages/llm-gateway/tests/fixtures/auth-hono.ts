import { createHash } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import type { AuthHonoPorts, AuthHonoSessionClaims } from '@sentropic/auth-hono/ports';
import type { ServiceAuthVerifyTokenOptions } from '../../src/caller-auth/service-auth.js';

export const now = new Date('2026-09-24T00:00:00Z');
export const issuer = 'https://issuer.test';
export const resource = 'https://gateway.test';
export const authContext = { method: 'POST', url: `${resource}/v1/messages`, requestId: 'generated' };
export const principal = { tenantId: 't', principalId: 'p', ownerScopeRef: 'enrolled:p', source: 'test' };
export const clock = { now: () => now,
  addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000) };

export const authFixture = async () => {
  const keys = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(keys.publicKey);
  const proofKeys = await generateKeyPair('EdDSA');
  const proofJwk = await exportJWK(proofKeys.publicKey);
  const jkt = await calculateJwkThumbprint(proofJwk);
  const replay = new Set<string>();
  const auth: ServiceAuthVerifyTokenOptions['auth'] = {
    issuer, resource, requiredScopes: ['gateway:invoke'], contextKey: 'verifiedCaller',
    ports: { clock,
      jwks: { findKeyByKid: async kid => kid === 'key' ? { alg: 'EdDSA', publicJwk } : null,
        getActiveKey: async () => ({ alg: 'EdDSA', publicJwk }) },
      dpopReplay: { async recordDpopJti(id) {
        if (replay.has(id)) return false;
        replay.add(id); return true;
      } },
    },
  };
  const token = (claims: Record<string, unknown> = {}) => new SignJWT({
    iss: issuer, aud: resource, sub: 'service', client_id: 'service', scope: 'gateway:invoke',
    iat: now.getTime() / 1000, exp: now.getTime() / 1000 + 900, ...claims,
  }).setProtectedHeader({ alg: 'EdDSA', kid: 'key' }).sign(keys.privateKey);
  const proof = (accessToken: string, claims: Record<string, unknown> = {}) => new SignJWT({
    htm: authContext.method, htu: authContext.url,
    ath: createHash('sha256').update(accessToken).digest('base64url'),
    iat: now.getTime() / 1000, jti: crypto.randomUUID(), ...claims,
  }).setProtectedHeader({ alg: 'EdDSA', typ: 'dpop+jwt', jwk: proofJwk }).sign(proofKeys.privateKey);
  return { auth, token, proof, jkt };
};

export const sessionFixture = async (id = 'user') => {
  const secret = new TextEncoder().encode('fixture-signing-secret-with-at-least-32-bytes');
  const claims: AuthHonoSessionClaims = { userId: id, sessionId: `session-${id}`, role: 'user' };
  const token = await new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(now.getTime() / 1000 + 900).sign(secret);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const session = { id: `session-${id}`, userId: id, expiresAt: clock.addSeconds(now, 900), revokedAt: null as Date | null };
  const user = { id, role: 'user', accountStatus: 'active' };
  const ports = {
    clock, cookies: { readSessionToken: () => null },
    tokens: { hashSecret: hash, async verifySessionToken(value: string) {
      try { return (await jwtVerify(value, secret, { currentDate: now })).payload as unknown as AuthHonoSessionClaims; }
      catch { return null; }
    } },
    sessions: { findByTokenHash: async (value: string) => value === hash(token) ? session : null, touch: async () => {} },
    users: { findById: async () => user },
    accountPolicy: { canAuthenticate: () => ({ allowed: user.accountStatus === 'active' }),
      resolveSessionRole: () => 'user' },
  } as unknown as AuthHonoPorts;
  return { token, ports, session, user };
};
