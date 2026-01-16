import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireWorkspaceAccessRole, requireWorkspaceAdminRole, requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { acquireLock, forceUnlock, getActiveLock, requestUnlock, releaseLock, type LockObjectType } from '../../services/lock-service';
import { listPresence, recordPresence, removePresence } from '../../services/lock-presence';

export const locksRouter = new Hono();

function isHttpError(e: unknown): e is { status: number } {
  if (!e || typeof e !== 'object') return false;
  if (!('status' in e)) return false;
  const status = (e as Record<string, unknown>).status;
  return typeof status === 'number';
}

const objectTypeSchema = z.enum(['organization', 'folder', 'usecase']);

const lockQuerySchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
});

locksRouter.get('/', zValidator('query', lockQuerySchema), async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const q = c.req.valid('query');
  const lock = await getActiveLock(user.workspaceId, q.objectType as LockObjectType, q.objectId);
  return c.json({ lock });
});

const acquireSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
  ttlMs: z.number().int().min(5_000).max(6 * 60 * 60 * 1000).optional(),
});

locksRouter.post('/', requireWorkspaceEditorRole(), zValidator('json', acquireSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const body = c.req.valid('json');
  const { lock, acquired } = await acquireLock({
    userId: user.userId,
    workspaceId: user.workspaceId,
    objectType: body.objectType as LockObjectType,
    objectId: body.objectId,
    ttlMs: body.ttlMs,
  });
  if (!acquired) {
    return c.json({ lock, acquired: false }, 409);
  }
  return c.json({ lock, acquired: true }, 201);
});

locksRouter.delete('/', requireWorkspaceEditorRole(), zValidator('query', lockQuerySchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const q = c.req.valid('query');
  try {
    const res = await releaseLock({
      userId: user.userId,
      workspaceId: user.workspaceId,
      objectType: q.objectType as LockObjectType,
      objectId: q.objectId,
    });
    return c.json(res);
  } catch (e: unknown) {
    if (isHttpError(e) && e.status === 403) return c.json({ error: 'Insufficient permissions' }, 403);
    throw e;
  }
});

const requestUnlockSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
  message: z.string().max(500).optional(),
});

locksRouter.post('/request-unlock', requireWorkspaceEditorRole(), zValidator('json', requestUnlockSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const body = c.req.valid('json');
  const res = await requestUnlock({
    userId: user.userId,
    workspaceId: user.workspaceId,
    objectType: body.objectType as LockObjectType,
    objectId: body.objectId,
    message: body.message,
  });
  return c.json(res);
});

const forceUnlockSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
});

locksRouter.post('/force-unlock', requireWorkspaceAdminRole(), zValidator('json', forceUnlockSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const body = c.req.valid('json');
  try {
    const res = await forceUnlock({
      userId: user.userId,
      workspaceId: user.workspaceId,
      objectType: body.objectType as LockObjectType,
      objectId: body.objectId,
    });
    return c.json(res);
  } catch (e: unknown) {
    if (isHttpError(e) && e.status === 403) return c.json({ error: 'Insufficient permissions' }, 403);
    throw e;
  }
});

const presenceSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
});

locksRouter.get('/presence', requireWorkspaceAccessRole(), zValidator('query', presenceSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string; email?: string | null; displayName?: string | null };
  const q = c.req.valid('query');
  const snapshot = listPresence({
    workspaceId: user.workspaceId,
    objectType: q.objectType as LockObjectType,
    objectId: q.objectId,
  });
  return c.json(snapshot);
});

locksRouter.post('/presence', requireWorkspaceAccessRole(), zValidator('json', presenceSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string; email?: string | null; displayName?: string | null };
  const body = c.req.valid('json');
  const snapshot = await recordPresence({
    workspaceId: user.workspaceId,
    objectType: body.objectType as LockObjectType,
    objectId: body.objectId,
    user: {
      userId: user.userId,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
    },
  });
  return c.json(snapshot);
});

locksRouter.post('/presence/leave', requireWorkspaceAccessRole(), zValidator('json', presenceSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const body = c.req.valid('json');
  const snapshot = await removePresence({
    workspaceId: user.workspaceId,
    objectType: body.objectType as LockObjectType,
    objectId: body.objectId,
    userId: user.userId,
  });
  return c.json(snapshot);
});

locksRouter.delete('/presence', requireWorkspaceAccessRole(), zValidator('query', presenceSchema), async (c) => {
  const user = c.get('user') as { userId: string; workspaceId: string };
  const q = c.req.valid('query');
  const snapshot = await removePresence({
    workspaceId: user.workspaceId,
    objectType: q.objectType as LockObjectType,
    objectId: q.objectId,
    userId: user.userId,
  });
  return c.json(snapshot);
});

