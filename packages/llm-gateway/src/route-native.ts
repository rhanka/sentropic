import { GatewayError } from './router/errors.js';
import { isPreparedNativeMessages, type PreparedRouteAttempt } from '@sentropic/llm-mesh';
import type { NativeFeatureSelection } from './native-features.js';
import type { ResolvedTarget } from './flow.js';

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
