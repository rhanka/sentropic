import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { DecisionClient, DecisionRequest } from '@sentropic/llm-mesh/decision';
import type { AuthUser } from '../../middleware/auth';
import type { DecisionExecutionProfile } from '../../services/decision-host';

export const unavailableDecisionRouter = () => new Hono().all('/decision', (c) => c.json({ error: 'unavailable' }, 503));

export const createDecisionRouter = (options: {
  profile: DecisionExecutionProfile;
  forCaller(user: AuthUser): Promise<{ client: DecisionClient; readiness(): Promise<unknown> } | undefined>;
}): Hono => {
  const router = new Hono();
  router.use('/decision', async (c, next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user?.userId || !user.workspaceId) return c.json({ error: 'Authentication required' }, 401);
    if (options.profile === 'qualification' && user.role !== 'admin_app') {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  });
  router.use('/decision', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }));
  router.get('/decision', async (c) => {
    try {
      const runtime = await options.forCaller(c.get('user') as AuthUser);
      return runtime ? c.json(await runtime.readiness()) : c.json({ error: 'Insufficient permissions' }, 403);
    } catch { return c.json({ error: 'unavailable' }, 503); }
  });
  router.post('/decision', async (c) => {
    let candidate: unknown;
    try { candidate = await c.req.json(); }
    catch { return c.json({ error: 'Invalid decision request' }, 400); }
    try {
      const runtime = await options.forCaller(c.get('user') as AuthUser);
      if (!runtime) return c.json({ error: 'Insufficient permissions' }, 403);
      const result = await runtime.client.decide(candidate as DecisionRequest, { signal: c.req.raw.signal });
      const status = result.ok ? 200 : result.error.code === 'REQUEST_INVALID' ? 400
        : result.error.code === 'AUTHORIZATION_DENIED' ? 403 : result.error.code === 'BUDGET_EXHAUSTED' ? 429 : 503;
      return c.json(result, status);
    } catch { return c.json({ error: 'unavailable' }, 503); }
  });
  return router;
};
