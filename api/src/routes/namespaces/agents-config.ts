import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { TodoOrchestrationError, type TodoActor } from '../../services/todo-orchestration';
import type { AgentsFlowPort } from './agents-ports';

const metadataSchema = z.record(z.string(), z.unknown());
const putAgentConfigsSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(),
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    config: metadataSchema.optional(),
    sourceLevel: z.enum(['code', 'admin', 'user']).optional(),
  })).min(1),
});
const copyAgentSchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

const actorFromContext = (context: Context): TodoActor => {
  const user = context.get('user') as { userId: string; role: string; workspaceId: string };
  return { userId: user.userId, role: user.role, workspaceId: user.workspaceId };
};

const toHttpStatus = (status: number): 400 | 401 | 403 | 404 | 409 | 500 => {
  if ([400, 401, 403, 404, 409].includes(status)) {
    return status as 400 | 401 | 403 | 404 | 409;
  }
  return 500;
};

const handleFlowError = (context: Context, error: unknown) => {
  if (error instanceof TodoOrchestrationError) {
    return context.json({ error: error.message }, toHttpStatus(error.status));
  }
  console.error('agent-config route error', error);
  return context.json({ error: 'Internal server error' }, 500);
};

export const createAgentConfigRouter = (flow: AgentsFlowPort): Hono => {
  const router = new Hono();

  router.get('/', requireWorkspaceAccessRole(), async (context) => {
    try {
      return context.json({ items: await flow.list(actorFromContext(context)) });
    } catch (error) {
      return handleFlowError(context, error);
    }
  });

  router.put('/', requireWorkspaceEditorRole(), zValidator('json', putAgentConfigsSchema), async (context) => {
    try {
      const body = context.req.valid('json');
      return context.json({ items: await flow.upsertMany(actorFromContext(context), body.items) });
    } catch (error) {
      return handleFlowError(context, error);
    }
  });

  const copy = async (context: Context) => {
    try {
      const body = context.req.valid('json' as never) as { key?: string; name?: string };
      const item = await flow.fork(actorFromContext(context), context.req.param('id')!, body);
      return context.json({ item }, 201);
    } catch (error) {
      return handleFlowError(context, error);
    }
  };
  router.post('/:id/copy', requireWorkspaceEditorRole(), zValidator('json', copyAgentSchema), copy);
  router.post('/:id/fork', requireWorkspaceEditorRole(), zValidator('json', copyAgentSchema), copy);

  router.post('/:id/reset', requireWorkspaceEditorRole(), async (context) => {
    try {
      return context.json({
        item: await flow.reset(actorFromContext(context), context.req.param('id')!),
      });
    } catch (error) {
      return handleFlowError(context, error);
    }
  });

  router.delete('/:id', requireWorkspaceEditorRole(), async (context) => {
    try {
      await flow.delete(actorFromContext(context), context.req.param('id')!);
      return context.body(null, 204);
    } catch (error) {
      return handleFlowError(context, error);
    }
  });

  router.post('/:id/detach', requireWorkspaceEditorRole(), (context) => context.json({
    error: 'Detach is no longer supported. Use reset instead.',
  }, 410));

  return router;
};
