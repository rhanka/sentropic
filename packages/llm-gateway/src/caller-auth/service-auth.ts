import type { CreateRequireServiceAuthOptions, ServiceAuthPorts, ServiceAuthContext } from '@sentropic/mcp-auth/hono';
import type { CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CallerAuthScheme, VerifiedPrincipal, VerifyToken } from '../personal-passthrough/caller-auth.js';
import { authUnavailable, bridgeHeaders, runAuthBridge } from '../internal/auth-bridge.js';
import { validateAuthContext } from '../internal/caller-auth.js';

export type ServiceAuthCallerIdentity = {
  readonly kind: 'service'; readonly issuer: string; readonly resource: string;
  readonly clientId: string; readonly scopes: readonly string[]; readonly jkt: string | null;
};
export interface ServiceAuthVerifyTokenOptions {
  readonly auth: CreateRequireServiceAuthOptions & {
    readonly ports: ServiceAuthPorts & {
      readonly dpopReplay: NonNullable<ServiceAuthPorts['dpopReplay']>;
    };
  };
  readonly resolvePrincipal: (identity: ServiceAuthCallerIdentity) =>
    Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}

let modulePromise: Promise<typeof import('@sentropic/mcp-auth/hono')> | undefined;

export class ServiceAuthVerifyToken implements VerifyToken {
  private readonly options: ServiceAuthVerifyTokenOptions;
  constructor(options: ServiceAuthVerifyTokenOptions) {
    for (const value of [options.auth.issuer, options.auth.resource]) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Service issuer and resource must be absolute HTTP(S) URLs');
      }
    }
    if (!options.auth.requiredScopes?.length || options.auth.requiredScopes.some(scope => !scope.trim())
      || typeof options.auth.ports.dpopReplay?.recordDpopJti !== 'function') {
      throw new Error('Service authentication requires scopes and a shared DPoP replay store');
    }
    this.options = { ...options, auth: { ...options.auth,
      issuer: options.auth.issuer.replace(/\/+$/u, ''),
      requiredScopes: [...options.auth.requiredScopes], ports: { ...options.auth.ports },
    } };
  }

  async verify(token: string, scheme: CallerAuthScheme, headers: Readonly<Record<string, string>>,
    context: CallerAuthRequestContext): Promise<VerifiedPrincipal | undefined> {
    validateAuthContext(context);
    const normalized = bridgeHeaders(token, scheme, headers);
    if (!normalized) return undefined;
    try {
      const { createRequireServiceAuth } = await (modulePromise ??= import('@sentropic/mcp-auth/hono'));
      const auth = this.options.auth;
      const identity = await runAuthBridge(createRequireServiceAuth(auth), normalized, context, c => {
        const verified = c.get(auth.contextKey ?? 'serviceClient') as ServiceAuthContext;
        return { kind: 'service' as const, issuer: auth.issuer, resource: auth.resource,
          clientId: verified.clientId, scopes: [...verified.scopes], jkt: verified.jkt };
      });
      if (!identity || !identity.clientId || (scheme === 'DPoP' && !identity.jkt)) return undefined;
      const principal = await this.options.resolvePrincipal(identity);
      context.signal?.throwIfAborted();
      return principal;
    } catch {
      context.signal?.throwIfAborted();
      throw authUnavailable();
    }
  }
}
