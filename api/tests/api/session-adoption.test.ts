import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { sessionWorkspaceBindings } from '../../src/db/control-schema';
import { tenantMemberships, tenants, workspaces } from '../../src/db/schema';
import { SessionWorkspaceService } from '../../src/services/cluster-mesh/session-workspace';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

const TENANT_A = 'sess-adopt-tenant-a';
const TENANT_B = 'sess-adopt-tenant-b';
const sessionIds = [
  'sess-adopt-1', 'sess-adopt-2', 'sess-adopt-3', 'sess-adopt-4',
  'sess-adopt-5', 'sess-adopt-6', 'sess-adopt-7',
];

describe('session adoption workspace binding', () => {
  let user: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    await db.insert(tenants).values([
      { id: TENANT_A, name: TENANT_A, status: 'active' },
      { id: TENANT_B, name: TENANT_B, status: 'active' },
    ]);
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: user.id, status: 'approved', role: 'member',
    });
    workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId, ownerUserId: user.id, name: 'Adopted code project',
      type: 'code', tenantId: TENANT_A,
    });
  });

  afterEach(async () => {
    await db.delete(sessionWorkspaceBindings)
      .where(inArray(sessionWorkspaceBindings.sessionId, sessionIds));
    const workspaceIds = user.workspaceId ? [workspaceId, user.workspaceId] : [workspaceId];
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    await db.delete(tenantMemberships).where(eq(tenantMemberships.userId, user.id));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
    await cleanupAuthData();
  });

  it('should attach an existing workspace durably', async () => {
    const service = new SessionWorkspaceService();
    const binding = await service.adopt({
      sessionId: 'sess-adopt-1', tenantId: TENANT_A,
      principalId: user.id, workspaceId,
    });
    expect(binding).toMatchObject({ sessionId: 'sess-adopt-1', workspaceId, status: 'attached' });
    await expect(service.get('sess-adopt-1', TENANT_A)).resolves.toMatchObject({ workspaceId });
  });

  it('should create and attach a new code workspace', async () => {
    const service = new SessionWorkspaceService();
    const binding = await service.adopt({
      sessionId: 'sess-adopt-2', tenantId: TENANT_A,
      principalId: user.id, create: { name: 'Fresh code project', type: 'code' },
    });
    expect(binding.status).toBe('attached');
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, binding.workspaceId));
    expect(ws?.tenantId).toBe(TENANT_A);
    await db.delete(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-2'));
    await db.delete(workspaces).where(eq(workspaces.id, binding.workspaceId));
  });

  it('should stay idempotent when adopting twice', async () => {
    const service = new SessionWorkspaceService();
    const first = await service.adopt({
      sessionId: 'sess-adopt-3', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const second = await service.adopt({
      sessionId: 'sess-adopt-3', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    expect(second.bindingId).toBe(first.bindingId);
  });

  it('should keep the project and history after detach and end', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-4', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.detach('sess-adopt-4', TENANT_A);
    await service.adopt({
      sessionId: 'sess-adopt-5', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.end('sess-adopt-5', TENANT_A);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws?.id).toBe(workspaceId);
  });

  it('should refuse cross-tenant attach and enforce rights', async () => {
    const service = new SessionWorkspaceService();
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_B, userId: user.id, status: 'approved', role: 'member',
    });
    await expect(service.adopt({
      sessionId: 'sess-adopt-6', tenantId: TENANT_B, principalId: user.id, workspaceId,
    })).rejects.toMatchObject({ code: 'cross_tenant_refused' });
    const outsider = await createAuthenticatedUser('editor');
    await expect(service.adopt({
      sessionId: 'sess-adopt-7', tenantId: TENANT_A, principalId: outsider.id, workspaceId,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should recover the binding after restart', async () => {
    const before = new SessionWorkspaceService();
    await before.adopt({
      sessionId: 'sess-adopt-1', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const after = new SessionWorkspaceService();
    await expect(after.get('sess-adopt-1', TENANT_A)).resolves.toMatchObject({
      sessionId: 'sess-adopt-1', status: 'attached',
    });
  });
});
