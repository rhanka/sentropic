import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { bidService } from '../../services/context-bid';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';

const createBidSchema = z.object({
  initiativeId: z.string().min(1),
  status: z.enum(['draft', 'review', 'finalized', 'contract']).optional(),
  data: z.record(z.unknown()).optional(),
});

const updateBidSchema = z.object({
  status: z.enum(['draft', 'review', 'finalized', 'contract']).optional(),
  data: z.record(z.unknown()).optional(),
});

const attachProductSchema = z.object({
  productId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

export const bidsRouter = new Hono();

// List bids (optionally filtered by initiative_id)
bidsRouter.get('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const initiativeId = c.req.query('initiative_id');
  const items = await bidService.list(workspaceId, initiativeId || undefined);
  return c.json({ items });
});

// Get single bid
bidsRouter.get('/:id', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const row = await bidService.getById(id, workspaceId);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Create bid
bidsRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', createBidSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  try {
    const row = await bidService.create(workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Update bid
bidsRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', updateBidSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const row = await bidService.update(id, workspaceId, payload);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Delete bid (cascades to bid_products)
bidsRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const removed = await bidService.remove(id, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

// --- bid_products junction ---

// List products attached to a bid
bidsRouter.get('/:id/products', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const bidId = c.req.param('id');
  try {
    const items = await bidService.listProducts(bidId, workspaceId);
    return c.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Attach product to bid
bidsRouter.post('/:id/products', requireEditor, requireWorkspaceEditorRole(), zValidator('json', attachProductSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const bidId = c.req.param('id');
  const payload = c.req.valid('json');
  try {
    const row = await bidService.attachProduct(bidId, workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    // Unique constraint violation
    if (message.includes('unique') || message.includes('duplicate')) {
      return c.json({ message: 'Product already attached to bid' }, 409);
    }
    return c.json({ message }, 400);
  }
});

// Detach product from bid
bidsRouter.delete('/:id/products/:productId', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const bidId = c.req.param('id');
  const productId = c.req.param('productId');
  const removed = await bidService.detachProduct(bidId, productId, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

export default bidsRouter;
