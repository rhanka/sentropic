import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';

import { db } from '../../src/db/client';
import { serviceClients, tenantMemberships, tenants, users, workspaceMemberships, workspaces } from '../../src/db/schema';
import {
  createLlmCallerIdentity,
  createTrustedOwnerMapping,
  LlmIdentityConfigError,
  LlmIdentityUnavailableError,
  type LlmCallerIdentityConfig,
  type ServiceCallerIdentity,
} from '../../src/services/llm-identity/caller-auth';
import { createLlmIdentityDirectory } from '../../src/services/llm-identity/directory';

const run = crypto.randomUUID().slice(0, 8);
const id = (name: string) => `llmid-${run}-${name}`;
const TENANT = id('tenant');
const OTHER_TENANT = id('other-tenant');
const USER = id('user');
const WS = id('ws');
const WS_2 = id('ws-2');
const WS_OTHER = id('ws-other');
const CLIENT = id('client');
const ISSUER = 'https://issuer.test';
const RESOURCE = 'https://gateway.test';

const config = (overrides: Partial<LlmCallerIdentityConfig> = {}): LlmCallerIdentityConfig => ({
  issuer: ISSUER,
  resource: RESOURCE,
  source: 'llm-gateway',
  serviceBindings: [{ clientId: CLIENT, tenantId: TENANT, workspaceId: WS }],
  ownerMapping: [],
  ...overrides,
});
const identity = (overrides: Partial<LlmCallerIdentityConfig> = {}) =>
  createLlmCallerIdentity({ directory: createLlmIdentityDirectory(), config: config(overrides) });
const service = (overrides: Partial<ServiceCallerIdentity> = {}): ServiceCallerIdentity => ({
  kind: 'service', issuer: ISSUER, resource: RESOURCE, clientId: CLIENT, scopes: ['gateway:invoke'], jkt: null, ...overrides,
});
const session = (userId = USER) => ({ kind: 'session' as const, userId, sessionId: `session-${userId}` });

const seed = async () => {
  await db.insert(tenants).values([
    { id: TENANT, name: TENANT, status: 'active' },
    { id: OTHER_TENANT, name: OTHER_TENANT, status: 'active' },
  ]);
  await db.insert(users).values({ id: USER, email: `${USER}@example.test` });
  await db.insert(workspaces).values([
    { id: WS, name: WS, tenantId: TENANT },
    { id: WS_2, name: WS_2, tenantId: TENANT },
    { id: WS_OTHER, name: WS_OTHER, tenantId: OTHER_TENANT },
  ]);
  await db.insert(tenantMemberships).values({ tenantId: TENANT, userId: USER, status: 'approved' });
  await db.insert(workspaceMemberships).values({ workspaceId: WS, userId: USER, role: 'editor' });
  await db.insert(serviceClients).values({
    id: CLIENT, clientId: CLIENT, clientSecretHash: 'x', allowedScopes: ['gateway:invoke'], tenantId: TENANT,
  });
};

const cleanup = async () => {
  await db.delete(serviceClients).where(like(serviceClients.clientId, `llmid-${run}-%`));
  await db.delete(workspaces).where(inArray(workspaces.id, [WS, WS_2, WS_OTHER]));
  await db.delete(users).where(eq(users.id, USER));
  await db.delete(tenants).where(inArray(tenants.id, [TENANT, OTHER_TENANT]));
};

beforeEach(async () => {
  await cleanup();
  await seed();
});
afterEach(cleanup);

describe('LLM identity directory — session users (existing memberships)', () => {
  it('resolves the single eligible workspace with its authoritative tenant and owner scope', async () => {
    await expect(identity().resolveSessionPrincipal(session())).resolves.toEqual({
      tenantId: TENANT, principalId: USER, workspaceId: WS, source: 'llm-gateway',
      ownerScopeRef: `workspace:${WS}:principal:${USER}`,
    });
  });

  it('refuses an ambiguous membership set without a trusted selection', async () => {
    await db.insert(workspaceMemberships).values({ workspaceId: WS_2, userId: USER, role: 'viewer' });
    await expect(identity().resolveSessionPrincipal(session())).resolves.toBeUndefined();
  });

  it('observes a revoked tenant membership on the next admission (no cache)', async () => {
    const resolver = identity();
    await expect(resolver.resolveSessionPrincipal(session())).resolves.toBeDefined();
    await db.update(tenantMemberships).set({ status: 'suspended' }).where(eq(tenantMemberships.userId, USER));
    await expect(resolver.resolveSessionPrincipal(session())).resolves.toBeUndefined();
  });

  it('observes a removed workspace membership and refuses a user without memberships', async () => {
    const resolver = identity();
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.userId, USER));
    await expect(resolver.resolveSessionPrincipal(session())).resolves.toBeUndefined();
    await expect(resolver.resolveSessionPrincipal(session(id('unknown')))).resolves.toBeUndefined();
  });

  it('ignores workspaces whose tenant the user is not an approved member of, hidden or suspended', async () => {
    await db.insert(workspaceMemberships).values({ workspaceId: WS_OTHER, userId: USER, role: 'admin' });
    await expect(identity().resolveSessionPrincipal(session())).resolves.toMatchObject({ workspaceId: WS });
    await db.update(workspaces).set({ hiddenAt: new Date() }).where(eq(workspaces.id, WS));
    await expect(identity().resolveSessionPrincipal(session())).resolves.toBeUndefined();
    await db.update(workspaces).set({ hiddenAt: null }).where(eq(workspaces.id, WS));
    await db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, TENANT));
    await expect(identity().resolveSessionPrincipal(session())).resolves.toBeUndefined();
  });

  it('applies the trusted owner mapping: a conflicting owner is refused, a matching one kept', async () => {
    const ownerScopeRef = `workspace:${WS}:principal:${USER}`;
    await expect(identity({ ownerMapping: [{ ownerScopeRef, ownerUserId: id('someone-else') }] })
      .resolveSessionPrincipal(session())).resolves.toBeUndefined();
    await expect(identity({ ownerMapping: [{ ownerScopeRef, ownerUserId: USER }] })
      .resolveSessionPrincipal(session())).resolves.toMatchObject({ ownerScopeRef, principalId: USER });
  });
});

describe('LLM identity directory — service clients (service_clients.tenant_id)', () => {
  it('attributes to the service identity, never to a user id', async () => {
    const principal = await identity().resolveServicePrincipal(service());
    expect(principal).toEqual({
      tenantId: TENANT, principalId: `service:${CLIENT}`, workspaceId: WS, source: 'llm-gateway',
      ownerScopeRef: `workspace:${WS}:principal:service:${CLIENT}`,
    });
  });

  it('refuses a revoked, unknown, null-tenant or wrong-tenant client', async () => {
    const resolver = identity();
    await db.update(serviceClients).set({ revokedAt: new Date() }).where(eq(serviceClients.clientId, CLIENT));
    await expect(resolver.resolveServicePrincipal(service())).resolves.toBeUndefined();
    await db.update(serviceClients).set({ revokedAt: null, tenantId: null }).where(eq(serviceClients.clientId, CLIENT));
    await expect(resolver.resolveServicePrincipal(service())).resolves.toBeUndefined();
    await db.update(serviceClients).set({ tenantId: OTHER_TENANT }).where(eq(serviceClients.clientId, CLIENT));
    await expect(resolver.resolveServicePrincipal(service())).resolves.toBeUndefined();
    await db.delete(serviceClients).where(eq(serviceClients.clientId, CLIENT));
    await expect(resolver.resolveServicePrincipal(service())).resolves.toBeUndefined();
  });

  it('requires a trusted binding whose workspace lives in the client tenant', async () => {
    await expect(identity({ serviceBindings: [] }).resolveServicePrincipal(service())).resolves.toBeUndefined();
    await expect(identity({ serviceBindings: [{ clientId: CLIENT, tenantId: TENANT, workspaceId: WS_OTHER }] })
      .resolveServicePrincipal(service())).resolves.toBeUndefined();
    await expect(identity({ serviceBindings: [{ clientId: CLIENT, tenantId: TENANT, workspaceId: id('missing') }] })
      .resolveServicePrincipal(service())).resolves.toBeUndefined();
  });

  it('refuses a different issuer/resource and an unbound bearer for a DPoP-bound client', async () => {
    const resolver = identity();
    await expect(resolver.resolveServicePrincipal(service({ issuer: 'https://other.test' }))).resolves.toBeUndefined();
    await expect(resolver.resolveServicePrincipal(service({ resource: 'https://other.test' }))).resolves.toBeUndefined();
    await expect(resolver.resolveServicePrincipal(service({ issuer: `${ISSUER}/` }))).resolves.toBeDefined();
    await db.update(serviceClients).set({ dpopBoundAccessTokens: true }).where(eq(serviceClients.clientId, CLIENT));
    await expect(resolver.resolveServicePrincipal(service())).resolves.toBeUndefined();
    await expect(resolver.resolveServicePrincipal(service({ jkt: 'thumbprint' }))).resolves.toBeDefined();
  });

  it('refuses a service claiming a user-owned seat scope', async () => {
    const ownerScopeRef = `workspace:${WS}:principal:service:${CLIENT}`;
    await expect(identity({ ownerMapping: [{ ownerScopeRef, ownerUserId: USER }] })
      .resolveServicePrincipal(service())).resolves.toBeUndefined();
  });
});

describe('LLM identity directory — outage and configuration', () => {
  it('turns a database outage into a sanitized unavailable error, never an allow', async () => {
    const broken = createLlmIdentityDirectory({ select: () => { throw new Error('ECONNREFUSED postgres://secret'); } } as never);
    const resolver = createLlmCallerIdentity({ directory: broken, config: config() });
    for (const attempt of [resolver.resolveServicePrincipal(service()), resolver.resolveSessionPrincipal(session())]) {
      const error = await attempt.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmIdentityUnavailableError);
      expect(String((error as Error).message)).not.toContain('secret');
    }
  });

  it('refuses ambiguous or malformed trusted configuration at construction', () => {
    const ref = `workspace:${WS}:principal:${USER}`;
    expect(() => createTrustedOwnerMapping([{ ownerScopeRef: ref, ownerUserId: USER }, { ownerScopeRef: ref, ownerUserId: USER }]))
      .toThrow(LlmIdentityConfigError);
    expect(() => createTrustedOwnerMapping([{ ownerScopeRef: `${USER}`, ownerUserId: USER }])).toThrow(LlmIdentityConfigError);
    const binding = { clientId: CLIENT, tenantId: TENANT, workspaceId: WS };
    expect(() => identity({ serviceBindings: [binding, binding] })).toThrow(LlmIdentityConfigError);
    expect(() => identity({ issuer: '/relative' })).toThrow(LlmIdentityConfigError);
    expect(() => identity({ source: ' ' })).toThrow(LlmIdentityConfigError);
  });
});
