import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { McpAuth, McpAuthError } from '@sentropic/mcp-auth';
import type { McpOAuthNamespaceOptions, McpOAuthPrincipal } from './oauth-contracts.js';

/** Private, request-local authority. Never handed to a product tool. */
export interface OAuthRequestAuthority {
  readonly principal: McpOAuthPrincipal;
  readonly subjectToken: string;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export const oauthAuthority = new AsyncLocalStorage<OAuthRequestAuthority>();

// Node supports the native operation; TypeScript 5.4's DOM declaration predates it.
export const combineOAuthSignals = (signals: AbortSignal[]): AbortSignal =>
  (AbortSignal as typeof AbortSignal & { any(values: AbortSignal[]): AbortSignal }).any(signals);

export async function verifyOAuthRequest(
  auth: McpAuth,
  AuthError: typeof McpAuthError,
  options: McpOAuthNamespaceOptions,
  request: Request,
): Promise<OAuthRequestAuthority> {
  const verified = await auth.verify(request, { requiredScopes: [...options.requiredIngressScopes] });
  const claims = verified.claims;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const invalid = () => new AuthError(401, 'invalid_token', 'Invalid MCP resource identity.');
  if (audience.length !== 1 || audience[0] !== options.resource
    || !options.authorizationServers.includes(claims.iss)
    || typeof claims.sub !== 'string' || !claims.sub.trim()
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()
    || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) throw invalid();
  const client = claims.client_id;
  const azp = claims.azp;
  for (const value of [client, azp, claims.tid]) {
    if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) throw invalid();
  }
  if (client !== undefined && azp !== undefined && client !== azp) throw invalid();
  if (options.requiredAcr !== undefined) {
    const meets = claims.acr === options.requiredAcr
      || (options.requiredAcr === 'urn:sentropic:loa:bearer' && claims.acr === 'urn:sentropic:loa:passkey-fresh');
    if (!meets) throw new AuthError(401, 'invalid_token', 'insufficient_user_authentication');
  }
  const clientId = typeof client === 'string' ? client : typeof azp === 'string' ? azp : undefined;
  const principal: McpOAuthPrincipal = Object.freeze({
    sub: claims.sub, ...(clientId === undefined ? {} : { clientId }),
    scopes: Object.freeze([...verified.scopes]), tid: typeof claims.tid === 'string' ? claims.tid : null,
  });
  // The auth core already parsed the scheme/token. Keep the subject token inside the private boundary.
  const subjectToken = request.headers.get('authorization')!.split(/\s+/u, 2)[1]!;
  return Object.freeze({ principal, subjectToken, correlationId: randomUUID(), signal: request.signal });
}

/** Fail before listening, including malformed JavaScript callers bypassing the public types. */
export function validateOAuthOptions(options: McpOAuthNamespaceOptions): void {
  if (typeof options.resolveAccount !== 'function' || typeof options.invoke !== 'function'
    || typeof options.sessions?.createTransport !== 'function') {
    throw new TypeError('MCP OAuth requires account, invocation and transport bindings');
  }
  if (typeof options.environment !== 'string' || !options.environment.trim()
    || !Array.isArray(options.authorizationServers) || options.authorizationServers.length !== 1) {
    throw new TypeError('MCP OAuth requires one issuer and an exact environment');
  }
  for (const uri of [options.resource, ...options.authorizationServers]) {
    const url = new URL(uri);
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash
      || (url.href !== uri && !(url.pathname === '/' && url.href.slice(0, -1) === uri))
      || (uri === options.resource && (url.pathname === '/' || url.pathname.endsWith('/')))) {
      throw new TypeError('MCP OAuth requires canonical trusted resource and issuer URLs');
    }
  }
  for (const scopes of [options.scopesSupported, options.requiredIngressScopes]) {
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string' || !scope || /\s/u.test(scope))) {
      throw new TypeError('MCP OAuth scopes must be exact non-empty scope names');
    }
  }
  if (options.requiredIngressScopes.some((scope) => !options.scopesSupported.includes(scope))) {
    throw new TypeError('Ingress scopes must be advertised');
  }
  if (options.requiredAcr !== undefined && (typeof options.requiredAcr !== 'string' || !options.requiredAcr.trim())) {
    throw new TypeError('requiredAcr must be a non-empty assurance identifier');
  }
  const seen = new Set<string>();
  for (const tool of options.tools) {
    if (seen.has(tool.name) || options.registry.resolveTool(tool.name) === undefined) {
      throw new TypeError('MCP OAuth tools must be unique and resolve in the compiled registry');
    }
    seen.add(tool.name);
  }
}
