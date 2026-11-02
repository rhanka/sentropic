import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '../../../utils/zod-validator';
import { db } from '../../../db/client';
import { workspaces } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { requireEditor } from '../../../middleware/rbac';
import { createId } from '../../../utils/id';
import { runCmIdentityWrite } from '../../../services/identity/cm-transaction';
import { getUserWorkspaces, requireWorkspaceAdmin } from '../../../services/workspace-access';
import {
  notifyWorkspaceCreated, notifyWorkspaceEvent,
  provisionWorkspace, seedWorkspaceTypeResources,
} from '../../../services/workspace-provisioning';

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
  const prospectiveId = createId();
  const id = await runCmIdentityWrite((tx) =>
    provisionWorkspace(tx, {
      workspaceId: prospectiveId,
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

  // Stack dependency: A2.2's WorkspaceRegistryStore exposes no deletion operation;
  // r6 V2 is a person cascade and cannot authorize deleting another principal.
  // Do not recreate CM cleanup with host SQL or commit partial business destruction.
  return c.json({ error: 'identity_contract_unavailable', message: 'Workspace deletion unavailable.' }, 503);
});

