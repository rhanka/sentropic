import type { JudgeRequest } from './request.js';
import type { JudgeConnectionFailure, JudgeResult, RemoteJudgeClient } from './receipt.js';
import { resolveJudgeCorrelationId, unreportedJudgeUsage } from './receipt.js';
import type { JudgeError } from './errors.js';
import { createJudgeError, isJudgeErrorCode } from './errors.js';
import { JUDGE_MAX_JSON_BYTES, isRecord, snapshotBoundedJson } from './validation.js';

export interface RemoteJudgeClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  authToken?: string | (() => string | Promise<string>);
  maxResponseBytes?: number;
  timeoutMs?: number;
  generateId?: () => string;
}

const resolveEndpoint = (base: string) => {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/judge') ? trimmed : `${trimmed}/judge`;
};

type ConnectionErrorCode = 'MESH_UNAVAILABLE' | 'TRANSPORT_FAILED' | 'TIMEOUT' | 'CANCELLED';
const connectionError = (code: ConnectionErrorCode, phase: 'preflight' | 'dispatch') =>
  createJudgeError(code, phase) as JudgeError & { code: ConnectionErrorCode };

/** Remote judge client calling an authenticated mesh endpoint without custody of provider keys. */
export function createRemoteJudgeClient(options: RemoteJudgeClientOptions): RemoteJudgeClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const cap = options.maxResponseBytes ?? JUDGE_MAX_JSON_BYTES;
  const endpoint = resolveEndpoint(options.baseUrl);
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());

  return {
    async judge(request: JudgeRequest, callOptions?: { signal?: AbortSignal }): Promise<JudgeResult | JudgeConnectionFailure> {
      let correlationId = generate();
      if (request.correlationId !== undefined) {
        const validated = resolveJudgeCorrelationId(request.correlationId, generate);
        if (!validated) {
          return { kind: 'connection-failure', ok: false, error: connectionError('MESH_UNAVAILABLE', 'preflight'),
            receipt: null, usage: unreportedJudgeUsage('not-dispatched'), callStatus: 'not-sent', correlationId };
        }
        correlationId = validated;
      }
      if (callOptions?.signal?.aborted) {
        return { kind: 'connection-failure', ok: false, error: connectionError('CANCELLED', 'preflight'),
          receipt: null, usage: unreportedJudgeUsage('not-dispatched'), callStatus: 'not-sent', correlationId };
      }
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
      if (options.authToken) {
        const token = typeof options.authToken === 'function' ? await options.authToken() : options.authToken;
        if (token) headers.authorization = `Bearer ${token}`;
      }
      if (options.headers) {
        const extra = typeof options.headers === 'function' ? await options.headers() : options.headers;
        Object.assign(headers, extra);
      }
      const timeoutMs = Math.max(1, Math.min(60_000, request.policy?.timeoutMs ?? options.timeoutMs ?? 10_000));
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const onAbort = () => controller.abort();
      callOptions?.signal?.addEventListener('abort', onAbort, { once: true });
      const fail = (code: ConnectionErrorCode): JudgeConnectionFailure => ({
        kind: 'connection-failure', ok: false, error: connectionError(code, 'dispatch'),
        receipt: null, usage: unreportedJudgeUsage('unknown'), callStatus: 'unknown', correlationId,
      });

      let response: Response;
      try {
        response = await fetchFn(endpoint, {
          method: 'POST', headers, body: JSON.stringify({ ...request, correlationId }), signal: controller.signal,
        });
      } catch {
        return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
      } finally {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
      }

      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
        void response.body?.cancel().catch(() => {});
        return fail('MESH_UNAVAILABLE');
      }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const buffer = new Uint8Array(Math.min(cap, 65_536));
      let size = 0;
      let chunks: Uint8Array = buffer;
      try {
        reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (size + chunk.value.byteLength > cap) {
              void reader.cancel().catch(() => {});
              return fail('MESH_UNAVAILABLE');
            }
            if (size + chunk.value.byteLength > chunks.byteLength) {
              const next = new Uint8Array(Math.min(cap, Math.max(chunks.byteLength * 2, size + chunk.value.byteLength)));
              next.set(chunks.subarray(0, size));
              chunks = next;
            }
            chunks.set(chunk.value, size);
            size += chunk.value.byteLength;
          }
        }
      } catch {
        return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
      } finally { reader?.releaseLock(); }

      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks.subarray(0, size))); }
      catch { return fail('MESH_UNAVAILABLE'); }
      const snapshot = snapshotBoundedJson(parsed, cap);
      if (!snapshot.ok || !isRecord(snapshot.value)) return fail('MESH_UNAVAILABLE');
      const val = snapshot.value;
      if (val.kind === 'verdict' && val.ok === true && isRecord(val.verdict) && isRecord(val.receipt)) {
        return val as unknown as JudgeResult;
      }
      if (val.kind === 'error' && val.ok === false && isRecord(val.error) && isRecord(val.receipt)) {
        const err = val.error;
        if (isJudgeErrorCode(err.code) && ['preflight', 'admission', 'dispatch', 'parse', 'settlement'].includes(err.phase as string)) {
          return val as unknown as JudgeResult;
        }
        return fail('MESH_UNAVAILABLE');
      }
      return fail('MESH_UNAVAILABLE');
    },
  };
}
