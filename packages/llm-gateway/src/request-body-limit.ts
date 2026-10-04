import { GatewayError } from './router/errors.js';
import { GATEWAY_MAX_REQUEST_BODY_BYTES } from './request-too-large.js';
import { defaultGatewayBodyBytePool, type GatewayBodyBytePool, type GatewayBodyByteLease } from './request-body-pool.js';

export { GATEWAY_MAX_REQUEST_BODY_BYTES } from './request-too-large.js';

export interface CheckedGatewayBody {
  body: unknown;
  readonly bytes: number;
  readonly lease: GatewayBodyByteLease;
}

export interface RequestBodyLimitOptions {
  readonly limitBytes?: number;
  readonly pool?: GatewayBodyBytePool;
  /** Trusted instrumentation; must return exact, dedicated chunk backing storage. */
  readonly storage?: (bytes: number) => Uint8Array;
}

const checked = new WeakMap<Request, Promise<CheckedGatewayBody>>();

export const isGatewayBodyPath = (request: Request): boolean =>
  request.method === 'POST' && /\/v1\/(messages(?:\/count_tokens)?|chat\/completions)$/.test(new URL(request.url).pathname);

/** Actual bytes only; no Request clone, Content-Length hint or raw consolidation. */
const readGatewayBody = async (request: Request, options: RequestBodyLimitOptions): Promise<CheckedGatewayBody> => {
  const limit = options.limitBytes ?? GATEWAY_MAX_REQUEST_BODY_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid gateway body limit');
  const pool = options.pool ?? defaultGatewayBodyBytePool;
  if (pool.capacityBytes < limit) throw new Error('Gateway body capacity must cover its request limit');
  const lease = pool.acquire();
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader?.cancel(request.signal.reason).catch(() => undefined); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    request.signal.throwIfAborted();
    if (reader) {
      for (;;) {
        const next = await reader.read();
        request.signal.throwIfAborted();
        if (next.done) break;
        const received = bytes + next.value.byteLength;
        if (received > limit) {
          throw new GatewayError('request-too-large', 'Ingress body limit exceeded', undefined,
            undefined, undefined, { requestBytes: received, limitBytes: limit,
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
    let text = '';
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    chunks.length = 0;
    try { return { body: JSON.parse(text), bytes, lease }; }
    catch { throw new GatewayError('bad-request', 'Invalid JSON body'); }
  } catch (error) {
    chunks.length = 0;
    lease.release();
    try { await reader?.cancel(error); } catch { /* Preserve the ingress refusal. */ }
    throw error;
  } finally {
    request.signal.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
};

/** Trusted request-local promise also coalesces overlapping middleware reads. */
export const ensureCheckedGatewayBody = (
  request: Request, options: RequestBodyLimitOptions = {},
): Promise<CheckedGatewayBody> => {
  let result = checked.get(request);
  if (!result) {
    result = readGatewayBody(request, options);
    checked.set(request, result);
  }
  return result;
};
