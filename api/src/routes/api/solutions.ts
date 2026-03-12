import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { solutionService } from '../../services/context-solution';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';

const createSolutionSchema = z.object({
  initiativeId: z.string().min(1),
  status: z.enum(['draft', 'validated', 'archived']).optional(),
  data: z.record(z.unknown()).optional(),
});

const updateSolutionSchema = z.object({
  status: z.enum(['draft', 'validated', 'archived']).optional(),
  data: z.record(z.unknown()).optional(),
});

export const solutionsRouter = new Hono();

// List solutions (optionally filtered by initiative_id query param)
solutionsRouter.get('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const initiativeId = c.req.query('initiative_id');
  const items = await solutionService.list(workspaceId, initiativeId || undefined);
  return c.json({ items });
});

// Get single solution
solutionsRouter.get('/:id', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const row = await solutionService.getById(id, workspaceId);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Create solution
solutionsRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', createSolutionSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  try {
    const row = await solutionService.create(workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Update solution
solutionsRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', updateSolutionSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const row = await solutionService.update(id, workspaceId, payload);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Delete solution
solutionsRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const removed = await solutionService.remove(id, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

export default solutionsRouter;
