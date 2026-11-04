// Lot G3 (P3, A4 item 4, design a4-cm-gaps-r2.md §7/§10.4): the CM-owned
// service-principal `tid` issuer. Full decision table over local doubles
// (G1 is delayed, so the OAuth read surface is a local fixture — no copy of
// G1's finder lands here), plus the auth-hono binding integration on both
// durable profiles via the a20b harness.

import { describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AuthHonoPorts, AuthHonoServiceTenantPort } from '@sentropic/auth-hono';
import {
  createHs256EmailTicketPort,
  createNodeIdentityDigestPort,
  IdentityCustodyErrorV1,
  InMemoryIdentityAudit,
  InMemoryTenantRegistryStore,
  createServicePrincipalTidIssuerV1,
  type ServiceClientBinding,
  type ServiceTenantBindingSourceV1,
  type ServiceTenantEnrollmentSourceV1,
  type TenantRecord,
  type TenantStatus,
} from '../../src/index.js';
import { createIdentityAuthHonoTransactionBindingV1 } from '../../src/identity/auth-hono.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

/** Local stand-in for G1's `OAuthTenantStoreV1.findServiceClientBinding`. */
class FixtureServiceBindingReads implements ServiceTenantBindingSourceV1 {
  private readonly bindings = new Map<string, ServiceClientBinding>();

  bind(record: ServiceClientBinding): void {
    this.bindings.set(record.clientId, record);
  }

  async findServiceClientBinding(clientId: string): Promise<ServiceClientBinding | null> {
    return this.bindings.get(clientId) ?? null;
  }
}

const enrollmentsOf = (map: Record<string, readonly string[]>): ServiceTenantEnrollmentSourceV1 => ({
  listEnrolledTenantIds: async (clientId: string) => map[clientId] ?? [],
});

const seedTenants = async (tenants: InMemoryTenantRegistryStore, defs: readonly { tenantId: string; slug: string; status: TenantStatus }[]): Promise<void> => {
  for (const def of defs) {
    const record: TenantRecord = { ...def, createdAt: NOW };
    await tenants.createTenant(record);
  }
};

const makeIssuer = (input: {
  readonly tenants: InMemoryTenantRegistryStore;
  readonly oauth: FixtureServiceBindingReads;
  readonly enrollments?: ServiceTenantEnrollmentSourceV1;
  readonly audit?: InMemoryIdentityAudit;
}) => createServicePrincipalTidIssuerV1({
  tenants: input.tenants,
  oauth: input.oauth,
  enrollments: input.enrollments,
  audit: input.audit,
  clock: () => NOW,
});

describe('P3 service-principal tid issuer over doubles', () => {
  it('refuses no_authorized_tenant when the client has no binding and no enrollments', async () => {
    const issuer = makeIssuer({ tenants: new InMemoryTenantRegistryStore(), oauth: new FixtureServiceBindingReads() });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'acme' }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
  });

  it('binds the single fixed active tenant when the selector is omitted or matches', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-acme', slug: 'acme', status: 'active' }]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const issuer = makeIssuer({ tenants, oauth });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: true, claim: { tid: 'acme', tenantId: 't-acme', clientId: 'svc', source: 'service_client', issuedAt: NOW } });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'acme' }))
      .toEqual({ issued: true, claim: { tid: 'acme', tenantId: 't-acme', clientId: 'svc', source: 'service_client', issuedAt: NOW } });
  });

  it('refuses tenant_not_authorized when a single fixed tenant mismatches the selector', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-acme', slug: 'acme', status: 'active' }]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const issuer = makeIssuer({ tenants, oauth });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'other' }))
      .toEqual({ issued: false, reason: 'tenant_not_authorized' });
  });

  it.each(['suspended', 'offboarded'] as const)('contributes nothing for a %s fixed tenant', async (status) => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-acme', slug: 'acme', status }]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const issuer = makeIssuer({ tenants, oauth });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'acme' }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
  });

  it('contributes nothing when the fixed binding points at a missing tenant', async () => {
    const issuer = makeIssuer({ tenants: new InMemoryTenantRegistryStore(), oauth: (() => {
      const oauth = new FixtureServiceBindingReads();
      oauth.bind({ clientId: 'svc', tenantId: 't-ghost', boundAt: NOW });
      return oauth;
    })() });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
  });

  it('binds a single active enrollment tenant with the connector_enrollment source', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-beta', slug: 'beta', status: 'active' }]);
    const issuer = makeIssuer({
      tenants,
      oauth: new FixtureServiceBindingReads(),
      enrollments: enrollmentsOf({ svc: ['t-beta'] }),
    });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: true, claim: { tid: 'beta', tenantId: 't-beta', clientId: 'svc', source: 'connector_enrollment', issuedAt: NOW } });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'beta' }))
      .toEqual({ issued: true, claim: { tid: 'beta', tenantId: 't-beta', clientId: 'svc', source: 'connector_enrollment', issuedAt: NOW } });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'acme' }))
      .toEqual({ issued: false, reason: 'tenant_not_authorized' });
  });

  it.each(['suspended', 'offboarded'] as const)('contributes nothing for a %s enrollment tenant', async (status) => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-beta', slug: 'beta', status }]);
    const issuer = makeIssuer({
      tenants,
      oauth: new FixtureServiceBindingReads(),
      enrollments: enrollmentsOf({ svc: ['t-beta', 't-ghost'] }),
    });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
  });

  it('requires a selector for a multi-tenant set and rejects foreign selectors', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [
      { tenantId: 't-acme', slug: 'acme', status: 'active' },
      { tenantId: 't-beta', slug: 'beta', status: 'active' },
    ]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const issuer = makeIssuer({
      tenants,
      oauth,
      enrollments: enrollmentsOf({ svc: ['t-beta'] }),
    });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'tenant_selector_required' });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'beta' }))
      .toEqual({ issued: true, claim: { tid: 'beta', tenantId: 't-beta', clientId: 'svc', source: 'connector_enrollment', issuedAt: NOW } });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'zzz' }))
      .toEqual({ issued: false, reason: 'tenant_not_authorized' });
  });

  it('lets the fixed service_client source win over a duplicate enrollment tenant', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [
      { tenantId: 't-acme', slug: 'acme', status: 'active' },
      { tenantId: 't-beta', slug: 'beta', status: 'active' },
    ]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const issuer = makeIssuer({
      tenants,
      oauth,
      enrollments: enrollmentsOf({ svc: ['t-acme', 't-acme', 't-beta'] }),
    });
    // Duplicate enrollment of the fixed tenant collapses to one entry (fixed wins).
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'acme' }))
      .toEqual({ issued: true, claim: { tid: 'acme', tenantId: 't-acme', clientId: 'svc', source: 'service_client', issuedAt: NOW } });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'tenant_selector_required' });
  });

  it('treats an absent enrollments port as no enrolled tenants', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-acme', slug: 'acme', status: 'active' }]);
    const issuer = makeIssuer({ tenants, oauth: new FixtureServiceBindingReads() });
    expect(await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .toEqual({ issued: false, reason: 'no_authorized_tenant' });
  });

  it('throws identity_material_invalid on an empty clientId', async () => {
    const issuer = makeIssuer({ tenants: new InMemoryTenantRegistryStore(), oauth: new FixtureServiceBindingReads() });
    await expect(issuer.issueServiceTid({ clientId: '', requestedTenant: null }))
      .rejects.toBeInstanceOf(IdentityCustodyErrorV1);
    await expect(issuer.issueServiceTid({ clientId: '', requestedTenant: null }))
      .rejects.toMatchObject({ code: 'identity_material_invalid' });
  });

  it('propagates store errors instead of converting them to refusals', async () => {
    const failing: ServiceTenantBindingSourceV1 = {
      findServiceClientBinding: async () => { throw new Error('store-down'); },
    };
    const issuer = createServicePrincipalTidIssuerV1({
      tenants: new InMemoryTenantRegistryStore(),
      oauth: failing,
      clock: () => NOW,
    });
    await expect(issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null }))
      .rejects.toThrow('store-down');
  });

  it('emits exactly one s2s_obo_mint audit event per call on both outcomes, without the requested value', async () => {
    const tenants = new InMemoryTenantRegistryStore();
    await seedTenants(tenants, [{ tenantId: 't-acme', slug: 'acme', status: 'active' }]);
    const oauth = new FixtureServiceBindingReads();
    oauth.bind({ clientId: 'svc', tenantId: 't-acme', boundAt: NOW });
    const audit = new InMemoryIdentityAudit();
    const issuer = makeIssuer({ tenants, oauth, audit });

    const minted = await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: null });
    expect(minted.issued).toBe(true);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toEqual({ at: NOW, kind: 's2s_obo_mint', actorId: 'svc', subjectId: 't-acme', detail: 'outcome=minted' });

    const refused = await issuer.issueServiceTid({ clientId: 'svc', requestedTenant: 'zzz-secret-selector' });
    expect(refused).toEqual({ issued: false, reason: 'tenant_not_authorized' });
    expect(audit.events).toHaveLength(2);
    expect(audit.events[1]).toEqual({ at: NOW, kind: 's2s_obo_mint', actorId: 'svc', detail: 'outcome=rejected_tenant_not_authorized' });
    expect(JSON.stringify(audit.events[1])).not.toContain('zzz-secret-selector');

    const empty = await issuer.issueServiceTid({ clientId: 'svc-unknown', requestedTenant: null });
    expect(empty).toEqual({ issued: false, reason: 'no_authorized_tenant' });
    expect(audit.events).toHaveLength(3);
    expect(audit.events[2]).toEqual({ at: NOW, kind: 's2s_obo_mint', actorId: 'svc-unknown', detail: 'outcome=rejected_no_authorized_tenant' });
  });
});

const WRITE = { mode: 'write', purpose: 'request', deadlineMs: 5000, maxAttempts: 1 } as const;
const forbidden = new Proxy({}, { get: () => () => { throw new Error('legacy host identity method called'); } });
const hostPorts = {
  users: forbidden, credentials: forbidden, challenges: forbidden, sessions: forbidden, emailVerification: forbidden, magicLinks: forbidden,
  tokens: forbidden, accountPolicy: forbidden, emailDelivery: forbidden, auditLog: forbidden,
  clock: { now: () => new Date(NOW), addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000) },
  random: { uuid: randomUUID, bytes: randomBytes, token: (size: number) => randomBytes(size).toString('base64url'), numericCode: () => '123456' },
} as unknown as AuthHonoPorts;
const shared = {
  hostPorts, digest: createNodeIdentityDigestPort(),
  ticketTokens: createHs256EmailTicketPort(new Uint8Array(32).fill(9)),
  emailCodeKeys: { issuance: 'sha256' as const, activeKeyRef: null, previousKeyRefs: [] },
  rp: { id: 'example.test', name: 'Example', expectedOrigins: ['https://example.test'] },
  accountPolicy: { normalizeEmail: (email: string) => email.trim().toLowerCase(), deriveDisplayName: () => 'Person', roleForNewUser: () => 'editor', statusForNewUser: () => ({ accountStatus: 'active', approvalDueAt: null }) },
  webAuthnPolicy: { registrationUserVerification: 'preferred' as const, authenticationUserVerification: 'required' as const },
  magicLink: { baseUrl: 'https://example.test', tokenBytes: 32, ttlSeconds: 600 },
  social: { autoLinkProviders: ['google'] },
  business: { afterUserCreated: async () => undefined, provisionWorkspace: async () => undefined },
  trustedRegistration: null,
  loginTokens: { sign: async () => { throw new Error('not used'); }, verify: async () => { throw new Error('not used'); } },
};

describe.each(pgEnabled ? ['sqlite', 'postgres'] as const : ['sqlite'] as const)('P3 binding integration on %s', (profile) => {
  const open = async () => asOpHost((profile === 'postgres' ? await openPostgresEnv() : openSqliteEnv()).unitOfWork);

  it('throws identity_material_invalid when serviceTenancy and hostPorts.serviceTenant are both set', async () => {
    const unitOfWork = await open();
    const hostServiceTenant: AuthHonoServiceTenantPort = { resolveOboTenant: async () => ({ tid: null }) };
    await expect(unitOfWork.run(WRITE, async (tx) => createIdentityAuthHonoTransactionBindingV1({
      ...shared, tx,
      hostPorts: { ...hostPorts, serviceTenant: hostServiceTenant },
      serviceTenancy: {},
    }))).rejects.toMatchObject({ code: 'identity_material_invalid' });
  });

  it('passes the host serviceTenant port through unchanged when serviceTenancy is absent', async () => {
    const unitOfWork = await open();
    const hostServiceTenant: AuthHonoServiceTenantPort = { resolveOboTenant: async () => ({ tid: 'host-tid' }) };
    const outcome = await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({
        ...shared, tx, hostPorts: { ...hostPorts, serviceTenant: hostServiceTenant },
      });
      expect(binding.ports.serviceTenant).toBe(hostServiceTenant);
      return binding.ports.serviceTenant!.resolveOboTenant({ clientId: 'svc', fixedTenantId: 'ignored-by-host', requestedTenant: null });
    });
    expect(outcome).toEqual({ tid: 'host-tid' });
  });

  it('fails closed with identity_contract_unavailable on pre-G1 stores when serviceTenancy is set', async () => {
    const unitOfWork = await open();
    await expect(unitOfWork.run(WRITE, async (tx) => {
      // Union world: the durable stores already carry G1's OAuth read
      // surface, so simulate a genuinely pre-G1 store set by hiding the G1
      // finder on the live store for the duration of this attempt only.
      const oauth = tx.stores.oauth as unknown as Record<string, unknown>;
      const saved = oauth['findServiceClientBinding'];
      oauth['findServiceClientBinding'] = undefined;
      try {
        return createIdentityAuthHonoTransactionBindingV1({
          ...shared, tx,
          serviceTenancy: { enrollments: { listEnrolledTenantIds: async () => [] } },
        });
      } finally {
        oauth['findServiceClientBinding'] = saved;
      }
    })).rejects.toMatchObject({ code: 'identity_contract_unavailable' });
  });

  it('builds the CM-owned serviceTenant port on G1 stores when serviceTenancy is set', async () => {
    const unitOfWork = await open();
    const outcome = await unitOfWork.run(WRITE, async (tx) => {
      const binding = createIdentityAuthHonoTransactionBindingV1({
        ...shared, tx,
        serviceTenancy: { enrollments: { listEnrolledTenantIds: async () => [] } },
      });
      expect(binding.ports.serviceTenant).toBeDefined();
      return binding.ports.serviceTenant!.resolveOboTenant({ clientId: 'svc-unknown', fixedTenantId: 'ignored-by-cm', requestedTenant: null });
    });
    expect(outcome).toEqual({ error: 'invalid_target', description: 'The client has no authorized tenant to act on behalf of.' });
  });
});
