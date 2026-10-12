import type { VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import type { CostContext } from './ports/cost-context.js';
import { routingSubjectForCost } from './route-flow-core.js';
import { buildNativeRequestHeaders } from './native-headers.js';
import { GatewayError, anthropicError, type ProviderShapedError } from './router/errors.js';
import { defaultNativeCountTokensRateLimiter, type NativeCountTokensRateLimiter } from './native-count-rate.js';

export const SAFEGUARDS_NOT_SUPPORTED_MESSAGE =
  'safeguards is not supported by this gateway route; retry without safeguards.';
export const COUNT_NOT_SUPPORTED_MESSAGE = 'Token counting is not supported by this gateway route.';
export const COUNT_NOT_SUPPORTED_FOR_REQUEST_MESSAGE =
  'Token counting is not supported by this gateway route for this request.';

export interface NativeCountTokensRequest {
  readonly body: Record<string, unknown>;
  readonly headers: {
    readonly forwarded: Readonly<Record<string, string>>;
    readonly anthropicVersion: string;
  };
  readonly signal: AbortSignal;
  readonly requestId: string;
}
export interface NativeCountTokensResult {
  readonly kind: 'json';
  readonly status: 200;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}
export interface PreparedNativeCountTokens {
  readonly providerId: string;
  readonly modelId: string;
  readonly apiVersions: readonly string[];
  /** One JSON count call; cancel/detach all request holders before return. */
  execute(request: NativeCountTokensRequest): Promise<NativeCountTokensResult>;
}
export interface NativeCountTokensPort {
  /** Same trusted exact-model allowlist discipline as native Messages; never an alias catalog. */
  readonly modelIds: readonly string[];
  /** Recheck caller partition, catalog and credential availability; unknown catalog model throws unknown-model. */
  prepare(subject: VerifiedRoutingSubject, input: {
    readonly workspaceId?: string; readonly modelId: string; readonly signal: AbortSignal;
  }): Promise<PreparedNativeCountTokens | undefined>;
}
export class NativeCountTokensRefusal extends Error {
  constructor(readonly response: ProviderShapedError) { super('Token counting refused'); }
}
/**
 * Provider-shaped upstream count failure. The host transport builds the
 * response (status/body/headers) from the provider error, sanitized; the
 * gateway relays it verbatim on the Anthropic wire.
 */
export class NativeCountUpstreamError extends Error {
  constructor(readonly response: ProviderShapedError) { super('Native count upstream failure'); }
}

const refuseCount = (safeguards: boolean, forRequest: boolean): never => {
  throw new NativeCountTokensRefusal(safeguards
    ? anthropicError(400, 'invalid_request_error', SAFEGUARDS_NOT_SUPPORTED_MESSAGE)
    : anthropicError(400, 'invalid_request_error', forRequest
      ? COUNT_NOT_SUPPORTED_FOR_REQUEST_MESSAGE : COUNT_NOT_SUPPORTED_MESSAGE));
};

/**
 * Authenticated count only: no canonical projection, generation plan, hold,
 * usage or settlement. The port is the host-owned provider count transport —
 * real counting happens at the provider; the gateway never estimates (an
 * estimate would corrupt Anthropic cache accounting, spec §15.2). Absent port:
 * explicit provider-shaped refusal so the client falls back to its own local
 * counting.
 */
export const runNativeCountTokens = async (options: {
  readonly port?: NativeCountTokensPort; readonly rate?: NativeCountTokensRateLimiter;
}, request: {
  readonly cost: CostContext; readonly body: unknown; readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal; readonly requestId: string;
}): Promise<NativeCountTokensResult> => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new GatewayError('bad-request', 'invalid count body');
  }
  const body = request.body as Record<string, unknown>;
  if (typeof body.model !== 'string' || !body.model.trim()) {
    throw new GatewayError('bad-request', 'invalid count model');
  }
  // Fail closed: a safety-relevant native field is never silently dropped on
  // the passthrough wire (deliberate deviation from the native relay draft,
  // which forwards it when native Messages is enabled).
  if (Object.hasOwn(body, 'safeguards')) return refuseCount(true, false);
  const port = options.port;
  if (!port) return refuseCount(false, false);
  request.signal.throwIfAborted();
  const capability = await port.prepare(routingSubjectForCost(request.cost), {
    workspaceId: request.cost.workspaceId, modelId: body.model, signal: request.signal,
  });
  const headers = buildNativeRequestHeaders(request.headers);
  const version = headers['anthropic-version'] ?? capability?.apiVersions[0];
  const callerVersion = Object.keys(request.headers).some(name => name.toLowerCase() === 'anthropic-version');
  if (!capability || capability.modelId !== body.model
    || !port.modelIds.includes(capability.modelId) || capability.providerId !== 'anthropic'
    || typeof version !== 'string' || !version.trim()
    || !capability.apiVersions.includes(version) || (callerVersion && !Object.hasOwn(headers, 'anthropic-version'))) {
    return refuseCount(false, true);
  }
  request.signal.throwIfAborted();
  const release = (options.rate ?? defaultNativeCountTokensRateLimiter).acquire(request.cost);
  try {
    const result = await capability.execute({ body: { ...body },
      headers: { forwarded: headers, anthropicVersion: version }, signal: request.signal, requestId: request.requestId });
    if (!Number.isSafeInteger(result.body.input_tokens) || (result.body.input_tokens as number) < 0) {
      throw new NativeCountUpstreamError(anthropicError(503, 'api_error',
        'counting service temporarily unavailable'));
    }
    return result;
  } finally { release(); }
};
