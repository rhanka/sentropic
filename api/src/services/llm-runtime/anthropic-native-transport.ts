import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';
import { NATIVE_MAX_ERROR_BODY_BYTES, parseNativeErrorDetail, NativeSseFramer } from '@sentropic/llm-gateway';
import type { NativeReadiness } from './anthropic-native-readiness';

/** Test instrumentation observes actual holders, never request contents. */
export type NativeBodyProbe = (holder: 'body' | 'serialization' | 'upload', retained: boolean) => void;

/** A zero-prefetch upload: completion/cancellation clears every host-owned body holder. */
export const createNativeUpload = (body: Readonly<Record<string, unknown>> | undefined, probe?: NativeBodyProbe) => {
  probe?.('body', true);
  let serialized: string | undefined;
  let bytes: Uint8Array | undefined;
  try {
    serialized = JSON.stringify(body);
    probe?.('serialization', true);
    bytes = new TextEncoder().encode(serialized);
    probe?.('upload', true);
  } finally {
    body = undefined;
    serialized = undefined;
    probe?.('body', false);
    probe?.('serialization', false);
  }
  const requestBytes = bytes!.byteLength;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let sent = false;
  let settled = false;
  const detach = () => { settled = true; bytes = undefined; probe?.('upload', false); };
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull(value) {
      if (!sent) { sent = true; value.enqueue(bytes!); }
      else { value.close(); }
    },
    cancel() { detach(); },
  }, { highWaterMark: 0 });
  return { stream, requestBytes,
    complete: detach,
    finish() {
      if (settled) return;
      // An early response is not upload completion. Erroring the producer cancels
      // pending upload reads and discards its queue before any result is exposed.
      controller.error(new DOMException('Native upload cancelled', 'AbortError'));
      detach();
    },
  };
};

export const nativeTransportHeaders = (forwarded: Readonly<Record<string, string>>, version: string,
  auth: { credential?: string; accessToken?: string }): Headers => {
  const excluded = new Set(['authorization', 'x-api-key', 'api-key', 'anthropic-api-key',
    'anthropic-admin-api-key', 'anthropic-oauth-token', 'anthropic-key']);
  for (const [key, value] of Object.entries(forwarded)) {
    if (key.toLowerCase() === 'connection') value.split(',').forEach(name => excluded.add(name.trim().toLowerCase()));
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(forwarded)) {
    const name = key.toLowerCase();
    if (!excluded.has(name) && (name.startsWith('anthropic-') || name === 'x-app' || name.startsWith('x-stainless-'))) {
      headers.set(name, value);
    }
  }
  headers.set('content-type', 'application/json');
  headers.set('anthropic-version', version);
  if (auth.accessToken) headers.set('authorization', `Bearer ${auth.accessToken}`);
  else if (auth.credential?.trim()) headers.set('x-api-key', auth.credential);
  else throw new NativeMessagesUpstreamError({ status: 503, code: 'account_unavailable' });
  return headers;
};

/** This closure owns response state only, including when return precedes next. */
export const nativeResponseBytes = (response: Response, readiness: NativeReadiness): AsyncIterable<Uint8Array> => {
  const reader = response.body?.getReader();
  let framer: NativeSseFramer | undefined = new NativeSseFramer();
  let closed = false;
  let aborted = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    readiness.signal.removeEventListener('abort', abort);
    readiness.close();
    framer = undefined;
    try { await reader?.cancel(); } finally { reader?.releaseLock(); }
  };
  const abort = () => { aborted = true; void close().catch(() => undefined); };
  readiness.signal.addEventListener('abort', abort, { once: true });
  if (readiness.signal.aborted) abort();
  return { [Symbol.asyncIterator]: () => ({
    async next() {
      if (aborted) throw readiness.failure(readiness.signal.reason);
      if (closed || !reader) return { done: true as const, value: undefined };
      try {
        const chunk = await readiness.race(reader.read());
        if (chunk.done) { await close(); return { done: true as const, value: undefined }; }
        if (framer) for (const frame of framer.frames(chunk.value)) {
          let type: unknown = frame.event;
          if (frame.data) { try { if (JSON.parse(frame.data)?.type === 'error') type = 'error'; } catch { /* Opaque frame. */ } }
          if (type !== 'error') { readiness.ready(); framer = undefined; break; }
        }
        return { done: false as const, value: chunk.value };
      } catch (error) { await close(); throw readiness.failure(error); }
    },
    async return() { await close(); return { done: true as const, value: undefined }; },
  }) };
};

export const nativeHttpError = async (response: Response, requestBytes: number,
  features: { requestSafeguards: boolean; sentBetas: readonly string[] }): Promise<NativeMessagesUpstreamError> => {
  let validation;
  if (response.status === 400 && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > NATIVE_MAX_ERROR_BODY_BYTES) break;
        chunks.push(chunk.value);
      }
      if (size <= NATIVE_MAX_ERROR_BODY_BYTES) {
        const bytes = new Uint8Array(size); let offset = 0;
        chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
        validation = parseNativeErrorDetail(bytes, 400, features);
      }
    } catch { /* Unparseable errors use the fixed native envelope. */ }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } else await response.body?.cancel().catch(() => undefined);
  return new NativeMessagesUpstreamError({ status: response.status, validation,
    ...(response.status === 413 ? { requestSize: { requestBytes, source: 'upstream' as const } } : {}) });
};
