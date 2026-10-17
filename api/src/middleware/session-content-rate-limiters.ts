import type { Context, Next } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import { resolveClientIp } from '../utils/client-ip';

declare module 'hono' {
  interface ContextVariableMap {
    sessionContentIdentity: { ownerId: string; sessionId: string };
  }
}
export const isSessionContentPath = (path: string): boolean =>
  !/%(?:2f|5c|25)/i.test(path) && !path.includes('\\')
  && (path === '/api/v1/auth/session/content' || path.startsWith('/api/v1/auth/session/content/'));

/** Denial/metadata budgets only. Positive ingress remains blocked by CM2-F2;
 * its source/tenant byte and request admission cannot be qualified here. */
export function createSessionContentRateLimiters() {
  const failed = rateLimiter({ windowMs: 60000, limit: 32, standardHeaders: 'draft-7',
    keyGenerator: (c) => resolveClientIp(c as never),
    handler: (c) => c.json({ error: 'd2_authentication_throttled' }, 429) });
  const keyGenerator = (c: Context) => {
    const identity = c.get('sessionContentIdentity');
    return `${identity.ownerId}:${identity.sessionId}`;
  };
  const control = rateLimiter({ windowMs: 60000, limit: 128, standardHeaders: 'draft-7', keyGenerator,
    handler: (c) => c.json({ error: 'd2_control_throttled' }, 429) });
  const actions = rateLimiter({ windowMs: 60000, limit: 32, standardHeaders: 'draft-7', keyGenerator,
    handler: (c) => c.json({ error: 'd2_action_throttled', dispatch: 'not_attempted' }, 429) });
  return {
    async reject(c: Context, error: string) {
      const result = await failed(c, async () => { c.res = c.json({ error }, 401); });
      return result ?? c.res;
    },
    authenticated(c: Context, next: Next) {
      return (['GET', 'DELETE'].includes(c.req.method) || c.req.path.endsWith('/exclusion') ? control : actions)(c, next);
    },
  };
}
