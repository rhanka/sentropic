import type { RouteAttemptDispatchPort, RouteAttemptDispatchRequest } from './ports/dispatch.js';

const validate = (input: RouteAttemptDispatchRequest): void => {
  if (Object.hasOwn(input.request, 'auth')) throw new TypeError('Routed auth injection is forbidden');
  if (input.request.signal?.aborted) {
    // The adapter has not invoked the provider; flows must not estimate billable input.
    throw Object.assign(new Error('Route cancelled before provider invocation', {
      cause: input.request.signal.reason,
    }), { usage: { inputTokens: 0, outputTokens: 0, estimated: false } });
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
}
