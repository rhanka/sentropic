import { createClusterMeshPlugin, createWorkspacesRouter } from '@sentropic/cluster-mesh';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  folders, initiatives, oauthClients, tenantMemberships, tenants, workspaceMemberships, workspaces,
} from '../../src/db/schema';
import { requireAuth } from '../../src/middleware/auth';
import {
  createWorkspacesNamespaceModule,
  WORKSPACE_EDITOR_PATHS,
  WORKSPACE_PATHS,
  WORKSPACES_AUTHOR,
  type WorkspacesRouterPorts,
} from '../../src/routes/namespaces/workspaces';
import { productWorkspacePorts } from '../../src/routes/namespaces/workspaces/product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import { neutralRouter as legacyNeutralRouter } from '../fixtures/historical/workspaces-c94401b9a/api/src/routes/api/neutral';
import { tenantsRouter as legacyTenantsRouter } from '../fixtures/historical/workspaces-c94401b9a/api/src/routes/api/tenants';
import {
  authenticatedRequest, cleanupAuthData, createAuthenticatedUser, type TestUser,
} from '../utils/auth-helper';

const key = { compositionRoot: 'product' as const, namespace: '/workspaces' as const };
const twinTenants = ['cm-workspace-candidate', 'cm-workspace-historical'] as const;
const securityTenants = ['cm-workspace-security-a', 'cm-workspace-security-b'] as const;
const allTestTenants = [...twinTenants, ...securityTenants];
const securityClientId = 'cm-workspace-security-client';
const clearCutover = () => db.delete(clusterMeshNamespaceCutovers).where(and(
  eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
  eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
));
const candidate = (
  enabled = true,
  ports: WorkspacesRouterPorts = productWorkspacePorts,
) => new Hono().route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [createWorkspacesNamespaceModule({ enabled, ports })],
  mounts: { '/workspaces': '/' },
}));
const cutovers = new PostgresClusterMeshCutoverStore();
const historicalNeutral = new Hono()
  .use('/api/v1/neutral/*', requireAuth)
  .route('/api/v1/neutral', legacyNeutralRouter);
const historicalTenants = new Hono()
  .use('/api/v1/tenants/*', requireAuth)
  .route('/api/v1/tenants', legacyTenantsRouter);
const fixtureUrl = (path: string) => new URL(
  `../fixtures/historical/workspaces-c94401b9a/${path}`,
  import.meta.url,
);

describe('cluster mesh workspaces cutover', () => {
  let user: TestUser;
  let workspaceIds: string[];

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
    workspaceIds = user.workspaceId ? [user.workspaceId] : [];
  });

  afterEach(async () => {
    await clearCutover();
    await db.delete(oauthClients).where(eq(oauthClients.clientId, securityClientId));
    await db.delete(tenantMemberships).where(inArray(tenantMemberships.tenantId, allTestTenants));
    await db.delete(tenants).where(inArray(tenants.id, allTestTenants));
    if (user.workspaceId) {
      await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
      await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    }
    await cleanupAuthData();
    if (workspaceIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    }
  });

  it('executes pinned legacy source with authenticated seeded neutral-read parity', async () => {
    for (const [path, blob] of [
      ['api/src/routes/api/neutral.ts', '0bc4f0c2182a7ea1a0049254731868210afdaa15'],
      ['api/src/routes/api/tenants.ts', 'f52667a442ee7f5fc9b53f0a7ec3810668c89ea0'],
    ] as const) {
      const source = readFileSync(fixtureUrl(path));
      expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
        .toBe(blob);
    }
    const folderId = crypto.randomUUID();
    await db.insert(folders).values({
      id: folderId, workspaceId: user.workspaceId!, name: 'Workspace D11 folder',
    });
    await db.insert(initiatives).values({
      id: crypto.randomUUID(), workspaceId: user.workspaceId!, folderId,
      data: { name: 'Workspace D11 initiative' },
    });

    const legacy = await authenticatedRequest(
      historicalNeutral, 'GET', '/api/v1/neutral/dashboard', user.sessionToken!,
    );
    const current = await authenticatedRequest(
      candidate(), 'GET', '/api/v1/neutral/dashboard', user.sessionToken!,
    );
    expect({ status: current.status, body: await current.text() })
      .toEqual({ status: legacy.status, body: await legacy.text() });
  });

  it('persists one membership mutation per isolated candidate and historical twin', async () => {
    await db.insert(tenants).values(twinTenants.map((id) => ({ id, name: id, status: 'active' })));
    const readRows = () => db.select().from(tenantMemberships).where(and(
      inArray(tenantMemberships.tenantId, twinTenants),
      eq(tenantMemberships.userId, user.id),
    ));
    expect(await readRows()).toHaveLength(0);

    const current = await authenticatedRequest(
      candidate(), 'POST', `/api/v1/tenants/${twinTenants[0]}/memberships`, user.sessionToken!,
    );
    let rows = await readRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: twinTenants[0], status: 'requested' });
    expect(rows.some(({ tenantId }) => tenantId === twinTenants[1])).toBe(false);

    const repeated = await authenticatedRequest(
      candidate(), 'POST', `/api/v1/tenants/${twinTenants[0]}/memberships`, user.sessionToken!,
    );
    expect(await readRows()).toHaveLength(1);
    expect({ status: repeated.status, body: await repeated.text() })
      .toEqual({ status: current.status, body: await current.clone().text() });

    const historical = await authenticatedRequest(
      historicalTenants, 'POST', `/api/v1/tenants/${twinTenants[1]}/memberships`, user.sessionToken!,
    );
    rows = await readRows();
    expect(rows).toHaveLength(2);
    expect(rows.find(({ tenantId }) => tenantId === twinTenants[1]))
      .toMatchObject({ status: 'requested' });
    expect({ status: historical.status, body: await historical.text() })
      .toEqual({ status: current.status, body: await current.text() });
  });

  it('records direct activation and fails closed after the exact rollback checkpoint', async () => {
    const app = candidate();
    expect((await authenticatedRequest(
      app, 'GET', '/api/v1/neutral/dashboard', user.sessionToken!,
    )).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      activeAuthor: WORKSPACES_AUTHOR,
      status: 'active',
      previousGenerationId: 'legacy-api-workspaces-v1',
      rollbackCheckpoint: { activeAuthor: 'legacy-api-workspaces-router' },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(
      app, 'GET', '/api/v1/neutral/dashboard', user.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('uses exact auth/editor fences with no disabled or duplicate fallback', async () => {
    expect((await candidate().request('/api/v1/neutral/dashboard')).status).toBe(401);
    expect(await cutovers.find(key)).toBeNull();
    expect((await candidate(false).request('/api/v1/neutral/dashboard')).status).toBe(404);

    const guest = await createAuthenticatedUser('guest');
    if (guest.workspaceId) workspaceIds.push(guest.workspaceId);
    const denied = await authenticatedRequest(
      candidate(), 'POST', '/api/v1/workspaces', guest.sessionToken!, { name: 'Denied' },
    );
    expect(denied.status).toBe(403);
    expect(await cutovers.find(key)).toBeNull();
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/workspaces/workspaces', user.sessionToken!,
    )).status).toBe(404);

    const paths = [...new Set(
      createWorkspacesRouter(productWorkspacePorts).routes.map(({ path }) => path),
    )].sort();
    expect(paths).toEqual([...WORKSPACE_PATHS].sort());
    expect(WORKSPACE_EDITOR_PATHS).toEqual([
      '/workspaces', '/workspaces/:id', '/workspaces/:id/gate-config',
      '/workspaces/:id/hide', '/workspaces/:id/unhide', '/workspaces/:id/members',
      '/workspaces/:id/members/:userId',
    ]);
    expect(paths).not.toContain('/*');
  });

  it('fails closed for cross-workspace member and lifecycle access without DB mutation', async () => {
    const victim = await createAuthenticatedUser('editor');
    const member = await createAuthenticatedUser('guest');
    workspaceIds.push(victim.workspaceId!, member.workspaceId!);
    await db.insert(workspaceMemberships).values({
      workspaceId: victim.workspaceId!, userId: member.id, role: 'viewer', createdAt: new Date(),
    });

    const attempts = [
      ['GET', `/api/v1/workspaces/${victim.workspaceId}/members`, undefined],
      ['POST', `/api/v1/workspaces/${victim.workspaceId}/members`, { email: user.email, role: 'viewer' }],
      ['PATCH', `/api/v1/workspaces/${victim.workspaceId}/members/${member.id}`, { role: 'admin' }],
      ['DELETE', `/api/v1/workspaces/${victim.workspaceId}/members/${member.id}`, undefined],
      ['POST', `/api/v1/workspaces/${victim.workspaceId}/hide`, {}],
      ['POST', `/api/v1/workspaces/${victim.workspaceId}/unhide`, {}],
      ['DELETE', `/api/v1/workspaces/${victim.workspaceId}`, undefined],
    ] as const;
    for (const [method, path, body] of attempts) {
      const response = await authenticatedRequest(candidate(), method, path, user.sessionToken!, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }

    const [workspace] = await db.select({ hiddenAt: workspaces.hiddenAt })
      .from(workspaces).where(eq(workspaces.id, victim.workspaceId!));
    const roles = await db.select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, victim.workspaceId!));
    expect(workspace?.hiddenAt).toBeNull();
    expect(roles.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: victim.id, role: 'editor' }, { userId: member.id, role: 'viewer' },
    ].sort((a, b) => a.userId.localeCompare(b.userId)));
  });

  it('denies cross-tenant and non-admin membership governance without DB mutation', async () => {
    const [, tenantB] = securityTenants;
    const memberB = await createAuthenticatedUser('guest');
    const target = await createAuthenticatedUser('guest');
    workspaceIds.push(memberB.workspaceId!, target.workspaceId!);
    await db.insert(tenants).values(securityTenants.map((id) => ({ id, name: id, status: 'active' })));
    await db.insert(tenantMemberships).values([
      { tenantId: securityTenants[0], userId: user.id, status: 'approved', role: 'admin' },
      { tenantId: tenantB, userId: memberB.id, status: 'approved', role: 'member' },
      { tenantId: tenantB, userId: target.id, status: 'requested', role: 'member' },
    ]);
    await db.insert(oauthClients).values({
      id: securityClientId, clientId: securityClientId, name: securityClientId,
      redirectUris: ['https://security.invalid/callback'], allowedScopes: ['openid'],
      tokenEndpointAuthMethod: 'none', tenantId: tenantB,
    });

    const paths = [
      `/api/v1/tenants/${tenantB}/memberships`, `/api/v1/tenants/${tenantB}/clients`,
      ...['approve', 'reject', 'suspend'].map(
        (decision) => `/api/v1/tenants/${tenantB}/memberships/${target.id}/${decision}`,
      ),
    ];
    for (const actor of [user, memberB]) {
      for (const path of paths) {
        const response = await authenticatedRequest(
          candidate(), path.endsWith('memberships') || path.endsWith('clients') ? 'GET' : 'POST',
          path, actor.sessionToken!,
        );
        expect(response.status, `${actor.id} ${path}`).toBe(403);
      }
    }
    const [unchanged] = await db.select().from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantB), eq(tenantMemberships.userId, target.id),
    ));
    expect(unchanged).toMatchObject({ status: 'requested', approvedByUserId: null, decidedAt: null });
  });

  it('transitions only path-tenant memberships and defines decision replay as conflict', async () => {
    const [tenantA, tenantB] = securityTenants;
    const targets = await Promise.all([
      createAuthenticatedUser('guest'), createAuthenticatedUser('guest'),
      createAuthenticatedUser('guest'),
    ]);
    workspaceIds.push(...targets.map(({ workspaceId }) => workspaceId!));
    await db.insert(tenants).values(securityTenants.map((id) => ({ id, name: id, status: 'active' })));
    await db.insert(tenantMemberships).values([
      { tenantId: tenantB, userId: user.id, status: 'approved', role: 'admin' },
      ...targets.flatMap(({ id }, index) => [
        { tenantId: tenantA, userId: id, status: index === 2 ? 'approved' : 'requested', role: 'member' },
        { tenantId: tenantB, userId: id, status: index === 2 ? 'approved' : 'requested', role: 'member' },
      ]),
    ]);

    const decisions = [
      { name: 'approve', target: targets[0], from: 'requested', to: 'approved' },
      { name: 'reject', target: targets[1], from: 'requested', to: 'rejected' },
      { name: 'suspend', target: targets[2], from: 'approved', to: 'suspended' },
    ] as const;
    for (const decision of decisions) {
      const path = `/api/v1/tenants/${tenantB}/memberships/${decision.target.id}/${decision.name}`;
      const accepted = await authenticatedRequest(candidate(), 'POST', path, user.sessionToken!);
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toEqual({ success: true, status: decision.to });
      const rows = await db.select().from(tenantMemberships)
        .where(eq(tenantMemberships.userId, decision.target.id));
      expect(rows.find(({ tenantId }) => tenantId === tenantA)?.status).toBe(decision.from);
      const changed = rows.find(({ tenantId }) => tenantId === tenantB)!;
      expect(changed).toMatchObject({ status: decision.to, approvedByUserId: user.id });
      expect(changed.decidedAt).not.toBeNull();

      const replay = await authenticatedRequest(candidate(), 'POST', path, user.sessionToken!);
      expect(replay.status).toBe(409);
      await expect(replay.json()).resolves.toEqual({ error: 'Invalid transition' });
      const [afterReplay] = await db.select().from(tenantMemberships).where(and(
        eq(tenantMemberships.tenantId, tenantB), eq(tenantMemberships.userId, decision.target.id),
      ));
      expect(afterReplay).toMatchObject({ status: decision.to, approvedByUserId: user.id });
      expect(afterReplay.decidedAt?.getTime()).toBe(changed.decidedAt?.getTime());
    }
  });

  it('keeps transport authority-neutral and fails composition on unavailable ports', () => {
    const source = readFileSync(
      new URL('../../../packages/cluster-mesh/src/hono/workspaces-router.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/);
    expect(() => createWorkspacesNamespaceModule({
      ports: { ...productWorkspacePorts, tenants: undefined } as unknown as WorkspacesRouterPorts,
    }).createRouter()).toThrowError('workspace product ports are unavailable');
  });
});
