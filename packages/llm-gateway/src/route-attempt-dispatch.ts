import type { RouteAttemptDispatchPort, RouteAttemptDispatchRequest } from './ports/dispatch.js';

const validate = (input: RouteAttemptDispatchRequest): void => {
  if (Object.hasOwn(input.request, 'auth')) throw new TypeError('Routed auth injection is forbidden');
  input.request.signal?.throwIfAborted();
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
