import { createDecisionError } from '../decision/errors.js';
import type { DecisionError } from '../decision/errors.js';
import { sanitizeJevId as sanitizeOpenAiDecisionsId } from '../decision/jev-response.js';
import { DECISION_MAX_JSON_BYTES, snapshotBoundedJson } from '../decision/validation.js';

export const OPENAI_DECISIONS_ENDPOINT = 'https://api.openai.com/v1/decisions';
export type OpenAiDecisionsTransportResult = { ok: true; body: unknown; providerRequestId?: string }
  | { ok: false; error: DecisionError };
export interface OpenAiDecisionsTransport {
  send(bodyJson: string, token: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<OpenAiDecisionsTransportResult>;
}
export interface OpenAiDecisionsTransportOptions { fetch: typeof globalThis.fetch; maxResponseBytes?: number }

/** Trusted, explicitly injected fetch must have retries disabled. Construction performs no I/O. */
export function createOpenAiDecisionsTransport(options: OpenAiDecisionsTransportOptions): OpenAiDecisionsTransport {
  const cap = options.maxResponseBytes ?? DECISION_MAX_JSON_BYTES;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > DECISION_MAX_JSON_BYTES) throw new Error('Invalid OPENAI_DECISIONS response bound.');
  return { async send(bodyJson, token, call = {}) {
    if (!token.trim() || token !== token.trim() || /[\r\n]/.test(token)) return { ok: false, error: createDecisionError('CREDENTIAL_MISSING', 'preflight') };
    if (call.signal?.aborted) return { ok: false, error: createDecisionError('CANCELLED', 'dispatch') };
    const timeoutMs = call.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      return { ok: false, error: createDecisionError('REQUEST_INVALID', 'preflight') };
    }
    const controller = new AbortController();
    let timedOut = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let onAbort!: () => void;
    const aborted = new Promise<OpenAiDecisionsTransportResult>((resolve) => {
      onAbort = () => {
        void reader?.cancel().catch(() => {});
        resolve({ ok: false, error: createDecisionError(timedOut ? 'TIMEOUT' : 'CANCELLED', 'dispatch') });
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const cancel = () => controller.abort();
    call.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const run = async (): Promise<OpenAiDecisionsTransportResult> => {
    try {
      const response = await options.fetch(OPENAI_DECISIONS_ENDPOINT, { method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: bodyJson, signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return await aborted; }
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        return { ok: false, error: createDecisionError('PROVIDER_REJECTED', 'dispatch') };
      }
      if (response.status !== 200) {
        const code = response.status === 401 ? 'AUTHENTICATION_FAILED' : response.status === 422 ? 'PROVIDER_REJECTED'
          : response.status === 429 ? 'RATE_LIMITED' : response.status === 529 ? 'PROVIDER_OVERLOADED'
          : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED';
        return { ok: false, error: createDecisionError(code, 'dispatch') };
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse') };
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
        return { ok: false, error: createDecisionError('RESPONSE_TOO_LARGE', 'parse') };
      }
      reader = response.body?.getReader();
      if (!reader) return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse') };
      const buffer = new Uint8Array(cap);
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > cap) {
            void reader.cancel().catch(() => {});
            return { ok: false, error: createDecisionError('RESPONSE_TOO_LARGE', 'parse') };
          }
          buffer.set(chunk.value, size); size += chunk.value.byteLength;
        }
      } finally { reader.releaseLock(); reader = undefined; }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))); }
      catch { return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse') }; }
      const snapshot = snapshotBoundedJson(parsed, cap);
      if (!snapshot.ok) return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse') };
      const id = sanitizeOpenAiDecisionsId(response.headers.get('x-request-id'));
      return { ok: true, body: snapshot.value, ...(id && !id.includes(token) ? { providerRequestId: id } : {}) };
    } catch {
      return { ok: false, error: createDecisionError(timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED', 'dispatch') };
    }
    };
    try { return await Promise.race([run(), aborted]); }
    finally {
      clearTimeout(timer); call.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', onAbort);
    }
  } };
}
