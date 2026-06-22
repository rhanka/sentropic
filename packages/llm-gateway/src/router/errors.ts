/**
 * Provider-SHAPED error bodies (spec §3b). The gateway NEVER leaks pool
 * internals — pool/auth failures surface only as provider-style availability /
 * rate-limit / auth errors. Two shapes: Anthropic and OpenAI.
 */

import type { GatewayWire } from '../ports/dispatch.js';

export interface ProviderShapedError {
  readonly status: number;
  readonly body: unknown;
}

export const anthropicError = (
  status: number,
  type: string,
  message: string,
): ProviderShapedError => ({
  status,
  body: { type: 'error', error: { type, message } },
});

export const openAiError = (
  status: number,
  type: string,
  message: string,
  code?: string,
): ProviderShapedError => ({
  status,
  body: { error: { message, type, ...(code ? { code } : {}) } },
});

/** Map a gateway condition to a provider-shaped error for the given wire (spec §3b). */
export const notImplemented = (wire: GatewayWire): ProviderShapedError =>
  wire === 'anthropic-messages'
    ? anthropicError(501, 'api_error', 'gateway path not implemented in v0 scaffold')
    : openAiError(501, 'server_error', 'gateway path not implemented in v0 scaffold', 'not_implemented');
