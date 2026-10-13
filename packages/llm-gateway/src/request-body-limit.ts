import type { MiddlewareHandler } from 'hono';
import { GatewayError, toProviderShapedError } from './router/errors.js';
import { GATEWAY_MAX_REQUEST_BODY_BYTES } from './request-too-large.js';
import { defaultGatewayBodyBytePool, type GatewayBodyBytePool } from './request-body-pool.js';
import { CheckedGatewayBody } from './request-body-retention.js';
import { DEFAULT_RESPONSES_LIMITS } from './responses-egress.js';
import type { GatewayWire } from './ports/dispatch.js';
export { CheckedGatewayBody } from './request-body-retention.js';

export { GATEWAY_MAX_REQUEST_BODY_BYTES } from './request-too-large.js';

export interface RequestBodyLimitOptions {
  readonly limitBytes?: number;
  /** Resolved Responses maxBodyBytes from the host; defaults to 16 MiB. */
  readonly responsesLimitBytes?: number;
  /** Trusted configured mount prefix (`/api/v1/gw`, `/gw`); bare by default. */
  readonly mountPrefix?: string;
  readonly pool?: GatewayBodyBytePool;
  /** Trusted instrumentation; must return exact, dedicated chunk backing storage. */
  readonly storage?: (bytes: number) => Uint8Array;
}

const BODY_ROUTES = [
  { path: '/v1/messages', wire: 'anthropic-messages', responses: false },
  { path: '/v1/chat/completions', wire: 'openai-chat-completions', responses: false },
  { path: '/responses', wire: 'openai-responses', responses: true },
  { path: '/v1/responses', wire: 'openai-responses', responses: true },
  { path: '/v1/messages/count_tokens', wire: 'anthropic-messages', responses: false },
] as const;

/** Exact five-path match after removing one trusted mount prefix; lookalikes rejected. */
export const resolveGatewayBodyRoute = (
  request: Request, mountPrefix = '',
): { readonly wire: GatewayWire; readonly responses: boolean } | undefined => {
  if (request.method !== 'POST') return undefined;
  let pathname = new URL(request.url).pathname;
  if (mountPrefix) {
    if (pathname !== mountPrefix && !pathname.startsWith(`${mountPrefix}/`)) return undefined;
    pathname = pathname === mountPrefix ? '/' : pathname.slice(mountPrefix.length);
  }
  return BODY_ROUTES.find((route) => route.path === pathname);
};

export const isGatewayBodyPath = (request: Request, mountPrefix = ''): boolean =>
  resolveGatewayBodyRoute(request, mountPrefix) !== undefined;

/** Effective actual-byte ceiling: 32 MB paths, Responses keeps the smaller validated host cap. */
export const resolveGatewayBodyLimit = (
  responses: boolean, options: RequestBodyLimitOptions,
): number => {
  const host = options.limitBytes ?? GATEWAY_MAX_REQUEST_BODY_BYTES;
  if (!responses) return host;
  const responsesCap = options.responsesLimitBytes ?? DEFAULT_RESPONSES_LIMITS.maxBodyBytes;
  return Math.min(DEFAULT_RESPONSES_LIMITS.maxBodyBytes, responsesCap, host);
};
