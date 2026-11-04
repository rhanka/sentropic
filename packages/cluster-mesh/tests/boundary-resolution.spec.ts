// Lot G2 (P2 / F12, design a4-cm-gaps-r2 §5): boundary resolution over the CM
// tenancy stores. One shared scenario set runs over in-memory doubles, SQLite
// and PostgreSQL stores (a22 pattern); stub-level cases pin the null-vs-throw
// split and the domain-level re-checks.

import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_COMPOSITION_CONTRACT_VERSION,
  IDENTITY_COMPOSITION_DESCRIPTORS,
  TenantBoundaryError,
  applyPostgresIdentitySchema,
  applySqliteIdentitySchema,
  createBoundaryDomain,
  createIdentityBoundaryDomainV1,
  createInMemoryIdentityStores,
  createPostgresIdentityStores,
  createSqliteIdentityStores,
  createTenantBoundaryPortV1,
  deriveWorkspaceReference,
  identityCompositionDescriptorV1,
  type MembershipLookup,
  type TenantMembershipRecord,
  type TenantMembershipStore,
  type TenantRegistryStore,
  type WorkspaceDirectoryStore,
} from '../src/index.js';
import { pgEnabled } from './storage/pg-driver.js';

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

interface PgPool {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  end(): Promise<void>;
}

describe.skipIf(!pgEnabled)('boundary resolution over PostgreSQL stores', () => {
  const requireModule = createRequire(import.meta.url);
  const setup = async (): Promise<{ stores: BoundaryStores; teardown(): Promise<void> }> => {
    const pg = requireModule('pg') as { Pool: new (options: unknown) => PgPool };
    const pool = new pg.Pool({ connectionString: process.env.CM_PG_URL, max: 4, connectionTimeoutMillis: 2000 });
    const schema = `g2_${randomBytes(6).toString('hex')}`;
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const client = { query: (text: string, values?: readonly unknown[]) => pool.query(text, values) };
    await applyPostgresIdentitySchema(client, { schema });
    return {
      stores: createPostgresIdentityStores(client, { schema }),
      teardown: async () => {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        await pool.end();
      },
    };
  };
  it('resolves the exact boundary record for both tenant roles', async () => {
    const fixture = await setup();
    try {
      await resolutionSuccess(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });
  it('returns null at the port and throws TenantBoundaryError at the domain for every miss', async () => {
    const fixture = await setup();
    try {
      await resolutionMisses(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });
  it('resolves the frozen TenantResidenceContext shape with tid = slug', async () => {
    const fixture = await setup();
    try {
      await domainBehavior(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });
  it('matches the frozen createBoundaryDomain field-by-field, including the refusal', async () => {
    const fixture = await setup();
    try {
      await frozenEquivalence(fixture.stores);
    } finally {
      await fixture.teardown();
    }
  });
});

describe('boundary port and domain edge semantics over stub stores', () => {
  it('propagates store errors as thrown, never as null', async () => {
    const stores = createInMemoryIdentityStores();
    const boom = new Error('store boom');
    const port = createTenantBoundaryPortV1({
      workspaces: {
        ...stores.workspaces,
        findWorkspace: async () => {
          throw boom;
        },
      },
      tenants: stores.tenants,
      memberships: stores.memberships,
    });
    const lookup = { workspaceId: 'ws-1', userId: 'user-1' };
    await expect(port.resolveApproved(lookup)).rejects.toBe(boom);
    const domain = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: port });
    await expect(domain.resolve(lookup)).rejects.toBe(boom);
  });

  it('refuses a membership whose userId differs from the lookup, at port and domain', async () => {
    const stores = createInMemoryIdentityStores();
    await seedApprovedWorkspace(stores);
    const foreign: TenantMembershipRecord = {
      userId: 'user-other',
      tenantId: 'tenant-1',
      status: 'approved',
      tenantRole: 'member',
      updatedAt: NOW,
    };
    const port = createTenantBoundaryPortV1({
      ...stores,
      memberships: { ...stores.memberships, findApprovedMembership: async () => foreign },
    });
    const lookup = { workspaceId: 'ws-1', userId: 'user-1' };
    await expect(port.resolveApproved(lookup)).resolves.toBeNull();
    const domain = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: port });
    await expect(domain.resolve(lookup)).rejects.toBeInstanceOf(TenantBoundaryError);
    const lyingBoundary = {
      resolveApproved: async () => ({ ...foreign, userId: 'user-other' }) as never,
    };
    const rechecking = createIdentityBoundaryDomainV1({ homeNodeId: HOME, boundary: lyingBoundary });
    await expect(rechecking.resolve(lookup)).rejects.toBeInstanceOf(TenantBoundaryError);
  });

  it('refuses an empty tenantId or tid and maps a null port result to TenantBoundaryError', async () => {
    const stores = createInMemoryIdentityStores();
    await seedApprovedWorkspace(stores);
    for (const tenant of [
      { tenantId: '', slug: 'acme', status: 'active' as const, createdAt: NOW },
      { tenantId: 'tenant-1', slug: '', status: 'active' as const, createdAt: NOW },
    ]) {
      const port = createTenantBoundaryPortV1({
        ...stores,
        tenants: { ...stores.tenants, findTenant: async () => tenant },
      });
      await expect(port.resolveApproved({ workspaceId: 'ws-1', userId: 'user-1' })).resolves.toBeNull();
    }
    const domain = createIdentityBoundaryDomainV1({
      homeNodeId: HOME,
      boundary: { resolveApproved: async () => null },
    });
    await expect(domain.resolve({ workspaceId: 'ws-1', userId: 'user-1' })).rejects.toMatchObject({
      code: 'tenant_membership_required',
    });
  });

  it('pins the 1.2.0 composition descriptor row for boundary_resolution', () => {
    expect(IDENTITY_COMPOSITION_CONTRACT_VERSION).toBe('1.2.0');
    const row = {
      domain: 'boundary_resolution',
      version: '1.2.0',
      baseContractVersion: '1.0.0',
      amendment: 'A4-composition-gaps',
      status: 'contract-only',
      profiles: ['postgres', 'sqlite'],
      records: ['TenantBoundaryResolutionV1'],
      ports: ['TenantBoundaryPortV1'],
      factories: ['createTenantBoundaryPortV1', 'createIdentityBoundaryDomainV1'],
      errorType: 'IdentityCustodyErrorV1',
    } as const;
    expect(IDENTITY_COMPOSITION_DESCRIPTORS).toContainEqual(row);
    expect(identityCompositionDescriptorV1('boundary_resolution')).toEqual(row);
  });
});
