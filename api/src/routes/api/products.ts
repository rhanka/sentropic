import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { productService } from '../../services/context-product';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';

const createProductSchema = z.object({
  initiativeId: z.string().min(1),
  solutionId: z.string().optional(),
  status: z.enum(['draft', 'active', 'delivered', 'archived']).optional(),
  data: z.record(z.unknown()).optional(),
});

const updateProductSchema = z.object({
  status: z.enum(['draft', 'active', 'delivered', 'archived']).optional(),
  solutionId: z.string().nullable().optional(),
  data: z.record(z.unknown()).optional(),
});

export const productsRouter = new Hono();

// List products (optionally filtered by initiative_id or solution_id)
productsRouter.get('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const initiativeId = c.req.query('initiative_id');
  const solutionId = c.req.query('solution_id');
  const items = await productService.list(workspaceId, {
    initiativeId: initiativeId || undefined,
    solutionId: solutionId || undefined,
  });
  return c.json({ items });
});

// Get single product
productsRouter.get('/:id', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const row = await productService.getById(id, workspaceId);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Create product
productsRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', createProductSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  try {
    const row = await productService.create(workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Update product
productsRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', updateProductSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  try {
    const row = await productService.update(id, workspaceId, payload);
    if (!row) return c.json({ message: 'Not found' }, 404);
    return c.json(row);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Delete product
productsRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const removed = await productService.remove(id, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

export default productsRouter;
