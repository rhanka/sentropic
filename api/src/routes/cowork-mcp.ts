// Dedicated Cowork remote MCP endpoint (BR-41d, Lot 1), mounted directly at
// /api/v1/cowork-mcp. Disabled answers 404 everywhere (INV-03). Only
// mcp.verify + manual buildWwwAuthenticate 401: the mcp-auth defaults point
// at the canonical PRM URL, inservable behind nginx (BR41d-Q13).

import { Hono, type Context } from 'hono';

import {
  buildWwwAuthenticate,
  createMcpAuth,
  McpAuthError,
  type McpAuth,
  type McpAuthContext,
} from '@sentropic/mcp-auth';
import { fromJwksPort } from '@sentropic/oauth-verify';

import { createJwksAdapter } from './auth/jwks-adapter';
import {
  COWORK_CONTROL_SCOPE,
  resolveCoworkRemoteConfig,
  type CoworkRemoteConfig,
} from './cowork-remote/config';
import { admitCoworkRequest } from './cowork-remote/admission';
import { handleCoworkMcpRequest } from './cowork-remote/mcp-server';

export const COWORK_PRM_SUFFIX = '/.well-known/oauth-protected-resource';
const DEFAULT_ALLOWED_ORIGINS = ['https://claude.ai'];

let cachedAuth: { key: string; auth: McpAuth } | null = null;

/** Test hook: drop the per-(resource, AS) auth cache after env toggles. */
export const resetCoworkMcpAuthCache = (): void => {
  cachedAuth = null;
};

const getAuth = (config: CoworkRemoteConfig): McpAuth => {
  const key = `${config.resource}\n${config.authorizationServer}`;
  if (!cachedAuth || cachedAuth.key !== key) {
    cachedAuth = {
      auth: createMcpAuth({
        authorizationServers: [config.authorizationServer],
        keySource: fromJwksPort(createJwksAdapter()),
        resource: config.resource,
        scopesSupported: [COWORK_CONTROL_SCOPE],
      }),
      key,
    };
  }
  return cachedAuth.auth;
};

export const coworkPrmUrl = (config: CoworkRemoteConfig): string => `${config.resource}${COWORK_PRM_SUFFIX}`;

const challenge = (
  c: Context,
  config: CoworkRemoteConfig,
  status: 401 | 403,
  code: string,
  message: string,
  requiredScopes?: string[],
): Response => c.json(
  { error: { code, message } },
  status,
  {
    'WWW-Authenticate': buildWwwAuthenticate({
      error: code,
      errorDescription: message,
      resourceMetadata: coworkPrmUrl(config),
      scheme: 'Bearer',
      scope: requiredScopes ?? [COWORK_CONTROL_SCOPE],
    }),
  },
);

const isJsonRpcRequest = (body: unknown): boolean => {
  if (Array.isArray(body)) return true;
  const record = body as { jsonrpc?: unknown; method?: unknown } | null;
  return !!record && typeof record === 'object' && record.jsonrpc === '2.0' && typeof record.method === 'string';
};

const requestIdOf = (body: unknown): string | number | null => {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
};

export const coworkMcpRouter = new Hono();

coworkMcpRouter.get(COWORK_PRM_SUFFIX, (c) => {
  const config = resolveCoworkRemoteConfig();
  if (!config) return c.notFound();
  return c.json(getAuth(config).metadata(), 200, { 'Cache-Control': 'public, max-age=300' });
});

coworkMcpRouter.on(['GET', 'DELETE'], '/', (c) => {
  if (!resolveCoworkRemoteConfig()) return c.notFound();
  return c.text('Method Not Allowed', 405, { Allow: 'POST' });
});

coworkMcpRouter.post('/', async (c) => {
  const config = resolveCoworkRemoteConfig();
  if (!config) return c.notFound();
  if (new URL(c.req.url).host !== new URL(config.resource).host) {
    return c.json({ error: { code: 'forbidden_host', message: 'Unknown Host.' } }, 403);
  }
  const origin = c.req.header('origin');
  if (origin && origin !== DEFAULT_ALLOWED_ORIGINS[0] && !config.allowedOrigins.includes(origin)) {
    return c.json({ error: { code: 'forbidden_origin', message: 'Foreign Origin.' } }, 403);
  }
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > config.bodyLimitBytes) {
    return c.json({ error: { code: 'body_too_large', message: 'Request body exceeds the limit.' } }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: { code: -32700, message: 'Parse error' }, id: null, jsonrpc: '2.0' }, 400);
  }
  if (!isJsonRpcRequest(body)) {
    return c.json(
      { error: { code: -32600, message: 'Invalid Request' }, id: requestIdOf(body), jsonrpc: '2.0' },
      400,
    );
  }
  const auth = getAuth(config);
  let verified: McpAuthContext;
  try {
    verified = await auth.verify(c.req.raw, { requiredScopes: [COWORK_CONTROL_SCOPE] });
  } catch (error) {
    if (error instanceof McpAuthError) {
      return challenge(c, config, error.status, error.code, error.message, error.requiredScopes);
    }
    return c.json(
      { error: { code: 'admission_unavailable', message: 'Authorization store unavailable.' } },
      503,
    );
  }
  const admission = await admitCoworkRequest(config, verified);
  if (!admission.ok) {
    if (admission.status === 503) {
      return c.json({ error: { code: admission.code, message: admission.message } }, 503);
    }
    return challenge(c, config, admission.status, admission.code, admission.message, admission.challengeScopes);
  }
  return handleCoworkMcpRequest(c.req.raw, body, config, admission.admission);
});
