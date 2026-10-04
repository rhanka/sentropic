import { isNativeMessagesTarget, NativeMessagesUpstreamError,
  type NativeMessagesRequest, type NativeMessagesResult, type VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import type { CostContext } from './ports/cost-context.js';
import { routingSubjectForCost } from './route-flow-core.js';
import { assertNativeMessagesResult } from './route-native.js';
import { buildNativeRequestHeaders } from './native-headers.js';
import { GatewayError, anthropicError, mapGatewayError, type ProviderShapedError } from './router/errors.js';
import { defaultNativeCountTokensRateLimiter, type NativeCountTokensRateLimiter } from './native-count-rate.js';

export type NativeCountTokensRequest = Pick<NativeMessagesRequest, 'body' | 'headers' | 'signal' | 'requestId'>;
export type NativeCountTokensResult = Extract<NativeMessagesResult, { kind: 'json' }>;
export interface PreparedNativeCountTokens {
  readonly providerId: string;
  readonly modelId: string;
  readonly apiVersions: readonly string[];
  /** One JSON call, 55-second readiness deadline; cancel upload/detach all request holders before return. */
  execute(request: NativeCountTokensRequest): Promise<NativeCountTokensResult>;
}
export interface NativeCountTokensPort {
  /** Same trusted exact-model allowlist as native Messages; never an alias catalog. */
  readonly modelIds: readonly string[];
  /** Recheck caller partition, catalog and credential availability; unknown catalog model throws unknown-model. */
  prepare(subject: VerifiedRoutingSubject, input: {
    readonly workspaceId?: string; readonly modelId: string; readonly signal: AbortSignal;
  }): Promise<PreparedNativeCountTokens | undefined>;
}
export class NativeCountTokensRefusal extends Error {
  constructor(readonly response: ProviderShapedError) { super('Token counting refused'); }
}
const refuseCount = (safeguards: boolean, disabled: boolean): never => {
  throw new NativeCountTokensRefusal(safeguards ? mapGatewayError('anthropic-messages', 'native-required')
    : anthropicError(400, 'invalid_request_error', disabled
      ? 'Token counting is not supported by this gateway route while native Messages is disabled.'
      : 'Token counting is not supported by this gateway route for this request.'));
};

/** Authenticated count only: no canonical projection, generation plan, hold, usage or settlement. */
export const runNativeCountTokens = async (options: {
  readonly enabled?: boolean; readonly port?: NativeCountTokensPort; readonly rate?: NativeCountTokensRateLimiter;
}, request: {
  readonly cost: CostContext; readonly body: unknown; readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal; readonly requestId: string;
}): Promise<NativeCountTokensResult> => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new GatewayError('bad-request', 'invalid count body');
  }
  const body = request.body as Record<string, unknown>;
  if (typeof body.model !== 'string' || !body.model.trim()) throw new GatewayError('bad-request', 'invalid count model');
  const safeguards = Object.hasOwn(body, 'safeguards');
  if (options.enabled !== true) refuseCount(safeguards, true);
  const port = options.port;
  if (!port) return refuseCount(safeguards, false);
  request.signal.throwIfAborted();
  const capability = await port.prepare(routingSubjectForCost(request.cost), {
    workspaceId: request.cost.workspaceId, modelId: body.model, signal: request.signal,
  });
  const headers = buildNativeRequestHeaders(request.headers);
  const version = headers['anthropic-version'] ?? capability?.apiVersions[0];
  const callerVersion = Object.keys(request.headers).some(name => name.toLowerCase() === 'anthropic-version');
  if (!capability || capability.modelId !== body.model
    || !isNativeMessagesTarget(capability, port.modelIds) || typeof version !== 'string' || !version.trim()
    || !capability.apiVersions.includes(version) || (callerVersion && !Object.hasOwn(headers, 'anthropic-version'))) {
    return refuseCount(safeguards, false);
  }
  request.signal.throwIfAborted();
  const release = (options.rate ?? defaultNativeCountTokensRateLimiter).acquire(request.cost);
  try {
  const result = await capability.execute({ body: { ...body },
    headers: { forwarded: headers, anthropicVersion: version }, signal: request.signal, requestId: request.requestId });
  assertNativeMessagesResult(result, 'json');
  if (!Number.isSafeInteger(result.body.input_tokens) || (result.body.input_tokens as number) < 0) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
  return result;
  } finally { release(); }
};
