import { createAuthCredentialRouteHandlers, type AuthHonoAuthUiMethod, type AuthHonoRouteHandlers } from '@sentropic/auth-hono';
import type { IdentityAuthCompletionFlowV1 } from '@sentropic/cluster-mesh';
import { Hono, type Context } from 'hono';
import { runCmAuthHttp } from './cm-http';

const handle = (c: Context, method: AuthHonoAuthUiMethod, flow: IdentityAuthCompletionFlowV1 | null) =>
  runCmAuthHttp(c, flow, binding => {
    const handlers = createAuthCredentialRouteHandlers({
      credentials: binding.ports.credentials,
      async resolveSession(context) {
        const token = binding.ports.cookies.readSessionToken(context.req.raw)
          ?? context.req.header('authorization')?.replace(/^Bearer /, '');
        if (!token) return null;
        const session = await binding.sessions.validateSessionToken(token);
        return session ? { userId: session.user.id } : null;
      },
    });
    const router = new Hono();
    // Preserve the id parameter on the fresh context used by the private attempt.
    router.all(c.req.routePath, handlers[method]!);
    return router;
  });

export const cmCredentialHandlers: AuthHonoRouteHandlers = {
  listCredentials: c => handle(c, 'listCredentials', null),
  renameCredential: c => handle(c, 'renameCredential', 'credential_rename'),
  revokeCredential: c => handle(c, 'revokeCredential', 'credential_revoke'),
};
