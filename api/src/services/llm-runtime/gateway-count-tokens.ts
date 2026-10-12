/**
 * Host-owned NativeCountTokensPort (gateway count_tokens, spec §15.2 round 2).
 * Real provider counting: the port resolves the trusted server credential
 * (user provider credential, or the owner's claude-code account transport) and
 * asks the Anthropic Messages count_tokens endpoint. The gateway relays the
 * caller body and returns the provider count verbatim — never an estimate.
 * Caller fields never select a credential, account or URL.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  anthropicError,
  NativeCountUpstreamError,
  type NativeCountTokensPort,
  type NativeCountTokensRequest,
  type NativeCountTokensResult,
  type PreparedNativeCountTokens,
} from '@sentropic/llm-gateway';
import type { VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import { providerRegistry } from '../provider-registry';
import { resolveProviderCredential } from '../provider-credentials';
import {
  getAnthropicTransportMode,
  resolveConnectedClaudeCodeTransport,
} from '../provider-connections';
import { getPrimaryClaudeCodeAccountTransport } from '../llm-account-transports';

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const MAX_PUBLIC_MESSAGE_BYTES = 4096;

/** Byte-capped, control-free public message (mirrors the native relay cap). */
const publicMessage = (text: string): string => {
  const stripped = text.replace(CONTROL_CHARS, '').trim();
  if (!stripped) return 'counting failed';
  const encoder = new TextEncoder();
  if (encoder.encode(stripped).length <= MAX_PUBLIC_MESSAGE_BYTES) return stripped;
  let byteCount = 0;
  let result = '';
  for (const char of stripped) {
    const charBytes = encoder.encode(char).length;
    if (byteCount + charBytes > MAX_PUBLIC_MESSAGE_BYTES) break;
    byteCount += charBytes;
    result += char;
  }
  return result || 'counting failed';
};

/** Same OAuth-header swap as the claude provider: transport token replaces x-api-key. */
const claudeCodeFetch = (transport: { accessToken: string }): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    headers.delete('x-api-key');
    headers.delete('X-Api-Key');
    headers.set('authorization', `Bearer ${transport.accessToken}`);
    return fetch(input, { ...init, headers });
  };

export type CountClient = {
  countTokens(
    body: Anthropic.MessageCountTokensParams,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<unknown>;
};

export type GatewayCountAuth =
  | { readonly kind: 'token'; readonly credential: string }
  | { readonly kind: 'account' };

export const gatewayCountDependencies = {
  resolveCredential: resolveProviderCredential,
  transportMode: getAnthropicTransportMode,
  primaryAccount: getPrimaryClaudeCodeAccountTransport,
  acquire: resolveConnectedClaudeCodeTransport,
  createClient: (input: { credential?: string; transport?: { accessToken: string } }): CountClient => {
    const client = input.transport?.accessToken
      ? new Anthropic({ apiKey: 'claude_code_dummy_key', fetch: claudeCodeFetch(input.transport) })
      : new Anthropic({ apiKey: input.credential });
    return client.messages;
  },
};
export type GatewayCountDependencies = typeof gatewayCountDependencies;

const anthropicCatalogModelIds = (): readonly string[] =>
  providerRegistry.listModels()
    .filter((entry) => entry.providerId === 'anthropic')
    .map((entry) => entry.modelId);

const retryAfter = (headers: unknown): Record<string, string> | undefined => {
  const value = headers instanceof Headers ? headers.get('retry-after') : undefined;
  return value ? { 'Retry-After': value } : undefined;
};

/** Provider-shaped upstream failure; no credential, account or host detail rides out. */
const toUpstreamError = (error: unknown): NativeCountUpstreamError => {
  const status = typeof (error as { status?: unknown } | null)?.status === 'number'
    ? (error as { status: number }).status : undefined;
  const detail = (error as { error?: { type?: unknown; message?: unknown } } | null)?.error;
  const type = typeof detail?.type === 'string' && detail.type ? detail.type : undefined;
  const message = typeof detail?.message === 'string' ? detail.message : '';
  const headers = retryAfter((error as { headers?: unknown } | null)?.headers);
  if (status === 401 || status === 403) {
    return new NativeCountUpstreamError(anthropicError(401, 'authentication_error', 'authentication failed'));
  }
  if (status === 429) {
    return new NativeCountUpstreamError(anthropicError(429, 'rate_limit_error',
      publicMessage(message), headers ?? { 'Retry-After': '1' }));
  }
  if (status && status >= 400 && status < 500 && type) {
    return new NativeCountUpstreamError(anthropicError(status, type, publicMessage(message)));
  }
  return new NativeCountUpstreamError(anthropicError(503, 'api_error',
    'counting service temporarily unavailable'));
};

const leaseOutcome = (error: unknown):
  { status: 'success' } | { status: 'failed' | 'rate_limited' | 'auth_failed'; providerStatusCode?: number } => {
  if (!error) return { status: 'success' };
  const status = typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status : undefined;
  if (status === 429) return { status: 'rate_limited', ...(status ? { providerStatusCode: status } : {}) };
  if (status === 401 || status === 403) return { status: 'auth_failed', ...(status ? { providerStatusCode: status } : {}) };
  return { status: 'failed', ...(status ? { providerStatusCode: status } : {}) };
};

const executeCount = async (deps: GatewayCountDependencies, auth: GatewayCountAuth, subject: VerifiedRoutingSubject,
  workspaceId: string | undefined, request: NativeCountTokensRequest): Promise<NativeCountTokensResult> => {
  if (auth.kind === 'token') {
    const client = deps.createClient({ credential: auth.credential });
    try {
      const body = await client.countTokens(
        request.body as Anthropic.MessageCountTokensParams, { signal: request.signal });
      return { kind: 'json', status: 200, headers: {}, body: body as Record<string, unknown> };
    } catch (error) {
      throw toUpstreamError(error);
    }
  }
  const lease = await deps.acquire(subject.principalRef, {
    workspaceId, modelId: request.body.model as string, requestId: request.requestId,
  });
  if (!lease) {
    throw new NativeCountUpstreamError(anthropicError(503, 'overloaded_error',
      'account service temporarily unavailable'));
  }
  let failure: unknown;
  try {
    const client = deps.createClient({ transport: { accessToken: lease.accessToken } });
    const body = await client.countTokens(
      request.body as Anthropic.MessageCountTokensParams, { signal: request.signal });
    return { kind: 'json', status: 200, headers: {}, body: body as Record<string, unknown> };
  } catch (error) {
    failure = error;
    throw toUpstreamError(error);
  } finally {
    await lease.recordOutcome(leaseOutcome(failure)).catch(() => undefined);
  }
};

/** Build the host port: exact anthropic catalog allowlist, never an alias catalog. */
export const createGatewayCountTokensPort = (
  dependencies: Partial<GatewayCountDependencies> = {},
): NativeCountTokensPort => {
  const deps: GatewayCountDependencies = { ...gatewayCountDependencies, ...dependencies };
  const modelIds = anthropicCatalogModelIds();
  const capability = (
    modelId: string, auth: GatewayCountAuth,
    subject: VerifiedRoutingSubject, workspaceId: string | undefined,
  ): PreparedNativeCountTokens => ({
    providerId: 'anthropic',
    modelId,
    apiVersions: ['2023-06-01'],
    async execute(request) {
      return executeCount(deps, auth, subject, workspaceId, request);
    },
  });
  return {
    modelIds,
    async prepare(subject, input) {
      if (!modelIds.includes(input.modelId)) return undefined;
      const resolved = await deps.resolveCredential({
        providerId: 'anthropic',
        userId: subject.principalRef,
        workspaceId: input.workspaceId ?? null,
      });
      if (resolved.credential?.trim()) {
        return capability(input.modelId, { kind: 'token', credential: resolved.credential },
          subject, input.workspaceId);
      }
      if (await deps.transportMode() !== 'claude-code') return undefined;
      const account = await deps.primaryAccount({ ownerUserId: subject.principalRef });
      if (!account || (account.status !== 'active' && account.status !== 'cooldown')) return undefined;
      return capability(input.modelId, { kind: 'account' }, subject, input.workspaceId);
    },
  };
};
