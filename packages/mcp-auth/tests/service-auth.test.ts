// Canonical RS middleware (relocated from auth-hono, architect verdict E2/F8). Uses the REAL
// @sentropic/oauth-verify (no mock) so the token + DPoP round-trip is genuine.
import { Hono } from 'hono';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createRequireServiceAuth,
  type ServiceAuthContext,
  type ServiceAuthPorts,
} from '../src/hono.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'http://localhost:9197';
const resource = 'https://api.sentropic.test';
const htu = 'http://localhost/internal/ping';

const clock = {
  addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
  now: () => now,
};

let signingKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA');
  signingKey = pair.privateKey as CryptoKey;
  publicJwk = await exportJWK(pair.publicKey);
});

const buildPorts = (): ServiceAuthPorts => {
  const usedJtis = new Set<string>();
  return {
    clock,
    dpopReplay: {
      async recordDpopJti(jti) {
        if (usedJtis.has(jti)) return false;
        usedJtis.add(jti);
        return true;
      },
    },
    jwks: {
      async findKeyByKid(kid) {
        return kid === 'kid-1' ? { alg: 'EdDSA', publicJwk } : null;
      },
      async getActiveKey() {
        return { alg: 'EdDSA', publicJwk };
      },
    },
  };
};

const signAccessToken = async (
  claims: Record<string, unknown> = {},
  options: { audience?: string; expiresAt?: Date } = {}
): Promise<string> =>
  new SignJWT({ client_id: 'service-rp', scope: 'service:ping service:read', ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'kid-1' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setIssuer(issuer)
    .setAudience(options.audience ?? resource)
    .setSubject('service-rp')
    .setExpirationTime(Math.floor((options.expiresAt ?? clock.addSeconds(now, 900)).getTime() / 1000))
    .sign(signingKey);

const buildApp = (ports: ServiceAuthPorts, requiredScopes = ['service:ping']): Hono => {
  const app = new Hono();
  app.get(
    '/internal/ping',
    createRequireServiceAuth({ issuer, ports, requiredScopes, resource }),
    (c) => c.json({ ok: true, serviceClient: c.get('serviceClient') as ServiceAuthContext })
  );
  return app;
};

const sha256Base64url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const createDpopProof = async (input: {
  accessToken: string;
  jti: string;
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  ath?: string;
}): Promise<string> => {
  const ath = input.ath ?? (await sha256Base64url(input.accessToken));
  return new SignJWT({ ath, htm: 'GET', htu, iat: Math.floor(now.getTime() / 1000), jti: input.jti })
    .setProtectedHeader({ alg: 'EdDSA', jwk: await exportJWK(input.keyPair.publicKey), typ: 'dpop+jwt' })
    .sign(input.keyPair.privateKey);
};

describe('createRequireServiceAuth (canonical home in @sentropic/mcp-auth/hono)', () => {
  it('accepts a valid Bearer token and exposes the service context', async () => {
    const app = buildApp(buildPorts());
    const token = await signAccessToken();

    const response = await app.request(htu, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { serviceClient: ServiceAuthContext };
    expect(body.serviceClient).toMatchObject({ clientId: 'service-rp', jkt: null });
    expect(body.serviceClient.scopes).toContain('service:ping');
  });

  it('accepts a valid DPoP-bound token with a matching proof and rejects replays', async () => {
    const app = buildApp(buildPorts());
    const proofKey = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    const token = await signAccessToken({ cnf: { jkt } });
    const proof = await createDpopProof({ accessToken: token, jti: 'p-1', keyPair: proofKey });

    const first = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });
    const second = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });

    expect(first.status).toBe(200);
    expect((await first.json()) as { serviceClient: ServiceAuthContext }).toMatchObject({ serviceClient: { jkt } });
    expect(second.status).toBe(401); // replay
  });

  it('rejects missing auth (401 Bearer challenge), wrong audience, and insufficient scope (403)', async () => {
    const app = buildApp(buildPorts());

    const missing = await app.request(htu);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');

    const wrongAud = await app.request(htu, {
      headers: { authorization: `Bearer ${await signAccessToken({}, { audience: 'https://other.test' })}` },
    });
    expect(wrongAud.status).toBe(401);

    const lowScope = buildApp(buildPorts(), ['service:admin']);
    const forbidden = await lowScope.request(htu, { headers: { authorization: `Bearer ${await signAccessToken()}` } });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'insufficient_scope' } });
  });
});
