/**
 * View Template CRUD API routes.
 *
 * Endpoints:
 *  GET    /view-templates                — list view templates for current workspace
 *  GET    /view-templates/:id            — get single view template
 *  GET    /view-templates/resolve        — resolve view template by (workspace_type, object_type, maturity_stage?)
 *  POST   /view-templates                — create view template (admin)
 *  PUT    /view-templates/:id            — update view template descriptor (user-level only)
 *  POST   /view-templates/:id/copy       — copy a template into current workspace
 *  POST   /view-templates/:id/fork       — deprecated alias for /copy
 *  POST   /view-templates/:id/reset      — reset copied template (delete copy, return system default)
 *  DELETE /view-templates/:id            — delete user-created template (sourceLevel='user' + parentId=null)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { viewTemplateService } from '../../services/view-template-service';
import { requireWorkspaceAccessRole } from '../../middleware/workspace-rbac';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceAdminRole } from '../../middleware/workspace-rbac';

export const viewTemplatesRouter = new Hono();

/**
 * GET /view-templates/resolve?workspaceId=&workspaceType=&objectType=&maturityStage=
 * Resolve the best-matching view template for a resolution key.
 */
viewTemplatesRouter.get('/resolve', requireWorkspaceAccessRole(), async (c) => {
  const workspaceId = c.req.query('workspaceId');
  const workspaceType = c.req.query('workspaceType');
  const objectType = c.req.query('objectType');
  const maturityStage = c.req.query('maturityStage') || null;

  if (!workspaceId || !workspaceType || !objectType) {
    return c.json({ error: 'Missing required query parameters: workspaceId, workspaceType, objectType' }, 400);
  }

  const template = await viewTemplateService.resolve(workspaceId, workspaceType, objectType, maturityStage);
  if (!template) {
    return c.json({ error: 'View template not found' }, 404);
  }

  return c.json(template);
});

/**
 * GET /view-templates?workspaceId=&workspaceType=
 * List view templates for a workspace.
 */
viewTemplatesRouter.get('/', requireWorkspaceAccessRole(), async (c) => {
  const workspaceId = c.req.query('workspaceId');
  const workspaceType = c.req.query('workspaceType') || undefined;

  if (!workspaceId) {
    return c.json({ error: 'Missing required query parameter: workspaceId' }, 400);
  }

  const templates = await viewTemplateService.list(workspaceId, workspaceType);
  return c.json({ items: templates });
});

/**
 * GET /view-templates/:id
 * Get a single view template by ID.
 */
viewTemplatesRouter.get('/:id', requireWorkspaceAccessRole(), async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'Missing required parameter: id' }, 400);
  }
  const template = await viewTemplateService.getById(id);
  if (!template) {
    return c.json({ error: 'View template not found' }, 404);
  }
  return c.json(template);
});

// Create view template (workspace admin)
const createSchema = z.object({
  workspaceType: z.string().min(1),
  objectType: z.string().min(1),
  maturityStage: z.string().nullish(),
  descriptor: z.record(z.unknown()),
  sourceLevel: z.enum(['code', 'admin', 'user']).optional(),
});

viewTemplatesRouter.post('/', requireEditor, requireWorkspaceAdminRole(), zValidator('json', createSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');

  const row = await viewTemplateService.create({
    workspaceId,
    workspaceType: payload.workspaceType,
    objectType: payload.objectType,
    maturityStage: payload.maturityStage ?? null,
    descriptor: payload.descriptor,
    sourceLevel: payload.sourceLevel,
  });

  return c.json(row, 201);
});

// Update view template descriptor (user-level only)
const updateSchema = z.object({
  descriptor: z.record(z.unknown()).optional(),
  sourceLevel: z.enum(['code', 'admin', 'user']).optional(),
});

viewTemplatesRouter.put('/:id', requireEditor, requireWorkspaceAdminRole(), zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  const row = await viewTemplateService.update(id, payload);
  if (!row) return c.json({ message: 'Not found' }, 404);
  return c.json(row);
});

// Copy a template into current workspace
viewTemplatesRouter.post('/:id/copy', requireEditor, requireWorkspaceAdminRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const sourceId = c.req.param('id')!;

  try {
    const row = await viewTemplateService.copy(sourceId, workspaceId);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('already exists')) return c.json({ error: message }, 409);
    return c.json({ error: message }, 404);
  }
});

// Fork (deprecated alias for copy)
viewTemplatesRouter.post('/:id/fork', requireEditor, requireWorkspaceAdminRole(), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const sourceId = c.req.param('id')!;

  try {
    const row = await viewTemplateService.copy(sourceId, workspaceId);
    return c.json(row, 201);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('already exists')) return c.json({ error: message }, 409);
    return c.json({ error: message }, 404);
  }
});

// Reset copied template — delete copy and return system default
viewTemplatesRouter.post('/:id/reset', requireEditor, requireWorkspaceAdminRole(), async (c) => {
  const id = c.req.param('id')!;

  try {
    const parent = await viewTemplateService.reset(id);
    if (!parent) return c.json({ message: 'Not found' }, 404);
    return c.json(parent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 400);
  }
});

// Detach (deprecated — returns 410 Gone)
viewTemplatesRouter.post('/:id/detach', requireEditor, requireWorkspaceAdminRole(), async (c) => {
  return c.json({ error: 'Detach is no longer supported. Use reset instead.' }, 410);
});

// Delete workspace-specific template (user-created only, no parentId)
viewTemplatesRouter.delete('/:id', requireEditor, requireWorkspaceAdminRole(), async (c) => {
  const id = c.req.param('id')!;

  const result = await viewTemplateService.remove(id);
  if (result.forbidden) return c.json({ message: 'Cannot delete: only user-created templates with no parent can be deleted' }, 403);
  if (!result.deleted) return c.json({ message: 'Not found' }, 404);
  return c.body(null, 204);
});

export default viewTemplatesRouter;
