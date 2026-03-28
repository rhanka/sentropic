import { Hono } from 'hono';
import { viewTemplateService } from '../../services/view-template-service';
import { requireWorkspaceAccessRole } from '../../middleware/workspace-rbac';

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
