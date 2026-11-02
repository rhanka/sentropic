import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../../utils/zod-validator';
import { db } from '../../../db/client';
import {
  chatGenerationTraces,
  chatSessions,
  contextDocuments,
  jobQueue,
  initiatives,
  folders,
  organizations,
  workspaces,
  workflowDefinitionTasks,
  workflowDefinitions,
  agentDefinitions,
  workspaceTypeWorkflows,
  executionRuns,
  executionEvents,
  entityLinks,
  guardrails,
  viewTemplates,
} from '../../../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { requireEditor } from '../../../middleware/rbac';
import { getUserWorkspaces, requireWorkspaceAdmin } from '../../../services/workspace-access';
import {
  notifyWorkspaceCreated, notifyWorkspaceEvent,
  provisionWorkspace, seedWorkspaceTypeResources,
} from '../../../services/workspace-provisioning';
import {
  listCmWorkspaceMembers,
  removeCmWorkspaceMember,
} from '../../../services/identity/cm-tenancy';
import {
  captureConnectorGrantsForTeardown,
  recordConnectorGrantTombstones,
  revokeCapturedConnectorGrants,
} from '../../../services/connector-grant-teardown';

export const workspacesRouter = new Hono();

workspacesRouter.get('/', async (c) => {
  const user = c.get('user') as { userId: string };
  const items = await getUserWorkspaces(user.userId);
  return c.json({ items });
});

const workspaceTypeSchema = z.enum(['neutral', 'ai-priorities', 'opportunity', 'code']);
export type WorkspaceType = z.infer<typeof workspaceTypeSchema>;

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(128),
  type: workspaceTypeSchema.default('ai-priorities'),
});

// Create workspace: creator becomes admin member
workspacesRouter.post('/', requireEditor, zValidator('json', createWorkspaceSchema), async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const { name, type } = c.req.valid('json');

  // Neutral workspaces are auto-created on registration; users cannot manually create them.
  if (type === 'neutral') {
    return c.json({ error: 'Neutral workspaces cannot be created manually' }, 400);
  }

  // Canonical rows via the shared provisioning service (same gate config,
  // same creator-as-admin membership, same transaction atomicity).
  const id = await db.transaction((tx) =>
    provisionWorkspace(tx, {
      ownerUserId: user.userId,
      name,
      type: type as import('../../../services/workspace-access').WorkspaceType,
    }),
  );

  // Seed default workflows/agents (§7.6, §8.1) and view templates (§12.6)
  // via the shared provisioning path (same steps as session adoption).
  await seedWorkspaceTypeResources({
    userId: user.userId, role: user.role, workspaceId: id,
    type: type as import('../../../services/workspace-access').WorkspaceType,
  });

  await notifyWorkspaceCreated(id, user.userId);

  return c.json({ id }, 201);
});

// Update workspace metadata (admin-only)
const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().optional(),
});

workspacesRouter.put('/:id', requireEditor, zValidator('json', updateWorkspaceSchema), async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id')!;

  // Workspace type is immutable after creation.
  const { name, type } = c.req.valid('json');
  if (type !== undefined) {
    return c.json({ error: 'Workspace type cannot be changed after creation' }, 400);
  }

  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }
  const now = new Date();
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) return c.json({ message: 'Not found' }, 404);
  await db.update(workspaces).set({ name, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'renamed' });
  return c.json({ success: true });
});

// Update gate_config for a workspace (admin-only)
const gateConfigSchema = z.object({
  mode: z.enum(['free', 'soft', 'hard']),
  stages: z.array(z.string()),
  criteria: z.record(z.string(), z.object({
    required_fields: z.array(z.string()),
    guardrail_categories: z.array(z.string()),
  })).optional(),
});

workspacesRouter.patch('/:id/gate-config', requireEditor, zValidator('json', gateConfigSchema), async (c) => {
  const user = c.get('user') as { userId: string; role: string };
  const workspaceId = c.req.param('id')!;

  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const [ws] = await db
    .select({ id: workspaces.id, type: workspaces.type })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return c.json({ message: 'Not found' }, 404);

  // Neutral workspaces do not support gate config
  if (ws.type === 'neutral') {
    return c.json({ error: 'Neutral workspaces do not support gate configuration' }, 400);
  }

  const gateConfig = c.req.valid('json');
  const now = new Date();
  await db.update(workspaces).set({ gateConfig, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'gate_config_updated' });
  return c.json({ success: true, gate_config: gateConfig });
});

// --- Hide / Unhide / Delete (admin-only) ---

workspacesRouter.post('/:id/hide', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id')!;
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const now = new Date();
  await db.update(workspaces).set({ hiddenAt: now, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'hidden' });
  return c.json({ success: true });
});

workspacesRouter.post('/:id/unhide', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id')!;
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const now = new Date();
  await db.update(workspaces).set({ hiddenAt: null, updatedAt: now }).where(eq(workspaces.id, workspaceId));
  await notifyWorkspaceEvent(workspaceId, { action: 'unhidden' });
  return c.json({ success: true });
});

// Hard delete (only if hidden)
workspacesRouter.delete('/:id', requireEditor, async (c) => {
  const user = c.get('user') as { userId: string; role: string };

  const workspaceId = c.req.param('id')!;
  try {
    await requireWorkspaceAdmin(user.userId, workspaceId);
  } catch {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const [ws] = await db
    .select({ hiddenAt: workspaces.hiddenAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return c.json({ message: 'Not found' }, 404);
  if (!ws.hiddenAt) return c.json({ message: 'Workspace must be hidden before deletion' }, 400);

  const members = await listCmWorkspaceMembers(workspaceId);
  const memberUserIds = members.map((m) => m.userId);

  // Capture external grants BEFORE the deletion. This path deletes a workspace only, but connector
  // rows cascade from `workspaces` too, and they belong to EVERY member — not just the caller — so
  // the scope here is the workspace, not the acting user. See services/connector-grant-teardown.ts.
  const capturedGrants = await captureConnectorGrantsForTeardown({ workspaceId });

  await db.transaction(async (tx) => {
    // Atomic with the destruction.
    await recordConnectorGrantTombstones(tx, capturedGrants);

    // Detach traces that use workspace FK (optional; keep history)
    await tx.update(chatGenerationTraces).set({ workspaceId: null }).where(eq(chatGenerationTraces.workspaceId, workspaceId));

    // Delete chat sessions scoped to workspace (cascades to messages/contexts/events via FK)
    await tx.delete(chatSessions).where(eq(chatSessions.workspaceId, workspaceId));

    // Documents (versions cascade)
    await tx.delete(contextDocuments).where(eq(contextDocuments.workspaceId, workspaceId));

    // Jobs (history references are set null)
    await tx.delete(jobQueue).where(eq(jobQueue.workspaceId, workspaceId));

    // BR-04 tables: execution events/runs, entity links, guardrails
    await tx.delete(executionEvents).where(eq(executionEvents.workspaceId, workspaceId));
    await tx.delete(executionRuns).where(eq(executionRuns.workspaceId, workspaceId));
    await tx.delete(entityLinks).where(eq(entityLinks.workspaceId, workspaceId));
    await tx.delete(guardrails).where(eq(guardrails.workspaceId, workspaceId));

    // BR-04 tables: workflow tasks → workflow definitions → workspace type workflows, agent definitions
    const wfIds = (await tx.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, workspaceId))).map(r => r.id);
    if (wfIds.length > 0) {
      await tx.delete(workflowDefinitionTasks).where(inArray(workflowDefinitionTasks.workflowDefinitionId, wfIds));
      await tx.delete(workspaceTypeWorkflows).where(inArray(workspaceTypeWorkflows.workflowDefinitionId, wfIds));
    }
    await tx.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, workspaceId));
    await tx.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, workspaceId));

    // BR-04B: view templates
    await tx.delete(viewTemplates).where(eq(viewTemplates.workspaceId, workspaceId));

    // Core business tables
    await tx.delete(initiatives).where(eq(initiatives.workspaceId, workspaceId));
    await tx.delete(folders).where(eq(folders.workspaceId, workspaceId));
    await tx.delete(organizations).where(eq(organizations.workspaceId, workspaceId));

    // Finally delete workspace
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  // Lot A4: memberships live in the CM store; remove them after the business commit.
  for (const memberUserId of memberUserIds) {
    await removeCmWorkspaceMember(workspaceId, memberUserId);
  }

  // Only after a successful commit.
  await revokeCapturedConnectorGrants(capturedGrants);

  await notifyWorkspaceEvent(workspaceId, { action: 'deleted' }, memberUserIds);

  return c.body(null, 204);
});

