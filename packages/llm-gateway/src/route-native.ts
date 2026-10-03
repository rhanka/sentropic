import { GatewayError } from './router/errors.js';

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
