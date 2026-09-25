import type { CallerAuthPort, CallerAuthRequestContext } from '../ports/caller-auth.js';
import { GatewayError } from '../router/errors.js';

export const validateAuthContext = (context: CallerAuthRequestContext): void => {
  try {
    if (!context?.method?.trim() || !context.requestId?.trim()) throw Error();
    const url = new URL(context.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
  } catch {
    throw new GatewayError('caller-auth-unavailable', 'invalid authentication context');
  }
  context.signal?.throwIfAborted();
};

export const authenticateCaller = async (
  port: CallerAuthPort, headers: Readonly<Record<string, string>>, context: CallerAuthRequestContext,
) => {
  validateAuthContext(context);
  try {
    const result = await port.verify(headers, context);
    context.signal?.throwIfAborted();
    return result;
  } catch {
    context.signal?.throwIfAborted();
    throw new GatewayError('caller-auth-unavailable', 'caller verification unavailable');
  }
};
