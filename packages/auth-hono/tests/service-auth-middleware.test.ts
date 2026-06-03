import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  createRequireServiceAuth,
  type JwksKeyRecord,
  type ServiceAuthContext,
  type ServiceAuthPorts,
} from '../src/index.js';
import { createJwksKeyRecord, createMemoryJwksPort } from './__fixtures__/memory-jwks.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const issuer = 'http://localhost:9197';
const resource = 'https://api.sentropic.test';
const htu = 'http://localhost/internal/ping';

const clock = {
  addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
  now: () => now,
};

const buildPorts = async (overrides: Partial<ServiceAuthPorts> = {}): Promise<{ key: JwksKeyRecord; ports: ServiceAuthPorts }> => {
  const key = await createJwksKeyRecord({ active: true, kid: 'kid-1', now });
  const usedJtis = new Set<string>();
  const ports: ServiceAuthPorts = {
    clock,
    dpopReplay: {
      async recordDpopJti(jti) {
        if (usedJtis.has(jti)) return false;
        usedJtis.add(jti);
        return true;
      },
    },
    jwks: createMemoryJwksPort([key]),
    ...overrides,
  };
  return { key, ports };
};

const signAccessToken = async (
  key: JwksKeyRecord,
  claims: Record<string, unknown> = {},
  options: { audience?: string; expiresAt?: Date; issuer?: string } = {}
): Promise<string> =>
  new SignJWT({ client_id: 'service-rp', scope: 'service:ping service:read', ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? resource)
    .setSubject('service-rp')
    .setExpirationTime(Math.floor((options.expiresAt ?? clock.addSeconds(now, 900)).getTime() / 1000))
    .sign(key.privateKey!);

const buildApp = (ports: ServiceAuthPorts, requiredScopes = ['service:ping']): Hono => {
  const app = new Hono();
  app.get(
    '/internal/ping',
    createRequireServiceAuth({ issuer, ports, requiredScopes, resource }),
    (c) => c.json({ ok: true, serviceClient: c.get('serviceClient') as ServiceAuthContext })
  );
  return app;
};

const createDpopProof = async (input: {
  accessToken: string;
  htu: string;
  jti: string;
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  ath?: string;
}): Promise<string> => {
  const ath = input.ath ?? (await sha256Base64url(input.accessToken));
  return new SignJWT({ ath, htm: 'GET', htu: input.htu, iat: Math.floor(now.getTime() / 1000), jti: input.jti })
    .setProtectedHeader({ alg: 'EdDSA', jwk: await exportJWK(input.keyPair.publicKey), typ: 'dpop+jwt' })
    .sign(input.keyPair.privateKey);
};

const sha256Base64url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

describe('createRequireServiceAuth', () => {
  it('accepts a valid Bearer token and exposes the service context', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const token = await signAccessToken(key);

    const response = await app.request(htu, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { serviceClient: ServiceAuthContext };
    expect(body.serviceClient).toMatchObject({ clientId: 'service-rp', jkt: null });
    expect(body.serviceClient.scopes).toContain('service:ping');
  });

  it('accepts a valid DPoP-bound token with a matching proof', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const proofKey = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    const token = await signAccessToken(key, { cnf: { jkt } });
    const proof = await createDpopProof({ accessToken: token, htu, jti: 'p-1', keyPair: proofKey });

    const response = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });

    expect(response.status).toBe(200);
    expect((await response.json()) as { serviceClient: ServiceAuthContext }).toMatchObject({
      serviceClient: { jkt },
    });
  });

  it('rejects a missing Authorization header with 401', async () => {
    const { ports } = await buildPorts();
    const app = buildApp(ports);

    const response = await app.request(htu);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('rejects a token with a bad signature', async () => {
    const { ports } = await buildPorts();
    const app = buildApp(ports);
    const foreignKey = await createJwksKeyRecord({ active: true, kid: 'kid-1', now });
    const forged = await signAccessToken(foreignKey);

    const response = await app.request(htu, { headers: { authorization: `Bearer ${forged}` } });

    expect(response.status).toBe(401);
  });

  it('rejects a token with the wrong audience', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const token = await signAccessToken(key, {}, { audience: 'https://other.example.test' });

    const response = await app.request(htu, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const token = await signAccessToken(key, {}, { expiresAt: new Date('2025-12-31T23:00:00.000Z') });

    const response = await app.request(htu, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(401);
  });

  it('rejects a token that is missing a required scope with 403', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports, ['service:admin']);
    const token = await signAccessToken(key);

    const response = await app.request(htu, { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(403);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'insufficient_scope' },
    });
  });

  it('rejects a DPoP-bound token presented without a proof', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const proofKey = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    const token = await signAccessToken(key, { cnf: { jkt } });

    const response = await app.request(htu, { headers: { authorization: `DPoP ${token}` } });

    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_dpop_proof' },
    });
  });

  it('rejects a replayed DPoP proof on the second request', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const proofKey = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    const token = await signAccessToken(key, { cnf: { jkt } });
    const proof = await createDpopProof({ accessToken: token, htu, jti: 'replay-1', keyPair: proofKey });

    const first = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });
    const second = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  it('rejects a DPoP proof whose ath does not match the access token', async () => {
    const { key, ports } = await buildPorts();
    const app = buildApp(ports);
    const proofKey = await generateKeyPair('EdDSA');
    const jkt = await calculateJwkThumbprint(await exportJWK(proofKey.publicKey));
    const token = await signAccessToken(key, { cnf: { jkt } });
    const proof = await createDpopProof({
      accessToken: token,
      ath: 'tampered-ath-value',
      htu,
      jti: 'ath-1',
      keyPair: proofKey,
    });

    const response = await app.request(htu, { headers: { authorization: `DPoP ${token}`, dpop: proof } });

    expect(response.status).toBe(401);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'invalid_dpop_proof' },
    });
  });
});
