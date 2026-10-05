import { GatewayError } from './router/errors.js';
import { isPreparedNativeMessages, NativeMessagesUpstreamError, type NativeMessagesRequest,
  type NativeMessagesResult, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import type { NativeFeatureSelection } from './native-features.js';
import type { ResolvedTarget } from './flow.js';
import type { GatewayFlowRequest } from './flow.js';
import type { PreparedRouteFlow } from './route-flow-core.js';

export class NativeAttemptRefusal extends Error {
  constructor() { super('Prepared native Messages capability unavailable'); }
}

/** Resolve the execute-time version and exact target before marking dispatch. */
export const prepareNativeMessages = (
  selection: NativeFeatureSelection, attempt: PreparedRouteAttempt, target: ResolvedTarget,
) => {
  if (selection.kind === 'none') return undefined;
  const capability = attempt.nativeMessages;
  if (target.providerId === 'anthropic' && isPreparedNativeMessages(capability)
    && capability.modelId === target.model) {
    const anthropicVersion = selection.anthropicVersion ?? capability.apiVersions[0]!;
    if (capability.apiVersions.includes(anthropicVersion)) return { capability, anthropicVersion };
  }
  if (selection.kind === 'required') throw new NativeAttemptRefusal();
  return undefined;
};

const positiveCeiling = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Preserve opaque provider fields and nested identity; override only dispatch-owned fields. */
export const buildNativeMessagesBody = (
  body: unknown,
  dispatch: { readonly model: string; readonly stream: boolean; readonly maxOutputTokens: number },
): Readonly<Record<string, unknown>> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof dispatch.model !== 'string' || !dispatch.model.trim()
    || typeof dispatch.stream !== 'boolean' || !positiveCeiling(dispatch.maxOutputTokens)) {
    throw new GatewayError('bad-request', 'invalid native dispatch fields');
  }
  const original = body as Readonly<Record<string, unknown>>;
  const supplied = Object.hasOwn(original, 'max_tokens');
  if (supplied && !positiveCeiling(original.max_tokens)) {
    throw new GatewayError('bad-request', 'invalid native max_tokens');
  }
  const max_tokens = supplied
    ? Math.min(original.max_tokens as number, dispatch.maxOutputTokens) : dispatch.maxOutputTokens;
  return { ...original, model: dispatch.model, stream: dispatch.stream, max_tokens };
};

export const buildNativeMessagesRequest = (
  prepared: PreparedRouteFlow, request: GatewayFlowRequest,
  native: NonNullable<ReturnType<typeof prepareNativeMessages>>, signal: AbortSignal,
): NativeMessagesRequest => {
  const features = prepared.nativeFeatures;
  if (features.kind === 'none') throw new NativeAttemptRefusal();
  return {
    body: buildNativeMessagesBody(request.body, { model: native.capability.modelId,
      stream: request.stream, maxOutputTokens: prepared.canonical.request.maxOutputTokens ?? features.maxOutputTokens }),
    stream: request.stream, signal, requestId: request.authContext.requestId,
    headers: { anthropicVersion: native.anthropicVersion, forwarded: features.forwarded },
    ...(native.capability.finalize ? { finalize: native.capability.finalize } : {}),
  };
};

/** The host bounds JSON parsing; the gateway accepts only the matching closed envelope. */
export const assertNativeMessagesResult: (result: NativeMessagesResult, kind: 'json' | 'stream') => void = (result, kind) => {
  if (!result || result.kind !== kind || result.status !== 200 || !result.headers
    || typeof result.headers !== 'object' || Array.isArray(result.headers)
    || !Object.values(result.headers).every(value => typeof value === 'string')
    || !result.body || typeof result.body !== 'object'
    || (kind === 'json' ? Array.isArray(result.body)
      : typeof (result.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function')) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
};

/** Register response ownership before envelope validation, without reading any bytes. */
export const nativeResponseReader = (result: NativeMessagesResult): AsyncIterator<Uint8Array> | undefined => {
  if (result?.kind !== 'stream' || !result.body || typeof result.body[Symbol.asyncIterator] !== 'function') return undefined;
  const reader = result.body[Symbol.asyncIterator]();
  if (!reader || typeof reader.next !== 'function' || (reader.return !== undefined && typeof reader.return !== 'function')) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
  return reader;
};
