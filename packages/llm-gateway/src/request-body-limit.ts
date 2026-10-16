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

const checked = new WeakMap<Request, {
  readonly limitBytes: number;
  readonly pool: GatewayBodyBytePool;
  readonly promise: Promise<CheckedGatewayBody>;
}>();

/** Actual bytes only; no Request clone, Content-Length hint or raw consolidation. */
const readGatewayBody = async (request: Request, options: RequestBodyLimitOptions): Promise<CheckedGatewayBody> => {
  const route = resolveGatewayBodyRoute(request, options.mountPrefix);
  const limit = route ? resolveGatewayBodyLimit(route.responses, options)
    : options.limitBytes ?? GATEWAY_MAX_REQUEST_BODY_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid gateway body limit');
  const pool = options.pool ?? defaultGatewayBodyBytePool;
  if (pool.capacityBytes < limit) throw new Error('Gateway body capacity must cover its request limit');
  const reader = request.body?.getReader();
  const lease = pool.acquire();
  const chunks: Uint8Array[] = [];
  let text: string | undefined;
  let bytes = 0;
  const abort = () => { void reader?.cancel(request.signal.reason).catch(() => undefined); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    request.signal.throwIfAborted();
    if (!reader) return new CheckedGatewayBody(undefined, 0, lease);
    if (reader) {
      for (;;) {
        const next = await reader.read();
        request.signal.throwIfAborted();
        if (next.done) break;
        const received = bytes + next.value.byteLength;
        if (received > limit) {
          throw new GatewayError('request-too-large', 'Ingress body limit exceeded', undefined,
            undefined, undefined, undefined, { requestBytes: received, limitBytes: limit,
              source: 'gateway', sizeIsLowerBound: true });
        }
        lease.extend(next.value.byteLength);
        if (!next.value.byteLength) continue;
        const storage = options.storage?.(next.value.byteLength) ?? new Uint8Array(next.value.byteLength);
        if (storage.byteLength !== next.value.byteLength || storage.buffer.byteLength !== storage.byteLength
          || storage.byteOffset !== 0) throw new Error('Invalid gateway ingress storage');
        storage.set(next.value);
        chunks.push(storage);
        bytes = received;
      }
    }
    const decoder = new TextDecoder();
    text = '';
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    chunks.length = 0;
    try {
      const body: unknown = JSON.parse(text);
      text = undefined;
      return new CheckedGatewayBody(body, bytes, lease);
    }
    catch { throw new GatewayError('bad-request', 'Invalid JSON body'); }
  } catch (error) {
    text = undefined;
    chunks.length = 0;
    lease.release();
    try { await reader?.cancel(error); } catch { /* Preserve the ingress refusal. */ }
    throw error;
  } finally {
    request.signal.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
};

/**
 * Trusted request-local promise also coalesces overlapping middleware reads.
 * A cached owner is reused only under the same effective limit and pool.
 */
export const ensureCheckedGatewayBody = (
  request: Request, options: RequestBodyLimitOptions = {},
): Promise<CheckedGatewayBody> => {
  const route = resolveGatewayBodyRoute(request, options.mountPrefix);
  const limit = route ? resolveGatewayBodyLimit(route.responses, options)
    : options.limitBytes ?? GATEWAY_MAX_REQUEST_BODY_BYTES;
  const pool = options.pool ?? defaultGatewayBodyBytePool;
  const entry = checked.get(request);
  if (entry && entry.limitBytes === limit && entry.pool === pool) return entry.promise;
  const promise = readGatewayBody(request, options);
  checked.set(request, { limitBytes: limit, pool, promise });
  return promise;
};

/** Mount after product authentication and before any gateway settlement/body parser. */
export const gatewayRequestBodyLimit = (
  options: RequestBodyLimitOptions = {}, requestId: () => string = () => crypto.randomUUID(),
): MiddlewareHandler => async (c, next) => {
  const route = resolveGatewayBodyRoute(c.req.raw, options.mountPrefix);
  if (!route) return next();
  let owner: CheckedGatewayBody;
  try { owner = await ensureCheckedGatewayBody(c.req.raw, options); }
  catch (error) {
    const mapped = toProviderShapedError(route.wire, error);
    for (const [key, value] of Object.entries(mapped.headers ?? {})) c.header(key, value);
    c.header('X-Sentropic-Request-Id', requestId());
    return c.json(mapped.body as object, mapped.status as 400);
  }
  try { await next(); }
  finally { if (!owner.transferred) owner.release(); }
};
