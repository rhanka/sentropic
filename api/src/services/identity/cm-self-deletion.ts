import type { Context, Next } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { withAppCmAuth } from './cm-auth-runtime';
import { authHonoCookiePort } from '../auth/session-adapter';
import { resolveCmSelfDeletion, type CmSelfDeletionContinuation } from './cm-self-deletion-proof';

declare module 'hono' {
  interface ContextVariableMap { cmSelfDeletion: CmSelfDeletionContinuation | undefined }
}
export const readCmAccountCredential = (request: Request): string | null =>
  /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim()
    || authHonoCookiePort.readSessionToken(request);

/** This middleware is installed only on the account DELETE projection. */
export async function requireCmAccountAuth(c: Context, next: Next) {
  if (c.req.method !== 'DELETE') return requireAuth(c, next);
  let principal: CmSelfDeletionContinuation | null;
  try {
    principal = await withAppCmAuth(runner => runner.authenticate(async (binding, tx) => {
      const token = readCmAccountCredential(c.req.raw);
      if (!token) return null;
      const claims = await binding.ports.tokens.verifySessionToken(token);
      if (!claims) return null;
      return resolveCmSelfDeletion(tx, { userId: claims.userId, sessionId: claims.sessionId,
        credentialHash: await binding.ports.tokens.hashSecret(token) });
    }));
  } catch {
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  if (!principal) return requireAuth(c, next);
  c.set('user', { userId: principal.userId, sessionId: principal.sessionId, role: 'guest', workspaceId: '' });
  c.set('cmSelfDeletion', principal);
  return next();
}
