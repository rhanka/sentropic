import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import { sessionWorkspaceBindings } from '../../src/db/control-schema';
import {
  tenantMemberships, tenants, viewTemplates, workflowDefinitions,
  workspaceMemberships, workspaces,
} from '../../src/db/schema';
import { SessionWorkspaceService } from '../../src/services/cluster-mesh/session-workspace';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

const TENANT_A = 'sess-adopt-tenant-a';
const TENANT_B = 'sess-adopt-tenant-b';
const sessionIds = [
  'sess-adopt-1', 'sess-adopt-2', 'sess-adopt-3', 'sess-adopt-4',
  'sess-adopt-5', 'sess-adopt-6', 'sess-adopt-7', 'sess-adopt-8',
  'sess-adopt-9', 'sess-adopt-10', 'sess-adopt-11', 'sess-adopt-12',
  'sess-adopt-13', 'sess-adopt-14', 'sess-adopt-15', 'sess-adopt-16',
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
    await db.insert(workspaceMemberships).values({
      workspaceId, userId: user.id, role: 'admin',
    });
  });

  afterEach(async () => {
    await db.delete(sessionWorkspaceBindings)
      .where(inArray(sessionWorkspaceBindings.sessionId, sessionIds));
    const tenantWorkspaces = await db.select({ id: workspaces.id }).from(workspaces)
      .where(inArray(workspaces.tenantId, [TENANT_A, TENANT_B]));
    const wsIds = tenantWorkspaces.map((w) => w.id);
    if (user.workspaceId) wsIds.push(user.workspaceId);
    if (wsIds.length > 0) {
      await db.delete(workspaceMemberships).where(inArray(workspaceMemberships.workspaceId, wsIds));
      await db.delete(workspaces).where(inArray(workspaces.id, wsIds));
    }
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

  it('keeps the control journal structurally ordered with 0011 last and no future when', () => {
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'drizzle/control/meta/_journal.json'), 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const { entries } = journal;
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      if (index > 0) expect(entry.when).toBeGreaterThan(entries[index - 1]!.when);
      expect(entry.when).toBeLessThanOrEqual(Date.now());
    });
    expect(entries[entries.length - 1]!.tag).toBe('0011_session_workspace_bindings');
  });

  it('should keep the project and history after detach and end', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-4', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.detach('sess-adopt-4', TENANT_A, user.id);
    await service.adopt({
      sessionId: 'sess-adopt-5', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.end('sess-adopt-5', TENANT_A, user.id);
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws?.id).toBe(workspaceId);
  });

  it('should enforce workspace role on attach and refuse unauthorized member', async () => {
    const service = new SessionWorkspaceService();
    const viewer = await createAuthenticatedUser('viewer');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: viewer.id, status: 'approved', role: 'member',
    });
    await expect(service.adopt({
      sessionId: 'sess-adopt-7', tenantId: TENANT_A, principalId: viewer.id, workspaceId,
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should enforce rights on detach and end: refuse non-owner non-admin', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({ sessionId: 'sess-adopt-4', tenantId: TENANT_A, principalId: user.id, workspaceId });
    const outsider = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({ tenantId: TENANT_A, userId: outsider.id, status: 'approved', role: 'member' });
    await expect(service.detach('sess-adopt-4', TENANT_A, outsider.id)).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    await expect(service.end('sess-adopt-4', TENANT_A, outsider.id)).rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should uniformize cross-tenant attach to workspace_not_found to prevent oracles', async () => {
    const service = new SessionWorkspaceService();
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_B, userId: user.id, status: 'approved', role: 'member',
    });
    await expect(service.adopt({
      sessionId: 'sess-adopt-6', tenantId: TENANT_B, principalId: user.id, workspaceId,
    })).rejects.toMatchObject({ code: 'workspace_not_found' });
  });

  it('should grant admin membership and validate type/name on workspace creation', async () => {
    const service = new SessionWorkspaceService();
    const binding = await service.adopt({
      sessionId: 'sess-adopt-2', tenantId: TENANT_A, principalId: user.id,
      create: { name: 'Fresh code project', type: 'code' },
    });
    const [membership] = await db.select().from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, binding.workspaceId));
    expect(membership?.userId).toBe(user.id);
    expect(membership?.role).toBe('admin');
    await expect(service.adopt({
      sessionId: 'sess-adopt-7', tenantId: TENANT_A, principalId: user.id,
      create: { name: 'Neutral WS', type: 'neutral' },
    })).rejects.toMatchObject({ code: 'invalid_request' });
    await db.delete(sessionWorkspaceBindings).where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-2'));
    await db.delete(workspaces).where(eq(workspaces.id, binding.workspaceId));
  });

  it('should refuse detach and end when principal is omitted', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-8', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await expect(service.detach('sess-adopt-8', TENANT_A)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.end('sess-adopt-8', TENANT_A)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse get when principal is omitted', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-9', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const getMissingPrincipal = (
      service.get as unknown as (
        sessionId: string, tenantId: string, principalId?: string,
      ) => Promise<unknown>
    ).bind(service);
    await expect(getMissingPrincipal('sess-adopt-9', TENANT_A)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should check tenant membership before revealing binding existence', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-10', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const outsider = await createAuthenticatedUser('editor');
    await expect(service.detach('sess-adopt-unknown', TENANT_A, outsider.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const getAsOutsider = (
      service.get as unknown as (
        sessionId: string, tenantId: string, principalId: string,
      ) => Promise<unknown>
    ).bind(service);
    await expect(getAsOutsider('sess-adopt-10', TENANT_A, outsider.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should hide cross-tenant bindings as binding_not_found on adopt', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-11', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_B, userId: user.id, status: 'approved', role: 'member',
    });
    await expect(service.adopt({
      sessionId: 'sess-adopt-11', tenantId: TENANT_B, principalId: user.id,
      create: { name: 'Probe code project', type: 'code' },
    })).rejects.toMatchObject({ code: 'binding_not_found' });
  });

  it('should refuse workspace creation via adoption for global guest role', async () => {
    const service = new SessionWorkspaceService();
    const guest = await createAuthenticatedUser('guest');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: guest.id, status: 'approved', role: 'member',
    });
    await expect(service.adopt({
      sessionId: 'sess-adopt-12', tenantId: TENANT_A, principalId: guest.id,
      create: { name: 'Guest code project', type: 'code' },
    })).rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should seed workflows and views like canonical creation on adopt-create', async () => {
    const service = new SessionWorkspaceService();
    const binding = await service.adopt({
      sessionId: 'sess-adopt-13', tenantId: TENANT_A, principalId: user.id,
      create: { name: 'Seeded code project', type: 'code' },
    });
    const flows = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
      .where(eq(workflowDefinitions.workspaceId, binding.workspaceId));
    expect(flows.length).toBeGreaterThan(0);
    const views = await db.select({ id: viewTemplates.id }).from(viewTemplates)
      .where(eq(viewTemplates.workspaceId, binding.workspaceId));
    expect(views.length).toBeGreaterThan(0);
    await db.delete(sessionWorkspaceBindings).where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-13'));
    await db.delete(workspaces).where(eq(workspaces.id, binding.workspaceId));
  });

  it('should enforce editor threshold on attach for workspace members', async () => {
    const service = new SessionWorkspaceService();
    const member = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: member.id, status: 'approved', role: 'member',
    });
    await db.insert(workspaceMemberships).values({ workspaceId, userId: member.id, role: 'viewer' });
    const attempt = {
      sessionId: 'sess-adopt-14', tenantId: TENANT_A, principalId: member.id, workspaceId,
    };
    await expect(service.adopt(attempt)).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    const scope = and(
      eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, member.id),
    );
    await db.update(workspaceMemberships).set({ role: 'commenter' }).where(scope);
    await expect(service.adopt(attempt)).rejects.toMatchObject({ code: 'workspace_rights_refused' });
    await db.update(workspaceMemberships).set({ role: 'editor' }).where(scope);
    await expect(service.adopt(attempt)).resolves.toMatchObject({ status: 'attached' });
  });

  it('should allow a tenant admin to detach a session they do not own', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-15', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const admin = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: admin.id, status: 'approved', role: 'admin',
    });
    await expect(service.detach('sess-adopt-15', TENANT_A, admin.id))
      .resolves.toMatchObject({ status: 'detached' });
  });

  it('should keep ended sessions immutable via the API', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-16', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.end('sess-adopt-16', TENANT_A, user.id);
    await expect(service.adopt({
      sessionId: 'sess-adopt-16', tenantId: TENANT_A, principalId: user.id, workspaceId,
    })).rejects.toMatchObject({ code: 'session_ended' });
    await expect(service.detach('sess-adopt-16', TENANT_A, user.id))
      .rejects.toMatchObject({ code: 'session_ended' });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(ws?.id).toBe(workspaceId);
  });

  it('should conflict concurrent adopts of different workspaces', async () => {
    const service = new SessionWorkspaceService();
    const secondWorkspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: secondWorkspaceId, ownerUserId: user.id, name: 'Second code project',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: secondWorkspaceId, userId: user.id, role: 'admin',
    });
    const outcomes = await Promise.allSettled([
      service.adopt({ sessionId: 'sess-adopt-12', tenantId: TENANT_A, principalId: user.id, workspaceId }),
      service.adopt({
        sessionId: 'sess-adopt-12', tenantId: TENANT_A, principalId: user.id, workspaceId: secondWorkspaceId,
      }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ status: 'fulfilled', value: { status: 'attached' } });
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'session_already_attached' });
  });

  it('should leave no orphan workspace when concurrent creates race', async () => {
    const service = new SessionWorkspaceService();
    const countTenantWorkspaces = async (): Promise<number> => (
      await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.tenantId, TENANT_A))
    ).length;
    const before = await countTenantWorkspaces();
    const outcomes = await Promise.allSettled([
      service.adopt({
        sessionId: 'sess-adopt-13', tenantId: TENANT_A, principalId: user.id,
        create: { name: 'Race A project', type: 'code' },
      }),
      service.adopt({
        sessionId: 'sess-adopt-13', tenantId: TENANT_A, principalId: user.id,
        create: { name: 'Race B project', type: 'code' },
      }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'session_already_attached' });
    expect(await countTenantWorkspaces() - before).toBe(1);
  });

  it('should scope get to the tenant for approved members', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-9', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_B, userId: user.id, status: 'approved', role: 'member',
    });
    const getAsMember = (
      service.get as unknown as (
        sessionId: string, tenantId: string, principalId: string,
      ) => Promise<unknown>
    ).bind(service);
    await expect(getAsMember('sess-adopt-9', TENANT_A, user.id)).resolves.toMatchObject({ workspaceId });
    await expect(getAsMember('sess-adopt-9', TENANT_B, user.id)).resolves.toBeNull();
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
