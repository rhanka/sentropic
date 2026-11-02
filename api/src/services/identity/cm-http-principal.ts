import { createOptionalAuth, createRequireAuth, type AuthHonoAuthContext,
  type AuthHonoMiddlewareEnv } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { withAppCmAuth } from './cm-auth-runtime';
import { assertCmHostHealthy } from './cm-host-scope';

export type CmHttpPrincipal = Omit<AuthHonoAuthContext, 'token'>;
type PrincipalResult =
  | { readonly accepted: true; readonly principal: CmHttpPrincipal | null }
  | { readonly accepted: false; readonly status: number; readonly body: string };

/** Only the authentication stage is replayable; application next runs after commit. */
export const authenticateCmHttpRequest = (request: Request, required: boolean): Promise<PrincipalResult> =>
  withAppCmAuth(runner => runner.request(async (binding, tx): Promise<PrincipalResult> => {
    let principal: CmHttpPrincipal | null = null;
    let accepted = false;
    const router = new Hono<AuthHonoMiddlewareEnv>();
    router.onError(error => { throw error; });
    router.use('*', (required ? createRequireAuth : createOptionalAuth)({ ports: binding.ports }));
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
