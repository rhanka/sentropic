// Lot D B2: verified caller identity → directory → CostContext through the standalone host.
// Generated keys and an in-memory directory only; no provider call, database or secret.
import { createHash } from 'node:crypto';

import { PersonalPassthroughCallerAuth, VerifiedCostContextResolver, type CallerAuthPort } from '@sentropic/llm-gateway';
import { ServiceAuthVerifyToken } from '@sentropic/llm-gateway/auth';
import { AuthHonoVerifyToken } from '@sentropic/llm-gateway/auth-hono';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import {
  createLlmCallerIdentity,
  LlmIdentityUnavailableError,
  type LlmIdentityDirectoryPort,
  type ServiceClientRecord,
  type UserWorkspaceGrant,
} from '../../../api/src/services/llm-identity/caller-auth';
import { createHostApp } from '../src/app';
import { fixtureDependencies, testConfig } from './fixtures';

const now = new Date('2026-09-24T00:00:00Z');
const seconds = now.getTime() / 1000;
const ISSUER = 'https://issuer.test';
const RESOURCE = 'https://gateway.test';
const URL_CHAT = `${RESOURCE}/v1/chat/completions`;
const CLIENT = 'svc';
const clock = { now: () => now, addSeconds: (date: Date, s: number) => new Date(date.getTime() + s * 1000) };

const directoryFixture = () => {
  const clients = new Map<string, ServiceClientRecord>([[CLIENT, { clientId: CLIENT, tenantId: 'tenant-a', revoked: false, dpopBound: true }]]);
  const grants = new Map<string, UserWorkspaceGrant[]>([['user-1', [
    { workspaceId: 'ws-a', workspaceTenantId: 'tenant-a', workspaceHidden: false, tenantStatus: 'active', tenantMembershipStatus: 'approved' },
  ]]]);
  const state = { down: false };
  const guard = () => { if (state.down) throw new Error('ECONNREFUSED postgres://secret'); };
  const directory: LlmIdentityDirectoryPort = {
    listUserWorkspaceGrants: vi.fn(async (userId: string) => { guard(); return grants.get(userId) ?? []; }),
    findServiceClient: vi.fn(async (clientId: string) => { guard(); return clients.get(clientId) ?? null; }),
    findWorkspaceTenant: vi.fn(async (workspaceId: string) => {
      guard();
      return workspaceId === 'ws-a' ? { workspaceId, tenantId: 'tenant-a', hidden: false, tenantStatus: 'active' } : null;
    }),
  };
  const identity = createLlmCallerIdentity({
    directory,
    config: {
      issuer: ISSUER, resource: RESOURCE, source: 'llm-gateway-host', ownerMapping: [],
      serviceBindings: [{ clientId: CLIENT, tenantId: 'tenant-a', workspaceId: 'ws-a' }],
    },
  });
  return { directory, identity, clients, grants, state };
};

const serviceKeys = async () => {
  const keys = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(keys.publicKey);
  const proofKeys = await generateKeyPair('EdDSA');
  const proofJwk = await exportJWK(proofKeys.publicKey);
  const jkt = await calculateJwkThumbprint(proofJwk);
  const replay = new Set<string>();
  const auth = {
    issuer: ISSUER, resource: RESOURCE, requiredScopes: ['gateway:invoke'],
    ports: {
      clock,
      jwks: { findKeyByKid: async (kid: string) => (kid === 'key' ? { alg: 'EdDSA', publicJwk } : null),
        getActiveKey: async () => ({ alg: 'EdDSA', publicJwk }) },
      dpopReplay: { recordDpopJti: async (id: string) => { if (replay.has(id)) return false; replay.add(id); return true; } },
    },
  };
  const token = (claims: Record<string, unknown> = {}) => new SignJWT({
    iss: ISSUER, aud: RESOURCE, sub: CLIENT, client_id: CLIENT, scope: 'gateway:invoke', cnf: { jkt },
    iat: seconds, exp: seconds + 900, ...claims,
  }).setProtectedHeader({ alg: 'EdDSA', kid: 'key' }).sign(keys.privateKey);
  const proof = (accessToken: string, claims: Record<string, unknown> = {}) => new SignJWT({
    htm: 'POST', htu: URL_CHAT, ath: createHash('sha256').update(accessToken).digest('base64url'),
    iat: seconds, jti: crypto.randomUUID(), ...claims,
  }).setProtectedHeader({ alg: 'EdDSA', typ: 'dpop+jwt', jwk: proofJwk }).sign(proofKeys.privateKey);
  return { auth, token, proof };
};

const hostWith = async (callerAuth: CallerAuthPort) => {
  const fixture = fixtureDependencies();
  const host = await createHostApp({
    config: testConfig(),
    dependencies: { ...fixture.dependencies, identity: { callerAuth, ready: async () => true } },
  });
  return { app: host.app, ...fixture };
};

const chat = (headers: Record<string, string>) => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    // Forged attribution: never read by caller auth, directory state wins.
    'x-sentropic-tenant-id': 'forged-tenant', 'x-workspace-id': 'forged-ws', 'x-correlation-id': 'forged', ...headers,
  },
  body: JSON.stringify({
    model: 'gpt-fixture', messages: [{ role: 'user', content: 'hello' }],
    workspaceId: 'forged-ws', tenantId: 'forged-tenant', ownerScopeRef: 'workspace:forged:principal:x', agentId: 'forged',
  }),
});

const serviceHost = async () => {
  const dir = directoryFixture();
  const keys = await serviceKeys();
  const verifyToken = new ServiceAuthVerifyToken({
    auth: keys.auth, resolvePrincipal: (identity) => dir.identity.resolveServicePrincipal(identity),
  });
  const host = await hostWith(new PersonalPassthroughCallerAuth({ verifyToken, costContextResolver: new VerifiedCostContextResolver() }));
  return { ...dir, ...keys, ...host };
};

describe('standalone host caller auth — service identities (DPoP, service_clients)', () => {
  it('attributes a bound DPoP service call to the service principal from the directory, ignoring forged input', async () => {
    const f = await serviceHost();
    const token = await f.token();
    const response = await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${token}`, dpop: await f.proof(token) }));
    expect(response.status).toBe(200);
    expect(f.settlements).toHaveLength(1);
    const cost = f.settlements[0]!.cost;
    expect(cost).toEqual({
      tenantId: 'tenant-a', workspaceId: 'ws-a', principalId: `service:${CLIENT}`, source: 'llm-gateway-host',
      ownerScopeRef: `workspace:ws-a:principal:service:${CLIENT}`, correlationId: cost.correlationId, callSite: 'llm-gateway',
    });
    expect(cost.correlationId).not.toBe('forged');
    expect(f.generate.mock.calls[0]![0]).toMatchObject({ ownerScopeRef: `workspace:ws-a:principal:service:${CLIENT}` });
  });

  it('refuses a replayed proof, a proof for another URL or method, and a bearer use of a DPoP-bound client', async () => {
    const f = await serviceHost();
    const token = await f.token();
    const dpop = await f.proof(token);
    expect((await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${token}`, dpop }))).status).toBe(200);
    for (const headers of <Record<string, string>[]>[
      { authorization: `DPoP ${token}`, dpop },
      { authorization: `DPoP ${token}`, dpop: await f.proof(token, { htu: `${RESOURCE}/v1/messages` }) },
      { authorization: `DPoP ${token}`, dpop: await f.proof(token, { htm: 'GET' }) },
      { authorization: `Bearer ${await f.token({ cnf: undefined })}` },
    ]) {
      expect((await f.app.request(URL_CHAT, chat(headers))).status).toBe(401);
    }
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it.each([{ iss: 'https://other-issuer.test' }, { aud: 'https://other.test' }, { exp: seconds - 1 }, { scope: 'other' }])(
    'refuses %j before any directory lookup', async (claims) => {
      const f = await serviceHost();
      const token = await f.token(claims);
      expect((await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${token}`, dpop: await f.proof(token) }))).status).toBe(401);
      expect(f.directory.findServiceClient).not.toHaveBeenCalled();
      expect(f.generate).not.toHaveBeenCalled();
    });

  it.each([
    ['revoked', { revoked: true }],
    ['null tenant', { tenantId: null }],
    ['wrong tenant', { tenantId: 'tenant-b' }],
  ])('refuses a %s client with the provider-shaped 401', async (_name, patch) => {
    const f = await serviceHost();
    f.clients.set(CLIENT, { ...f.clients.get(CLIENT)!, ...patch });
    const token = await f.token();
    expect((await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${token}`, dpop: await f.proof(token) }))).status).toBe(401);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('returns the sanitized 503 (never an allow) when the directory is down', async () => {
    const f = await serviceHost();
    f.state.down = true;
    const token = await f.token();
    const response = await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${token}`, dpop: await f.proof(token) }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
    expect(f.generate).not.toHaveBeenCalled();
    await expect(f.identity.resolveServicePrincipal({ kind: 'service', issuer: ISSUER, resource: RESOURCE,
      clientId: CLIENT, scopes: [], jkt: 'x' })).rejects.toBeInstanceOf(LlmIdentityUnavailableError);
  });
});

const sessionHost = async () => {
  const dir = directoryFixture();
  const secret = new TextEncoder().encode('fixture-signing-secret-with-at-least-32-bytes');
  const token = await new SignJWT({ userId: 'user-1', sessionId: 'session-1', role: 'user' })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime(seconds + 900).sign(secret);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const session = { id: 'session-1', userId: 'user-1', expiresAt: clock.addSeconds(now, 900), revokedAt: null as Date | null };
  const ports = {
    clock, cookies: { readSessionToken: () => null },
    tokens: { hashSecret: hash, async verifySessionToken(value: string) {
      try { return (await jwtVerify(value, secret, { currentDate: now })).payload; } catch { return null; }
    } },
    sessions: { findByTokenHash: async (value: string) => (value === hash(token) ? session : null), touch: async () => {} },
    users: { findById: async () => ({ id: 'user-1', role: 'user', accountStatus: 'active' }) },
    accountPolicy: { canAuthenticate: () => ({ allowed: true }), resolveSessionRole: () => 'user' },
  };
  const verifyToken = new AuthHonoVerifyToken({
    auth: { ports } as never, resolvePrincipal: (identity) => dir.identity.resolveSessionPrincipal(identity),
  });
  const host = await hostWith(new PersonalPassthroughCallerAuth({ verifyToken, costContextResolver: new VerifiedCostContextResolver() }));
  return { ...dir, ...host, token, session };
};

describe('standalone host caller auth — session users (memberships)', () => {
  it('attributes a session call to the user in the single eligible workspace', async () => {
    const f = await sessionHost();
    expect((await f.app.request(URL_CHAT, chat({ authorization: `Bearer ${f.token}` }))).status).toBe(200);
    expect(f.settlements[0]!.cost).toMatchObject({
      tenantId: 'tenant-a', workspaceId: 'ws-a', principalId: 'user-1', ownerScopeRef: 'workspace:ws-a:principal:user-1',
    });
  });

  it('refuses ambiguous, revoked-membership, revoked-session and DPoP-scheme session calls', async () => {
    const f = await sessionHost();
    const approved = f.grants.get('user-1')![0]!;
    f.grants.set('user-1', [approved, { ...approved, workspaceId: 'ws-b' }]);
    expect((await f.app.request(URL_CHAT, chat({ authorization: `Bearer ${f.token}` }))).status).toBe(401);
    f.grants.set('user-1', [{ ...approved, tenantMembershipStatus: 'suspended' }]);
    expect((await f.app.request(URL_CHAT, chat({ authorization: `Bearer ${f.token}` }))).status).toBe(401);
    f.grants.set('user-1', [approved]);
    expect((await f.app.request(URL_CHAT, chat({ authorization: `DPoP ${f.token}` }))).status).toBe(401);
    f.session.revokedAt = now;
    expect((await f.app.request(URL_CHAT, chat({ authorization: `Bearer ${f.token}` }))).status).toBe(401);
    expect(f.generate).not.toHaveBeenCalled();
  });
});
