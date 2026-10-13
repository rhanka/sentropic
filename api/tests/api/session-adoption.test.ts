import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../src/db/client';
import { sessionWorkspaceBindings } from '../../src/db/control-schema';
import {
  agentDefinitions, tenantMemberships, tenants, viewTemplates, workflowDefinitions,
  workflowDefinitionTasks, workspaceMemberships, workspaces, workspaceTypeWorkflows,
} from '../../src/db/schema';
import {
  createDrizzleBindingStore,
  SessionWorkspaceService,
} from '../../src/services/cluster-mesh/session-workspace';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';

const TENANT_A = 'sess-adopt-tenant-a';
const TENANT_B = 'sess-adopt-tenant-b';
const sessionIds = [
  'sess-adopt-1', 'sess-adopt-2', 'sess-adopt-3', 'sess-adopt-4',
  'sess-adopt-5', 'sess-adopt-6', 'sess-adopt-7', 'sess-adopt-8',
  'sess-adopt-9', 'sess-adopt-10', 'sess-adopt-11', 'sess-adopt-12',
  'sess-adopt-13', 'sess-adopt-14', 'sess-adopt-15', 'sess-adopt-16',
  'sess-adopt-17', 'sess-adopt-18', 'sess-adopt-19', 'sess-adopt-20',
  'sess-adopt-21', 'sess-adopt-22', 'sess-adopt-23', 'sess-adopt-24',
  'sess-adopt-25', 'sess-adopt-26', 'sess-adopt-27', 'sess-adopt-28',
  'sess-adopt-29', 'sess-adopt-30',
];

// One-shot forced-interleave hook for the API race tests (m1, m2): the next
// `hasWorkspaceRole` call runs the hook first, then answers normally. The
// hook itself (a full adopt/detach sequence on another service instance) sees
// no hook, so there is no recursion. `vi.mock` is file-scoped but the hook
// is only armed inside the two tests below.
const interleaveHook = vi.hoisted(() => ({ current: null as null | (() => Promise<void>) }));

vi.mock('../../src/services/workspace-access', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/workspace-access')>();
  return {
    ...mod,
    hasWorkspaceRole: async (...args: Parameters<typeof mod.hasWorkspaceRole>) => {
      const hook = interleaveHook.current;
      if (hook) {
        interleaveHook.current = null;
        await hook();
      }
      return mod.hasWorkspaceRole(...args);
    },
  };
});

describe('session adoption workspace binding', () => {
  let user: TestUser;
  let workspaceId: string;

  beforeEach(async () => {
    await db.delete(sessionWorkspaceBindings)
      .where(inArray(sessionWorkspaceBindings.sessionId, sessionIds));
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
      const wfRows = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
        .where(inArray(workflowDefinitions.workspaceId, wsIds));
      const wfIds = wfRows.map((w) => w.id);
      if (wfIds.length > 0) {
        await db.delete(workflowDefinitionTasks)
          .where(inArray(workflowDefinitionTasks.workflowDefinitionId, wfIds));
        await db.delete(workspaceTypeWorkflows)
          .where(inArray(workspaceTypeWorkflows.workflowDefinitionId, wfIds));
      }
      await db.delete(workflowDefinitions).where(inArray(workflowDefinitions.workspaceId, wsIds));
      await db.delete(agentDefinitions).where(inArray(agentDefinitions.workspaceId, wsIds));
      await db.delete(viewTemplates).where(inArray(viewTemplates.workspaceId, wsIds));
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
    await expect(service.get('sess-adopt-1', TENANT_A, user.id)).resolves.toMatchObject({ workspaceId });
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

  it('keeps the control journal structurally ordered and carrying 0011', () => {
    // Recalage rule (see BRANCH.md): contiguous idx, strictly increasing
    // `when`, no future timestamps. 0011 must be present but is NOT pinned
    // as last: later migrations may follow it without breaking this test.
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
    expect(entries.map((entry) => entry.tag)).toContain('0011_session_workspace_bindings');
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
  });

  it('should refuse detach and end when principal is omitted', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-8', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const omitted = undefined as unknown as string;
    await expect(service.detach('sess-adopt-8', TENANT_A, omitted)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.end('sess-adopt-8', TENANT_A, omitted)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should refuse get when principal is omitted', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-9', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await expect(service.get('sess-adopt-9', TENANT_A, undefined as unknown as string))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('should check tenant membership before revealing binding existence', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-10', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const outsider = await createAuthenticatedUser('editor');
    await expect(service.detach('sess-adopt-unknown', TENANT_A, outsider.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });
    await expect(service.get('sess-adopt-10', TENANT_A, outsider.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });
  });

  it('should refuse cross-tenant adopt on a bound session without leaking the tenant', async () => {
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
    })).rejects.toMatchObject({ code: 'session_already_attached' });
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
  });

  it('should emit workspace creation notifications on adopt-create', async () => {
    // m5/m3: observes NOTIFY emission directly (LISTEN on both channels),
    // asserts both payloads carry the created workspace id, and unlistens.
    const client = await pool.connect();
    const seen: Array<{ channel: string; payload: string }> = [];
    let resolveListener: (() => void) | null = null;
    const notificationHandler = (msg: { channel: string; payload?: string }) => {
      seen.push({ channel: msg.channel, payload: msg.payload ?? '' });
      if (resolveListener) resolveListener();
    };
    try {
      client.on('notification', notificationHandler);
      await client.query('LISTEN workspace_events');
      await client.query('LISTEN workspace_membership_events');

      const service = new SessionWorkspaceService();
      const binding = await service.adopt({
        sessionId: 'sess-adopt-25', tenantId: TENANT_A, principalId: user.id,
        create: { name: 'Notified code project', type: 'code' },
      });

      const hasBoth = () =>
        seen.some((s) => s.channel === 'workspace_events' && s.payload.includes(binding.workspaceId))
        && seen.some((s) => s.channel === 'workspace_membership_events' && s.payload.includes(binding.workspaceId));

      if (!hasBoth()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000);
          resolveListener = () => {
            if (hasBoth()) {
              clearTimeout(timer);
              resolve();
            }
          };
        });
      }

      // Assert both channels delivered notifications specific to the created workspace.
      const wsEvents = seen
        .filter((s) => s.channel === 'workspace_events' && s.payload.includes(binding.workspaceId))
        .map((s) => JSON.parse(s.payload));
      expect(wsEvents.length).toBeGreaterThanOrEqual(1);
      expect(wsEvents[0].workspace_id).toBe(binding.workspaceId);
      expect(wsEvents[0].data?.action).toBe('created');

      const memberEvents = seen
        .filter((s) => s.channel === 'workspace_membership_events' && s.payload.includes(binding.workspaceId))
        .map((s) => JSON.parse(s.payload));
      expect(memberEvents.length).toBeGreaterThanOrEqual(1);
      expect(memberEvents[0].workspace_id).toBe(binding.workspaceId);
      expect(memberEvents[0].user_id).toBe(user.id);
      expect(memberEvents[0].data?.action).toBe('added');
      expect(memberEvents[0].data?.role).toBe('admin');
    } finally {
      client.removeListener('notification', notificationHandler);
      await client.query('UNLISTEN *').catch(() => {});
      client.release();
    }
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

  it('should return the already-ended binding on a second end (idempotent)', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-23', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const first = await service.end('sess-adopt-23', TENANT_A, user.id);
    expect(first.status).toBe('ended');
    // Replaying `end` after a timeout must return the ended binding, not an error.
    const second = await service.end('sess-adopt-23', TENANT_A, user.id);
    expect(second).toMatchObject({
      bindingId: first.bindingId, status: 'ended', version: first.version,
    });
  });

  it('should reject concurrent end when CAS loses the race and allow idempotent retry (forced interleave)', async () => {
    // Deterministic m1: the interleave is forced inside `hasWorkspaceRole`
    // (no `Promise.allSettled` race). Outer end reads row at version 1; while
    // resolving workspace rights, inner end commits version 2 (ended). Outer
    // loses the CAS, re-authorizes against the winning state, and fails closed
    // with session_not_attached.
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-29', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    interleaveHook.current = async () => {
      const inner = new SessionWorkspaceService();
      await inner.end('sess-adopt-29', TENANT_A, user.id);
    };
    await expect(service.end('sess-adopt-29', TENANT_A, user.id)).rejects.toMatchObject({
      code: 'session_not_attached',
      message: expect.stringContaining('retry the end'),
    });
    // Idempotent replay with updated version returns the ended binding:
    const replay = await service.end('sess-adopt-29', TENANT_A, user.id);
    expect(replay.status).toBe('ended');
    expect(replay.version).toBe(2);
  });

  it('should refuse a stale end when concurrent race changes binding owner (forced interleave)', async () => {
    // Deterministic m1: forced interleave where concurrent race swaps workspace and owner.
    // Outer end is invoked by original user; while resolving rights on wsA,
    // inner sequence detaches wsA and adopts workspaceB with userB (v3).
    // Outer loses CAS, re-authorizes against workspaceB/userB, and rejects
    // with workspace_rights_refused.
    const regularUser = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: regularUser.id, status: 'approved', role: 'member',
    });
    await db.insert(workspaceMemberships).values({
      workspaceId, userId: regularUser.id, role: 'editor',
    });
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-30', tenantId: TENANT_A, principalId: regularUser.id, workspaceId,
    });
    const userB = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: userB.id, status: 'approved', role: 'member',
    });
    const workspaceB = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceB, ownerUserId: userB.id, name: 'Workspace B',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: workspaceB, userId: userB.id, role: 'admin',
    });

    interleaveHook.current = async () => {
      const inner = new SessionWorkspaceService();
      await inner.detach('sess-adopt-30', TENANT_A, regularUser.id);
      await inner.adopt({
        sessionId: 'sess-adopt-30', tenantId: TENANT_A, principalId: userB.id, workspaceId: workspaceB,
      });
    };
    await expect(service.end('sess-adopt-30', TENANT_A, regularUser.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });

    // The re-attached binding remains intact: workspaceB, userB, attached, v3.
    await expect(service.get('sess-adopt-30', TENANT_A, userB.id)).resolves.toMatchObject({
      workspaceId: workspaceB, principalId: userB.id, status: 'attached', version: 3,
    });
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
    await expect(service.get('sess-adopt-9', TENANT_A, user.id)).resolves.toMatchObject({ workspaceId });
    await expect(service.get('sess-adopt-9', TENANT_B, user.id)).resolves.toBeNull();
  });

  it('should recover the binding after restart', async () => {
    const before = new SessionWorkspaceService();
    await before.adopt({
      sessionId: 'sess-adopt-1', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const after = new SessionWorkspaceService();
    await expect(after.get('sess-adopt-1', TENANT_A, user.id)).resolves.toMatchObject({
      sessionId: 'sess-adopt-1', status: 'attached',
    });
  });

  it('should track monotonic version on bindings through state transitions', async () => {
    const service = new SessionWorkspaceService();
    const binding = await service.adopt({
      sessionId: 'sess-adopt-17', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    expect((binding as { version?: number }).version).toBe(1);

    const detached = await service.detach('sess-adopt-17', TENANT_A, user.id);
    expect((detached as { version?: number }).version).toBe(2);

    const reattached = await service.adopt({
      sessionId: 'sess-adopt-17', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    expect((reattached as { version?: number }).version).toBe(3);

    const ended = await service.end('sess-adopt-17', TENANT_A, user.id);
    expect((ended as { version?: number }).version).toBe(4);
  });

  it('should prevent ABA detach race from overwriting a re-attached workspace', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-18', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });

    const userB = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: userB.id, status: 'approved', role: 'member',
    });
    const workspaceB = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceB, ownerUserId: userB.id, name: 'Workspace B',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: workspaceB, userId: userB.id, role: 'admin',
    });

    // Interleave detach by user and re-attach by userB
    await service.detach('sess-adopt-18', TENANT_A, user.id);
    await service.adopt({
      sessionId: 'sess-adopt-18', tenantId: TENANT_A, principalId: userB.id, workspaceId: workspaceB,
    });

    // Stale detach from original user (who has no rights on workspace B) must be refused
    await expect(service.detach('sess-adopt-18', TENANT_A, user.id))
      .rejects.toMatchObject({ code: 'workspace_rights_refused' });

    // The current binding must still point to workspaceB and userB
    const current = await service.get('sess-adopt-18', TENANT_A, userB.id);
    expect(current?.workspaceId).toBe(workspaceB);
    expect(current?.principalId).toBe(userB.id);
    expect(current?.status).toBe('attached');
  });

  it('should refuse a stale workspace-admin detach after a re-attach (forced interleave)', async () => {
    // Deterministic m1: the interleave is forced inside `hasWorkspaceRole`
    // (no `Promise.allSettled` race). Mutation record: removing both
    // `expectedVersion: existing.version` and the `version === read + 1`
    // post-control from `detach` lets this detach workspaceB (no rejection).
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-24', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    // Workspace admin of wsA only (approved tenant member, not tenant admin).
    const workspaceAdmin = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: workspaceAdmin.id, status: 'approved', role: 'member',
    });
    await db.insert(workspaceMemberships).values({
      workspaceId, userId: workspaceAdmin.id, role: 'admin',
    });
    const userB = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: userB.id, status: 'approved', role: 'member',
    });
    const workspaceB = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceB, ownerUserId: userB.id, name: 'Workspace B',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: workspaceB, userId: userB.id, role: 'admin',
    });

    // Forced interleave: while the outer detach resolves rights on wsA, the
    // owner detaches wsA and userB re-attaches workspaceB (v3) first.
    interleaveHook.current = async () => {
      const inner = new SessionWorkspaceService();
      await inner.detach('sess-adopt-24', TENANT_A, user.id);
      await inner.adopt({
        sessionId: 'sess-adopt-24', tenantId: TENANT_A, principalId: userB.id, workspaceId: workspaceB,
      });
    };
    await expect(service.detach('sess-adopt-24', TENANT_A, workspaceAdmin.id))
      .rejects.toMatchObject({ code: 'session_not_attached' });

    // The re-attached binding is intact: workspaceB, userB, attached, v3.
    await expect(service.get('sess-adopt-24', TENANT_A, userB.id)).resolves.toMatchObject({
      workspaceId: workspaceB, principalId: userB.id, status: 'attached', version: 3,
    });
  });

  it('should never disclose a re-attached binding to an admin of the previous workspace', async () => {
    // Deterministic m2: same forced interleave through `get`. The caller
    // administers wsA only; the row moves to workspaceB mid-read, so `get`
    // must observe nothing (not the workspaceB binding with its principalId).
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-26', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const workspaceAdmin = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: workspaceAdmin.id, status: 'approved', role: 'member',
    });
    await db.insert(workspaceMemberships).values({
      workspaceId, userId: workspaceAdmin.id, role: 'admin',
    });
    const userB = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: userB.id, status: 'approved', role: 'member',
    });
    const workspaceB = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceB, ownerUserId: userB.id, name: 'Workspace B',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId: workspaceB, userId: userB.id, role: 'admin',
    });

    interleaveHook.current = async () => {
      const inner = new SessionWorkspaceService();
      await inner.detach('sess-adopt-26', TENANT_A, user.id);
      await inner.adopt({
        sessionId: 'sess-adopt-26', tenantId: TENANT_A, principalId: userB.id, workspaceId: workspaceB,
      });
    };
    await expect(service.get('sess-adopt-26', TENANT_A, workspaceAdmin.id)).resolves.toBeNull();
  });

  it('should reject a stale compareAndSet that differs only by version (pure ABA)', async () => {
    // Mutation record: removing `eq(sessionWorkspaceBindings.version, …)`
    // from the store WHERE lets this write through (returns true).
    const store = createDrizzleBindingStore(db);
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-19', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const stale = await store.findBySession('sess-adopt-19');
    expect(stale?.version).toBe(1);
    // Concurrent commit advances ONLY the version (same status, workspace, principal).
    await db.update(sessionWorkspaceBindings).set({ version: 2 })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-19'));
    const timestamp = new Date().toISOString();
    await expect(store.compareAndSet(stale!, {
      ...stale!, status: 'detached', version: 2, updatedAt: timestamp, detachedAt: timestamp,
    })).resolves.toBe(false);
  });

  it('should reject a stale compareAndSet that differs only by status', async () => {
    // Mutation record: removing `eq(sessionWorkspaceBindings.status, …)`
    // from the store WHERE lets this write through (returns true).
    const store = createDrizzleBindingStore(db);
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-20', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const stale = await store.findBySession('sess-adopt-20');
    expect(stale?.status).toBe('attached');
    // Concurrent commit flips ONLY the status (same version, workspace, principal).
    await db.update(sessionWorkspaceBindings).set({ status: 'detached' })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-20'));
    const timestamp = new Date().toISOString();
    await expect(store.compareAndSet(stale!, {
      ...stale!, status: 'detached', version: 2, updatedAt: timestamp, detachedAt: timestamp,
    })).resolves.toBe(false);
  });

  it('should reject a stale compareAndSet that differs only by workspace', async () => {
    // Mutation record: removing `eq(sessionWorkspaceBindings.workspaceId, …)`
    // from the store WHERE lets this write through (returns true).
    const store = createDrizzleBindingStore(db);
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-21', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const stale = await store.findBySession('sess-adopt-21');
    expect(stale?.workspaceId).toBe(workspaceId);
    // Concurrent commit moves ONLY the workspace (same version, status, principal).
    await db.update(sessionWorkspaceBindings).set({ workspaceId: crypto.randomUUID() })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-21'));
    const timestamp = new Date().toISOString();
    await expect(store.compareAndSet(stale!, {
      ...stale!, status: 'detached', version: 2, updatedAt: timestamp, detachedAt: timestamp,
    })).resolves.toBe(false);
  });

  it('should reject a stale compareAndSet that differs only by principal', async () => {
    // Mutation record: removing `eq(sessionWorkspaceBindings.principalId, …)`
    // from the store WHERE lets this write through (returns true).
    const store = createDrizzleBindingStore(db);
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-22', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const stale = await store.findBySession('sess-adopt-22');
    expect(stale?.principalId).toBe(user.id);
    // Concurrent commit swaps ONLY the principal (same version, status, workspace).
    await db.update(sessionWorkspaceBindings).set({ principalId: crypto.randomUUID() })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-22'));
    const timestamp = new Date().toISOString();
    await expect(store.compareAndSet(stale!, {
      ...stale!, status: 'detached', version: 2, updatedAt: timestamp, detachedAt: timestamp,
    })).resolves.toBe(false);
  });

  it('should reject a stale compareAndSet for a session when another session shares the same state tuple (sessionId predicate)', async () => {
    // Mutation record: removing `eq(sessionWorkspaceBindings.sessionId, …)`
    // from the store WHERE lets this write through (returns true) by updating
    // sess-adopt-28 instead of failing on sess-adopt-27.
    const store = createDrizzleBindingStore(db);
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-27', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    await service.adopt({
      sessionId: 'sess-adopt-28', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const staleA = await store.findBySession('sess-adopt-27');
    const rowBBefore = await store.findBySession('sess-adopt-28');
    expect(staleA?.version).toBe(1);
    expect(rowBBefore?.version).toBe(1);
    // Both sessions now share the exact same state tuple:
    // status='attached', workspaceId, principalId, version=1.
    // Advance sess-adopt-27 to version 2 so staleA (version 1) is stale.
    await db.update(sessionWorkspaceBindings).set({ version: 2 })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-adopt-27'));

    const timestamp = new Date().toISOString();
    await expect(store.compareAndSet(staleA!, {
      ...staleA!, status: 'detached', version: 2, updatedAt: timestamp, detachedAt: timestamp,
    })).resolves.toBe(false);

    // Verify sess-adopt-28 was NOT touched by the stale CAS attempt on sess-adopt-27.
    const rowBAfter = await store.findBySession('sess-adopt-28');
    expect(rowBAfter?.sessionId).toBe('sess-adopt-28');
    expect(rowBAfter?.version).toBe(1);
    expect(rowBAfter?.status).toBe('attached');
    expect(rowBAfter?.workspaceId).toBe(workspaceId);
    expect(rowBAfter?.principalId).toBe(user.id);
  });

  it('should hide the binding on get from a tenant member who is neither owner nor admin', async () => {
    const service = new SessionWorkspaceService();
    await service.adopt({
      sessionId: 'sess-adopt-3', tenantId: TENANT_A, principalId: user.id, workspaceId,
    });
    const member = await createAuthenticatedUser('editor');
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: member.id, status: 'approved', role: 'member',
    });
    await expect(service.get('sess-adopt-3', TENANT_A, member.id)).resolves.toBeNull();
  });
});
