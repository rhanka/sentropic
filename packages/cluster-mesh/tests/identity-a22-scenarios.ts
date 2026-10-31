// Identity core lot A2.2: shared backend scenarios. Every scenario runs
// once per durable profile (PostgreSQL, SQLite) from the thin profile specs.
// The frozen in-memory doubles supply the out-of-slice ports (login sessions,
// accounts, audit, divergence metrics); only the five A2.2 stores vary.

import { expect } from 'vitest';
import {
  IdentityConflictError,
  MembershipTransitionError,
  TenantBoundaryError,
  TenantNotActiveError,
  WorkspaceAlreadyEnrolledError,
  createInMemoryDivergenceMetrics,
  createInMemoryIdentityStores,
  createTenantMemberships,
  createTenantOAuth,
  createTenantRegistry,
  createTidIssuer,
  createTenantResolver,
  createUserAccounts,
  createWorkspaceDirectory,
  InMemoryIdentityAudit,
  type OAuthTenantStore,
  type TenantMembershipStore,
  type TenantRegistryStore,
  type WorkspaceDirectoryStore,
  type WorkspaceMembershipStore,
} from '../src/index.js';

export interface A22BackendStores {
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
  readonly oauth: OAuthTenantStore;
}

export const A22_NOW = '2026-10-30T12:00:00.000Z';
const CLOCK = () => A22_NOW;

export interface A22ScenarioContext {
  readonly audit: InMemoryIdentityAudit;
  readonly registry: ReturnType<typeof createTenantRegistry>;
  readonly memberships: ReturnType<typeof createTenantMemberships>;
  readonly workspaces: ReturnType<typeof createWorkspaceDirectory>;
  readonly issuer: ReturnType<typeof createTidIssuer>;
  readonly oauth: ReturnType<typeof createTenantOAuth>;
}

export function wireA22Scenarios(stores: A22BackendStores): A22ScenarioContext {
  const doubles = createInMemoryIdentityStores();
  const audit = new InMemoryIdentityAudit();
  return {
    audit,
    registry: createTenantRegistry({
      tenants: stores.tenants,
      memberships: stores.memberships,
      sessions: doubles.sessions,
      audit,
      clock: CLOCK,
    }),
    memberships: createTenantMemberships({
      memberships: stores.memberships,
      tenants: stores.tenants,
      audit,
      clock: CLOCK,
    }),
    workspaces: createWorkspaceDirectory({
      workspaces: stores.workspaces,
      members: stores.workspaceMembers,
      audit,
      clock: CLOCK,
    }),
    issuer: createTidIssuer({ memberships: stores.memberships, tenants: stores.tenants }),
    oauth: createTenantOAuth({ oauth: stores.oauth, clock: CLOCK }),
  };
}

/** Replays the frozen contract assertions over a durable backend. */
export async function replayContractMembershipCycle(stores: A22BackendStores): Promise<void> {
  const { registry, memberships, workspaces, issuer, oauth } = wireA22Scenarios(stores);
  const tenant = await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
  expect(tenant).toMatchObject({ tenantId: 'tenant-1', slug: 'acme', status: 'active' });
  await expect(registry.createTenant({ tenantId: 'tenant-2', slug: 'acme' }, 'admin')).rejects.toBeInstanceOf(
    IdentityConflictError,
  );
  await expect(registry.createTenant({ tenantId: 'tenant-1', slug: 'other' }, 'admin')).rejects.toBeInstanceOf(
    IdentityConflictError,
  );
  expect(await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' })).toEqual({ received: true });
  const approved = await memberships.decideMembership({
    userId: 'user-1',
    tenantId: 'tenant-1',
    decision: 'approve',
    actorId: 'admin',
    role: 'admin',
  });
  expect(approved).toMatchObject({ status: 'approved', tenantRole: 'admin', decidedBy: 'admin' });
  const workspace = await workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'user-1',
  });
  expect(workspace).toMatchObject({ tenantId: 'tenant-1', repoIdentity: 'github.com/acme/repo' });
  expect(await workspaces.listWorkspaceMembers('ws-1')).toEqual([
    { workspaceId: 'ws-1', userId: 'user-1', role: 'admin' },
  ]);
  const conflict = await workspaces
    .enrolWorkspace({
      workspaceId: 'ws-2',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/repo',
      creatorUserId: 'user-2',
    })
    .catch((error: unknown) => error);
  expect(conflict).toBeInstanceOf(WorkspaceAlreadyEnrolledError);
  expect(conflict).toMatchObject({ code: 'workspace_already_enrolled', workspaceId: 'ws-1' });
  const claim = await issuer.issueTid({ userId: 'user-1', tenantId: 'tenant-1' }, A22_NOW);
  expect(claim).toMatchObject({ tid: 'acme', tenantId: 'tenant-1', userId: 'user-1' });
  await oauth.bindServiceClient({ clientId: 'client-1', tenantId: 'tenant-1' });
  await oauth.grantConsent({ consentId: 'c1', tenantId: 'tenant-1', userId: 'user-1', clientId: 'client-1' });
  expect(await oauth.listTenantOAuthClients('tenant-1')).toHaveLength(1);
  expect(await oauth.listTenantOAuthClients('tenant-2')).toEqual([]);
  expect(await oauth.revokeConsent('c1', 'user-1')).toBe(true);
  expect(await oauth.revokeConsent('missing', 'user-1')).toBe(false);
}

/** Lot-specific: uniqueness under concurrency, aliases, repo-less, transitions. */
export async function runUniquenessAliasTransition(stores: A22BackendStores): Promise<void> {
  const { registry, memberships, workspaces } = wireA22Scenarios(stores);
  await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
  await registry.createTenant({ tenantId: 'tenant-2', slug: 'other' }, 'admin');
  await workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'user-1',
  });

  const attempts = await Promise.allSettled([
    workspaces.enrolWorkspace({
      workspaceId: 'ws-race-a',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/raced',
      creatorUserId: 'user-1',
    }),
    workspaces.enrolWorkspace({
      workspaceId: 'ws-race-b',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/raced',
      creatorUserId: 'user-1',
    }),
  ]);
  const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const winner =
    fulfilled[0] !== undefined && fulfilled[0].status === 'fulfilled' ? fulfilled[0].value.workspaceId : 'missing';
  const failure = (rejected[0] as PromiseRejectedResult).reason;
  expect(failure).toBeInstanceOf(WorkspaceAlreadyEnrolledError);
  expect(failure).toMatchObject({ workspaceId: winner });

  const aliased = await workspaces.approveWorkspaceAlias('ws-1', '/srv/repos/acme');
  expect(aliased.aliases).toContain('/srv/repos/acme');
  const idempotent = await workspaces.approveWorkspaceAlias('ws-1', '/srv/repos/acme');
  expect(idempotent.aliases.filter((alias) => alias === '/srv/repos/acme')).toHaveLength(1);
  const second = await workspaces.approveWorkspaceAlias('ws-1', '/srv/other/acme');
  expect(second.aliases).toHaveLength(2);

  const orphanA = await workspaces.enrolWorkspace({
    workspaceId: 'ws-orphan-a',
    tenantId: 'tenant-1',
    repoIdentity: null,
    creatorUserId: 'user-1',
  });
  const orphanB = await workspaces.enrolWorkspace({
    workspaceId: 'ws-orphan-b',
    tenantId: 'tenant-1',
    repoIdentity: null,
    creatorUserId: 'user-1',
  });
  expect(orphanA.repoIdentity).toBeNull();
  expect(orphanB.repoIdentity).toBeNull();

  const distinct = await workspaces.enrolWorkspace({
    workspaceId: 'ws-other-tenant',
    tenantId: 'tenant-2',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'user-2',
  });
  expect(distinct.tenantId).toBe('tenant-2');

  const members = await workspaces.listWorkspaceMembers('ws-1');
  expect(members).toHaveLength(1);
  await workspaces.addWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-2', role: 'editor', actorId: 'user-1' });
  await workspaces.setWorkspaceRole({ workspaceId: 'ws-1', userId: 'user-2', role: 'viewer', actorId: 'user-1' });
  expect(await workspaces.removeWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-2', actorId: 'user-1' })).toBe(
    true,
  );
  expect(await workspaces.removeWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-2', actorId: 'user-1' })).toBe(
    false,
  );
  await expect(
    workspaces.removeWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-1', actorId: 'user-1' }),
  ).rejects.toBeInstanceOf(IdentityConflictError);

  const decisions = [
    { from: 'requested' as const, decision: 'approve' as const, to: 'approved' },
    { from: 'requested' as const, decision: 'reject' as const, to: 'rejected' },
    { from: 'invited' as const, decision: 'suspend' as const, forbidden: true },
    { from: 'approved' as const, decision: 'suspend' as const, to: 'suspended' },
    { from: 'suspended' as const, decision: 'approve' as const, to: 'approved' },
    { from: 'rejected' as const, decision: 'approve' as const, forbidden: true },
  ];
  let index = 0;
  for (const entry of decisions) {
    index += 1;
    const userId = `transition-${index}`;
    if (entry.from === 'invited') {
      await memberships.inviteMember({ userId, tenantId: 'tenant-1', actorId: 'admin' });
    } else if (entry.from === 'rejected') {
      await memberships.requestMembership({ userId, tenantId: 'tenant-1' });
      await memberships.decideMembership({ userId, tenantId: 'tenant-1', decision: 'reject', actorId: 'admin' });
    } else if (entry.from === 'approved') {
      await memberships.requestMembership({ userId, tenantId: 'tenant-1' });
      await memberships.decideMembership({ userId, tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' });
    } else if (entry.from === 'suspended') {
      await memberships.requestMembership({ userId, tenantId: 'tenant-1' });
      await memberships.decideMembership({ userId, tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' });
      await memberships.decideMembership({ userId, tenantId: 'tenant-1', decision: 'suspend', actorId: 'admin' });
    } else {
      await memberships.requestMembership({ userId, tenantId: 'tenant-1' });
    }
    if (entry.forbidden === true) {
      await expect(
        memberships.decideMembership({ userId, tenantId: 'tenant-1', decision: entry.decision, actorId: 'admin' }),
      ).rejects.toBeInstanceOf(MembershipTransitionError);
    } else {
      const updated = await memberships.decideMembership({
        userId,
        tenantId: 'tenant-1',
        decision: entry.decision,
        actorId: 'admin',
      });
      expect(updated.status).toBe(entry.to);
    }
  }

  await registry.suspendTenant('tenant-1', 'admin');
  await expect(
    memberships.decideMembership({ userId: 'late', tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' }),
  ).rejects.toBeInstanceOf(TenantNotActiveError);
}

/** Lot-specific: shadow measures the strict outcome without changing behaviour. */
export async function runShadowStrictReplay(stores: A22BackendStores): Promise<void> {
  const { registry, memberships, workspaces } = wireA22Scenarios(stores);
  const metrics = createInMemoryDivergenceMetrics();
  const resolver = createTenantResolver({
    workspaces: stores.workspaces,
    tenants: stores.tenants,
    memberships: stores.memberships,
    metrics,
  });
  await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
  await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
  await memberships.decideMembership({ userId: 'user-1', tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' });
  await workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'user-1',
  });

  const strict = await resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'user-1' });
  expect(strict).toMatchObject({ tid: 'acme', tenantId: 'tenant-1' });
  const aligned = await resolver.resolveWithMode(
    { workspaceId: 'ws-1', userId: 'user-1' },
    'shadow',
    { legacyResolve: async () => 'acme' },
  );
  expect(aligned).toMatchObject({ mode: 'shadow', diverged: false, legacyTid: 'acme' });
  const diverged = await resolver.resolveWithMode(
    { workspaceId: 'ws-1', userId: 'user-unknown' },
    'shadow',
    { legacyResolve: async () => 'legacy-tid' },
  );
  expect(diverged).toMatchObject({ mode: 'shadow', diverged: true, authoritative: null });
  await expect(
    resolver.resolveWithMode(
      { workspaceId: 'ws-1', userId: 'user-unknown' },
      'strict',
      { legacyResolve: async () => 'legacy-tid' },
    ),
  ).rejects.toBeInstanceOf(TenantBoundaryError);

  await registry.suspendTenant('tenant-1', 'admin');
  const suspendedShadow = await resolver.resolveWithMode(
    { workspaceId: 'ws-1', userId: 'user-1' },
    'shadow',
    { legacyResolve: async () => 'acme' },
  );
  expect(suspendedShadow).toMatchObject({ mode: 'shadow', diverged: true, authoritative: null });
  await expect(resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'user-1' })).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );
  expect(metrics.summary()).toEqual({ samples: 3, diverged: 2 });
}

/** Gap-§1 end to end: account approval never substitutes for membership approval. */
export async function runGapSection1(stores: A22BackendStores): Promise<void> {
  const doubles = createInMemoryIdentityStores();
  const audit = new InMemoryIdentityAudit();
  const accounts = createUserAccounts({ accounts: doubles.accounts, audit, clock: CLOCK });
  const { registry, memberships, workspaces, issuer } = wireA22Scenarios(stores);
  const resolver = createTenantResolver({
    workspaces: stores.workspaces,
    tenants: stores.tenants,
    memberships: stores.memberships,
    metrics: createInMemoryDivergenceMetrics(),
  });

  await accounts.register({ userId: 'marie', email: 'marie@example.com' }, { firstAdmin: true });
  await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'marie');
  await workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'marie',
  });

  await expect(resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'marie' })).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );
  await expect(issuer.issueTid({ userId: 'marie', tenantId: 'tenant-1' }, A22_NOW)).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );

  await memberships.requestMembership({ userId: 'marie', tenantId: 'tenant-1' });
  await expect(resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'marie' })).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );

  await memberships.decideMembership({ userId: 'marie', tenantId: 'tenant-1', decision: 'approve', actorId: 'marie' });
  const approved = await resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'marie' });
  expect(approved).toMatchObject({ tid: 'acme', tenantId: 'tenant-1', userId: 'marie' });
  expect(approved.membershipRevision).toBe(A22_NOW);
  const claim = await issuer.issueTid({ userId: 'marie', tenantId: 'tenant-1' }, A22_NOW);
  expect(claim).toMatchObject({ tid: 'acme' });

  await memberships.decideMembership({ userId: 'marie', tenantId: 'tenant-1', decision: 'suspend', actorId: 'marie' });
  await expect(resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'marie' })).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );

  await expect(resolver.resolveAuthoritatively({ workspaceId: 'ws-forged', userId: 'marie' })).rejects.toBeInstanceOf(
    TenantBoundaryError,
  );
  await expect(issuer.issueTid({ userId: 'marie', tenantId: 'tenant-forged' }, A22_NOW)).rejects.toThrow();
}
