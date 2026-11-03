// Lot G2 (P2 / F12, design a4-cm-gaps-r2 §5): boundary resolution over the CM
// tenancy stores. One shared scenario set runs over in-memory doubles, SQLite
// and PostgreSQL stores (a22 pattern); stub-level cases pin the null-vs-throw
// split and the domain-level re-checks.

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  TenantBoundaryError,
  applySqliteIdentitySchema,
  createBoundaryDomain,
  createIdentityBoundaryDomainV1,
  createInMemoryIdentityStores,
  createSqliteIdentityStores,
  createTenantBoundaryPortV1,
  deriveWorkspaceReference,
  type MembershipLookup,
  type TenantMembershipRecord,
  type TenantMembershipStore,
  type TenantRegistryStore,
  type WorkspaceDirectoryStore,
} from '../src/index.js';

const NOW = '2026-11-03T12:00:00.000Z';
const LATER = '2026-11-03T13:00:00.000Z';
const HOME = 'node:sentropic-local' as const;

interface BoundaryStores {
  readonly workspaces: WorkspaceDirectoryStore;
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
}

async function seedTenant(
  stores: BoundaryStores,
  tenantId: string,
  slug: string,
  status: 'active' | 'suspended' | 'offboarded',
  workspaceId: string,
): Promise<void> {
  await stores.tenants.createTenant({ tenantId, slug, status, createdAt: NOW });
  await stores.workspaces.enrolWorkspace({
    workspaceId,
    tenantId,
    repoIdentity: `github.com/acme/${workspaceId}`,
    aliases: [],
    enrolledAt: NOW,
  });
}

async function seedMembership(
  stores: BoundaryStores,
  userId: string,
  tenantId: string,
  status: TenantMembershipRecord['status'],
  role: TenantMembershipRecord['tenantRole'] = 'member',
  updatedAt = NOW,
): Promise<void> {
  await stores.memberships.upsertMembershipRequest({
    userId,
    tenantId,
    status,
    tenantRole: role,
    decidedBy: 'admin',
    decidedAt: NOW,
    updatedAt,
  });
}

async function seedApprovedWorkspace(stores: BoundaryStores): Promise<void> {
  await seedTenant(stores, 'tenant-1', 'acme', 'active', 'ws-1');
  await seedMembership(stores, 'user-1', 'tenant-1', 'approved', 'admin', NOW);
  await seedMembership(stores, 'user-2', 'tenant-1', 'approved', 'member', LATER);
}

async function resolutionSuccess(stores: BoundaryStores): Promise<void> {
  await seedApprovedWorkspace(stores);
  const port = createTenantBoundaryPortV1(stores);
  await expect(port.resolveApproved({ workspaceId: 'ws-1', userId: 'user-1' })).resolves.toEqual({
    tenantId: 'tenant-1',
    tid: 'acme',
    userId: 'user-1',
    tenantRole: 'admin',
    membershipRevision: NOW,
  });
  await expect(port.resolveApproved({ workspaceId: 'ws-1', userId: 'user-2' })).resolves.toEqual({
    tenantId: 'tenant-1',
    tid: 'acme',
    userId: 'user-2',
    tenantRole: 'member',
    membershipRevision: LATER,
  });
}

async function resolutionMisses(stores: BoundaryStores): Promise<void> {
  await seedApprovedWorkspace(stores);
  await seedTenant(stores, 'tenant-sus', 'sus', 'suspended', 'ws-sus');
  await seedMembership(stores, 'user-1', 'tenant-sus', 'approved');
  await seedTenant(stores, 'tenant-off', 'off', 'offboarded', 'ws-off');
  await seedMembership(stores, 'user-1', 'tenant-off', 'approved');
  for (const status of ['invited', 'requested', 'rejected', 'suspended'] as const) {
    await seedMembership(stores, `user-${status}`, 'tenant-1', status);
  }
  const port = createTenantBoundaryPortV1(stores);
  const domain = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: port });
  const misses: MembershipLookup[] = [
    { workspaceId: 'ws-unknown', userId: 'user-1' },
    { workspaceId: 'ws-sus', userId: 'user-1' },
    { workspaceId: 'ws-off', userId: 'user-1' },
    { workspaceId: 'ws-1', userId: 'user-invited' },
    { workspaceId: 'ws-1', userId: 'user-requested' },
    { workspaceId: 'ws-1', userId: 'user-rejected' },
    { workspaceId: 'ws-1', userId: 'user-suspended' },
    { workspaceId: 'ws-1', userId: 'user-absent' },
  ];
  for (const lookup of misses) {
    await expect(port.resolveApproved(lookup)).resolves.toBeNull();
    await expect(domain.resolve(lookup)).rejects.toBeInstanceOf(TenantBoundaryError);
    await expect(domain.resolve(lookup)).rejects.toMatchObject({ code: 'tenant_membership_required' });
  }
}

async function domainBehavior(stores: BoundaryStores): Promise<void> {
  await seedApprovedWorkspace(stores);
  const port = createTenantBoundaryPortV1(stores);
  const domain = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: port });
  const lookup = { workspaceId: 'ws-1', userId: 'user-1' };
  await expect(domain.resolve(lookup)).resolves.toEqual({
    tid: 'acme',
    workspace: await deriveWorkspaceReference('ws-1'),
    userId: 'user-1',
    homeNodeId: HOME,
  });
  await expect(domain.workspaceReference('ws-1')).resolves.toBe(await deriveWorkspaceReference('ws-1'));
}

async function frozenEquivalence(stores: BoundaryStores): Promise<void> {
  await seedApprovedWorkspace(stores);
  const port = createTenantBoundaryPortV1(stores);
  // The frozen port carries the slug in its tenantId field (the de facto app
  // seam behavior); the new domain must match it field-by-field.
  const frozen = createBoundaryDomain({
    homeNodeId: HOME,
    memberships: {
      async resolveApproved(lookup) {
        const resolution = await port.resolveApproved(lookup);
        return resolution
          ? { tenantId: resolution.tid, userId: resolution.userId, status: 'approved' as const }
          : null;
      },
    },
  });
  const domain = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: port });
  const hit = { workspaceId: 'ws-1', userId: 'user-1' };
  await expect(domain.resolve(hit)).resolves.toEqual(await frozen.resolve(hit));
  const miss = { workspaceId: 'ws-1', userId: 'user-absent' };
  const frozenRefusal = await frozen.resolve(miss).catch((error: unknown) => error);
  const domainRefusal = await domain.resolve(miss).catch((error: unknown) => error);
  expect(frozenRefusal).toBeInstanceOf(TenantBoundaryError);
  expect(domainRefusal).toBeInstanceOf(TenantBoundaryError);
  expect((domainRefusal as TenantBoundaryError).code).toBe((frozenRefusal as TenantBoundaryError).code);
}

describe('boundary resolution over in-memory doubles', () => {
  it('resolves the exact boundary record for both tenant roles', async () => {
    await resolutionSuccess(createInMemoryIdentityStores());
  });
  it('returns null at the port and throws TenantBoundaryError at the domain for every miss', async () => {
    await resolutionMisses(createInMemoryIdentityStores());
  });
  it('resolves the frozen TenantResidenceContext shape with tid = slug', async () => {
    await domainBehavior(createInMemoryIdentityStores());
  });
  it('matches the frozen createBoundaryDomain field-by-field, including the refusal', async () => {
    await frozenEquivalence(createInMemoryIdentityStores());
  });
});

describe('boundary resolution over SQLite stores', () => {
  const setup = (): BoundaryStores => {
    const db = new DatabaseSync(':memory:');
    applySqliteIdentitySchema(db);
    return createSqliteIdentityStores(db);
  };
  it('resolves the exact boundary record for both tenant roles', async () => {
    await resolutionSuccess(setup());
  });
  it('returns null at the port and throws TenantBoundaryError at the domain for every miss', async () => {
    await resolutionMisses(setup());
  });
  it('resolves the frozen TenantResidenceContext shape with tid = slug', async () => {
    await domainBehavior(setup());
  });
  it('matches the frozen createBoundaryDomain field-by-field, including the refusal', async () => {
    await frozenEquivalence(setup());
  });
});
