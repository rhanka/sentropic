import { describe, expect, it } from 'vitest';
import {
  IdentityConflictError,
  MembershipTransitionError,
  TenantBoundaryError,
  TenantNotActiveError,
  WorkspaceAlreadyEnrolledError,
  createInMemoryIdentityStores,
  createTenantMemberships,
  createTenantOAuth,
  createTenantRegistry,
  createTidIssuer,
  createWorkspaceDirectory,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const CLOCK = () => NOW;

function setup() {
  const stores = createInMemoryIdentityStores();
  return {
    stores,
    registry: createTenantRegistry({
      tenants: stores.tenants,
      memberships: stores.memberships,
      sessions: stores.sessions,
      audit: stores.audit,
      clock: CLOCK,
    }),
    memberships: createTenantMemberships({
      memberships: stores.memberships,
      tenants: stores.tenants,
      audit: stores.audit,
      clock: CLOCK,
    }),
    workspaces: createWorkspaceDirectory({
      workspaces: stores.workspaces,
      members: stores.workspaceMembers,
      audit: stores.audit,
      clock: CLOCK,
    }),
    issuer: createTidIssuer({ memberships: stores.memberships, tenants: stores.tenants }),
    oauth: createTenantOAuth({ oauth: stores.oauth, clock: CLOCK }),
  };
}

describe('tenant registry and lifecycle', () => {
  it('should create tenants with an immutable slug', async () => {
    const { registry } = setup();
    const tenant = await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    expect(tenant).toMatchObject({ tenantId: 'tenant-1', slug: 'acme', status: 'active' });
    await expect(registry.createTenant({ tenantId: 'tenant-2', slug: 'acme' }, 'admin')).rejects.toBeInstanceOf(
      IdentityConflictError,
    );
  });

  it('should suspend a tenant and refuse writes under a non-active tenant', async () => {
    const { registry, memberships } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    await memberships.requestMembership({ userId: 'user-0', tenantId: 'tenant-1' });
    await registry.suspendTenant('tenant-1', 'admin');
    expect((await registry.getTenant('tenant-1')).status).toBe('suspended');
    await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
    await expect(
      memberships.decideMembership({ userId: 'user-1', tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' }),
    ).rejects.toBeInstanceOf(TenantNotActiveError);
  });

  it('should refuse offboard while approved memberships hold live sessions unless forced', async () => {
    const { registry, memberships, stores } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
    await memberships.decideMembership({ userId: 'user-1', tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' });
    await stores.sessions.createSession({
      sessionId: 's1',
      userId: 'user-1',
      status: 'active',
      mfaState: 'none',
      createdAt: NOW,
      expiresAt: '2026-10-31T12:00:00.000Z',
      refreshCount: 0,
    });
    await expect(registry.offboardTenant('tenant-1', { actorId: 'admin' })).rejects.toMatchObject({
      code: 'tenant_offboard_blocked',
    });
    const offboarded = await registry.offboardTenant('tenant-1', { actorId: 'admin', force: true });
    expect(offboarded.status).toBe('offboarded');
  });
});

describe('tenant membership full cycle', () => {
  it('should move invited/requested to approved/rejected and approved to suspended and back', async () => {
    const { memberships, registry } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    expect(await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' })).toEqual({
      received: true,
    });
    const approved = await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'approve',
      actorId: 'admin',
      role: 'admin',
    });
    expect(approved).toMatchObject({ status: 'approved', tenantRole: 'admin', decidedBy: 'admin' });
    const suspended = await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'suspend',
      actorId: 'admin',
    });
    expect(suspended.status).toBe('suspended');
    const reapproved = await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'approve',
      actorId: 'admin',
    });
    expect(reapproved.status).toBe('approved');
  });

  it('should invite members as invited and approve them into the cycle', async () => {
    const { memberships, registry } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    const invited = await memberships.inviteMember({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
      actorId: 'admin',
    });
    expect(invited).toMatchObject({ status: 'invited', tenantRole: 'admin', decidedBy: 'admin' });
    await expect(
      memberships.inviteMember({ userId: 'user-1', tenantId: 'tenant-1', actorId: 'admin' }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    const approved = await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'approve',
      actorId: 'admin',
    });
    expect(approved).toMatchObject({ status: 'approved', tenantRole: 'admin' });
  });

  it('should refuse invalid transitions and surface tenant roles', async () => {
    const { memberships, registry } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
    await expect(
      memberships.decideMembership({ userId: 'user-1', tenantId: 'tenant-1', decision: 'suspend', actorId: 'admin' }),
    ).rejects.toBeInstanceOf(MembershipTransitionError);
    const rejected = await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'reject',
      actorId: 'admin',
    });
    expect(rejected).toMatchObject({ status: 'rejected', tenantRole: 'member' });
    expect(
      await memberships.resolveApprovedMembership('user-1', 'tenant-1'),
    ).toBeNull();
  });
});

describe('workspaces and workspace memberships', () => {
  it('should enrol one workspace per repo with the creator as admin', async () => {
    const { workspaces } = setup();
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
  });

  it('should add, re-role and remove members but keep the last admin', async () => {
    const { workspaces } = setup();
    await workspaces.enrolWorkspace({
      workspaceId: 'ws-1',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/repo',
      creatorUserId: 'user-1',
    });
    await workspaces.addWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-2', role: 'editor', actorId: 'user-1' });
    await workspaces.setWorkspaceRole({ workspaceId: 'ws-1', userId: 'user-2', role: 'viewer', actorId: 'user-1' });
    expect(await workspaces.removeWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-2', actorId: 'user-1' })).toBe(
      true,
    );
    await expect(
      workspaces.removeWorkspaceMember({ workspaceId: 'ws-1', userId: 'user-1', actorId: 'user-1' }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
  });

  it('should refuse a second enrolment of the same repo with the existing id', async () => {
    const { workspaces } = setup();
    await workspaces.enrolWorkspace({
      workspaceId: 'ws-1',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/repo',
      creatorUserId: 'user-1',
    });
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
  });

  it('should record repo-less workspaces without claiming a repo identity', async () => {
    const { workspaces } = setup();
    const workspace = await workspaces.enrolWorkspace({
      workspaceId: 'ws-orphan',
      tenantId: 'tenant-1',
      repoIdentity: null,
      creatorUserId: 'user-1',
    });
    expect(workspace.repoIdentity).toBeNull();
  });

  it('should approve repo aliases through a verified mapping', async () => {
    const { workspaces } = setup();
    await workspaces.enrolWorkspace({
      workspaceId: 'ws-1',
      tenantId: 'tenant-1',
      repoIdentity: 'github.com/acme/repo',
      creatorUserId: 'user-1',
    });
    const updated = await workspaces.approveWorkspaceAlias('ws-1', '/srv/repos/acme', 'user-1');
    expect(updated.aliases).toContain('/srv/repos/acme');
  });
});

describe('tid issuance and tenant oauth legs', () => {
  it('should derive the tid claim only from an approved membership of an active tenant', async () => {
    const { registry, memberships, issuer } = setup();
    await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
    await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
    await expect(issuer.issueTid({ userId: 'user-1', tenantId: 'tenant-1' }, NOW)).rejects.toBeInstanceOf(
      TenantBoundaryError,
    );
    await memberships.decideMembership({ userId: 'user-1', tenantId: 'tenant-1', decision: 'approve', actorId: 'admin' });
    const claim = await issuer.issueTid({ userId: 'user-1', tenantId: 'tenant-1' }, NOW);
    expect(claim).toMatchObject({ tid: 'acme', tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('should scope oauth consents and service clients to their tenant', async () => {
    const { oauth } = setup();
    await oauth.bindServiceClient({ clientId: 'client-1', tenantId: 'tenant-1' });
    await oauth.grantConsent({ consentId: 'c1', tenantId: 'tenant-1', userId: 'user-1', clientId: 'client-1' });
    expect(await oauth.listTenantOAuthClients('tenant-1')).toEqual([
      { clientId: 'client-1', tenantId: 'tenant-1', boundAt: NOW },
    ]);
    expect(await oauth.listTenantOAuthClients('tenant-2')).toEqual([]);
    expect(await oauth.revokeConsent('c1', 'user-1')).toBe(true);
  });
});
