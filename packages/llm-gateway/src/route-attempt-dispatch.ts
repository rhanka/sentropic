import type { RouteAttemptDispatchPort, RouteAttemptDispatchRequest } from './ports/dispatch.js';
import type { NativeAttemptDispatchRequest } from './ports/dispatch.js';
import { isPreparedNativeMessages, NativeMessagesUpstreamError } from '@sentropic/llm-mesh';

const validate = (input: RouteAttemptDispatchRequest): void => {
  if (Object.hasOwn(input.request, 'auth')) throw new TypeError('Routed auth injection is forbidden');
  if (input.request.signal?.aborted) {
    // The adapter has not invoked the provider; flows must not estimate billable input.
    throw Object.assign(new Error('Route cancelled before provider invocation', {
      cause: input.request.signal.reason,
    }), { usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
  }
};

const validateNative = (input: NativeAttemptDispatchRequest): void => {
  if (!isPreparedNativeMessages(input.capability)
    || input.capability.modelId !== input.request.body.model
    || !input.capability.apiVersions.includes(input.request.headers.anthropicVersion)) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
  }
  if (input.request.signal.aborted) {
    throw new NativeMessagesUpstreamError({ status: 503, code: 'account_unavailable',
      usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
  }
};

/** Delegation only: the flow retains planning, retries, lifecycle and metering. */
export class RouteAttemptDispatch implements RouteAttemptDispatchPort {
  async generate(input: RouteAttemptDispatchRequest) {
    validate(input);
    return input.attempt.generate(input.request);
  }
  async stream(input: RouteAttemptDispatchRequest) {
    validate(input);
    return input.attempt.stream(input.request);
  }
  async nativeMessages(input: NativeAttemptDispatchRequest) {
    validateNative(input);
    return input.capability.execute(input.request);
  }
}

/** Custom canonical-only adapters still delegate native execution to its capability. */
export const dispatchNativeMessages = async (port: RouteAttemptDispatchPort | undefined, input: NativeAttemptDispatchRequest) => {
  validateNative(input);
  return (port?.nativeMessages ? port : new RouteAttemptDispatch()).nativeMessages!(input);
};
