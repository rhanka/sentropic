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
