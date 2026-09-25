import type { CreateAuthMiddlewareOptions, AuthHonoAuthContext } from '@sentropic/auth-hono/middleware';
import type { CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CallerAuthScheme, VerifiedPrincipal, VerifyToken } from '../personal-passthrough/caller-auth.js';
import { authUnavailable, bridgeHeaders, runAuthBridge } from '../internal/auth-bridge.js';
import { validateAuthContext } from '../internal/caller-auth.js';

export type AuthHonoCallerIdentity = {
  readonly kind: 'session'; readonly userId: string; readonly sessionId: string;
};
export interface AuthHonoVerifyTokenOptions {
  readonly auth: CreateAuthMiddlewareOptions;
  readonly resolvePrincipal: (identity: AuthHonoCallerIdentity) =>
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}
let modulePromise: Promise<typeof import('@sentropic/auth-hono/middleware')> | undefined;

export class AuthHonoVerifyToken implements VerifyToken {
  constructor(private readonly options: AuthHonoVerifyTokenOptions) {}

  async verify(token: string, scheme: CallerAuthScheme, headers: Readonly<Record<string, string>>,
    context: CallerAuthRequestContext): Promise<VerifiedPrincipal | undefined> {
    validateAuthContext(context);
    if (scheme === 'DPoP') return undefined;
    const normalized = bridgeHeaders(token, scheme, headers);
    if (!normalized) return undefined;
    try {
      const { createRequireAuth } = await (modulePromise ??= import('@sentropic/auth-hono/middleware'));
      const identity = await runAuthBridge(createRequireAuth(this.options.auth), normalized, context, c => {
        const verified = c.get('auth') as AuthHonoAuthContext;
        return { kind: 'session' as const, userId: verified.user.id, sessionId: verified.session.sessionId };
      });
      if (!identity) return undefined;
      const principal = await this.options.resolvePrincipal(identity);
      context.signal?.throwIfAborted();
      return principal;
    } catch {
      context.signal?.throwIfAborted();
      throw authUnavailable();
    }
  }
}
