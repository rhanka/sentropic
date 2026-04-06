import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { proposalService } from '../../services/context-proposal';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';

const createProposalSchema = z.object({
  initiativeId: z.string().min(1),
  status: z.enum(['draft', 'review', 'finalized', 'contract']).optional(),
  data: z.record(z.unknown()).optional(),
});

const updateProposalSchema = z.object({
  status: z.enum(['draft', 'review', 'finalized', 'contract']).optional(),
  data: z.record(z.unknown()).optional(),
});

const attachProductSchema = z.object({
  productId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

export const proposalsRouter = new Hono();

// List proposals (optionally filtered by initiative_id)
proposalsRouter.get('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const initiativeId = c.req.query('initiative_id');
  const items = await proposalService.list(workspaceId, initiativeId || undefined);
  return c.json({ items });
});

// Get single proposal
proposalsRouter.get('/:id', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const row = await proposalService.getById(id, workspaceId);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Create proposal
proposalsRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', createProposalSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  try {
    const row = await proposalService.create(workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Update proposal
proposalsRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', updateProposalSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const row = await proposalService.update(id, workspaceId, payload);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Delete proposal (cascades to proposal_products)
proposalsRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id')!;
  const removed = await proposalService.remove(id, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

// --- proposal_products junction ---

// List products attached to a proposal
proposalsRouter.get('/:id/products', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const proposalId = c.req.param('id');
  try {
    const items = await proposalService.listProducts(proposalId, workspaceId);
    return c.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    return c.json({ message }, 400);
  }
});

// Attach product to proposal
proposalsRouter.post('/:id/products', requireEditor, requireWorkspaceEditorRole(), zValidator('json', attachProductSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const proposalId = c.req.param('id');
  const payload = c.req.valid('json');
  try {
    const row = await proposalService.attachProduct(proposalId, workspaceId, payload);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('not found')) return c.json({ message }, 404);
    if (message.includes('unique') || message.includes('duplicate')) {
      return c.json({ message: 'Product already attached to proposal' }, 409);
    }
    return c.json({ message }, 400);
  }
});

// Detach product from proposal
proposalsRouter.delete('/:id/products/:productId', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const proposalId = c.req.param('id')!;
  const productId = c.req.param('productId')!;
  const removed = await proposalService.detachProduct(proposalId, productId, workspaceId);
  if (!removed) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

export default proposalsRouter;
