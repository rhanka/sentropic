import { createJudgeError } from '../judge/errors.js';
import type { JudgeError } from '../judge/errors.js';
import { sanitizeJevId } from '../judge/jev-response.js';
import { JUDGE_MAX_JSON_BYTES, snapshotBoundedJson } from '../judge/validation.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export type JevTransportResult = { ok: true; body: unknown; providerRequestId?: string }
  | { ok: false; error: JudgeError };
export interface JevTransport {
  send(bodyJson: string, token: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<JevTransportResult>;
}
export interface JevTransportOptions { fetch: typeof globalThis.fetch; maxResponseBytes?: number }

/** Trusted, explicitly injected fetch must have retries disabled. Construction performs no I/O. */
export function createJevTransport(options: JevTransportOptions): JevTransport {
  const cap = options.maxResponseBytes ?? JUDGE_MAX_JSON_BYTES;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > JUDGE_MAX_JSON_BYTES) throw new Error('Invalid JEV response bound.');
  return { async send(bodyJson, token, call = {}) {
    if (!token.trim() || /[\r\n]/.test(token)) return { ok: false, error: createJudgeError('CREDENTIAL_MISSING', 'preflight') };
    if (call.signal?.aborted) return { ok: false, error: createJudgeError('CANCELLED', 'dispatch') };
    try {
      const response = await options.fetch(JEV_ENDPOINT, { method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: bodyJson, signal: call.signal });
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        return { ok: false, error: createJudgeError('PROVIDER_REJECTED', 'dispatch') };
      }
      if (response.status !== 200) return { ok: false, error: createJudgeError('PROVIDER_UNAVAILABLE', 'dispatch') };
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse') };
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
        return { ok: false, error: createJudgeError('RESPONSE_TOO_LARGE', 'parse') };
      }
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse') };
      const buffer = new Uint8Array(cap);
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > cap) {
            void reader.cancel().catch(() => {});
            return { ok: false, error: createJudgeError('RESPONSE_TOO_LARGE', 'parse') };
          }
          buffer.set(chunk.value, size); size += chunk.value.byteLength;
        }
      } finally { reader.releaseLock(); }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
      catch { return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse') }; }
      const snapshot = snapshotBoundedJson(parsed, cap);
      if (!snapshot.ok) return { ok: false, error: createJudgeError('VERDICT_INVALID', 'parse') };
      const id = sanitizeJevId(response.headers.get('x-typesafe-request-id'));
      return { ok: true, body: snapshot.value, ...(id && !id.includes(token) ? { providerRequestId: id } : {}) };
    } catch {
      return { ok: false, error: createJudgeError(call.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED', 'dispatch') };
    }
  } };
}
