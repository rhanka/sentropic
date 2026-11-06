import { createOptionalAuth, createRequireAuth, type AuthHonoAuthContext,
  type AuthHonoMiddlewareEnv } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { withAppCmAuth } from './cm-auth-runtime';
import { assertCmHostHealthy } from './cm-host-scope';
import { pool } from '../../db/client';
import { logger } from '../../logger';

export type CmHttpPrincipal = Omit<AuthHonoAuthContext, 'token'>;
type PrincipalResult =
  | { readonly accepted: true; readonly principal: CmHttpPrincipal | null }
  | { readonly accepted: false; readonly status: number; readonly body: string };

/** Only the authentication stage is replayable; application next runs after commit. */
export const authenticateCmHttpRequest = (request: Request, required: boolean): Promise<PrincipalResult> =>
  withAppCmAuth(runner => runner.authenticate(async (binding, tx): Promise<PrincipalResult> => {
    let principal: CmHttpPrincipal | null = null;
    let accepted = false;
    // Session liveness is best-effort outside the serializable authentication
    // transaction. Every page load fans out parallel same-session GETs, and a
    // conflicting activity touch must never fail the auth decision it follows,
    // so the middleware's touch is served here on a separate READ COMMITTED
    // connection: it waits on the row lock instead of aborting with 40001,
    // and a lost touch only stales last-activity display (logged, never
    // thrown). The serializable attempt itself stays read-only and therefore
    // write-free: no subject locks, no custody writes, no self-conflict.
    const touch: typeof binding.ports.sessions.touch = async (id, at) => {
      try {
        await pool.query(
          'UPDATE "cm_identity"."identity_login_token_bindings" SET "last_activity_at" = $2 WHERE "session_id" = $1',
          [id, at.toISOString()],
        );
      } catch (error) {
        logger.warn({ err: error, sessionId: id }, 'CM session activity touch unavailable');
      }
    };
    const router = new Hono<AuthHonoMiddlewareEnv>();
    router.onError(error => { throw error; });
    router.use('*', (required ? createRequireAuth : createOptionalAuth)(
      { ports: { ...binding.ports, sessions: { ...binding.ports.sessions, touch } } }));
    router.get('/authentication', c => {
      const auth = c.get('auth');
      // Copy only value records; no request token or bound port leaves this attempt.
      if (auth) principal = structuredClone({ role: auth.role, session: auth.session,
        sessionRecord: auth.sessionRecord, user: auth.user });
      accepted = true;
      return c.body(null, 204);
    });
    const response = await router.fetch(new Request('http://cm.local/authentication', {
      method: 'GET', headers: new Headers(request.headers),
    }));
    const body = await response.text();
    assertCmHostHealthy(tx.hostTransaction);
    if (response.status >= 500) throw new Error('identity_authentication_failed');
    return accepted ? { accepted: true, principal } : { accepted: false, status: response.status, body };
  }));

export const publishCmAuthenticationRefusal = (result: Extract<PrincipalResult, { accepted: false }>): Response =>
  new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json' } });
