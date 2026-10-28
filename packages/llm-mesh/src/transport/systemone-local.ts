import type { DecisionError } from '../decision/errors.js';
import { createDecisionError } from '../decision/errors.js';
import { KEV_SERVED_MODEL_ID, kevInventoryMatches } from '../decision/kev-descriptor.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from '../decision/validation.js';

export const SYSTEMONE_LOCAL_ENDPOINT = 'http://127.0.0.1:8797/v1/systemone';
export type SystemOneLocalResult = { ok: true; body: unknown; servedModelId: string }
  | { ok: false; error: DecisionError };
export interface SystemOneLocalTransport {
  send(bodyJson: string, token: string, call?: { signal?: AbortSignal; timeoutMs?: number }): Promise<SystemOneLocalResult>;
}
export interface SystemOneLocalOptions {
  fetch: typeof globalThis.fetch;
  /** Trusted host port: verify bytes AND running process ownership/configuration, never response-supplied metadata. */
  verifyInventory(signal: AbortSignal): Promise<unknown>;
}

/** Fixed loopback origin, one POST, no redirects/retries. A model alias alone is never an attestation. */
export function createSystemOneLocalTransport(options: SystemOneLocalOptions): SystemOneLocalTransport {
  return { async send(bodyJson, token, call = {}) {
    const failed = (code: Parameters<typeof createDecisionError>[0]): SystemOneLocalResult =>
      ({ ok: false, error: createDecisionError(code, 'dispatch') });
    const timeout = call.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000
      || new TextEncoder().encode(bodyJson).length > 256 * 1024) return failed('REQUEST_INVALID');
    if (!token.trim() || token !== token.trim() || /[\r\n]/.test(token)) return failed('CREDENTIAL_MISSING');
    let request: unknown;
    try { request = JSON.parse(bodyJson); } catch { return failed('REQUEST_INVALID'); }
    if (!isRecord(request) || !hasOnlyKeys(request, ['model', 'state', 'questions'])
      || request.model !== KEV_SERVED_MODEL_ID || !isRecord(request.questions)
      || Object.keys(request.questions).length !== 1 || !isRecord(request.questions.verdict)) return failed('SERVED_IDENTITY_MISMATCH');
    const controller = new AbortController();
    let timedOut = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stop!: () => void;
    const interrupted = new Promise<SystemOneLocalResult>((resolve) => {
      stop = () => {
        void reader?.cancel().catch(() => {});
        resolve(failed(timedOut ? 'TIMEOUT' : 'CANCELLED'));
      };
      controller.signal.addEventListener('abort', stop, { once: true });
    });
    const cancel = () => controller.abort();
    call.signal?.addEventListener('abort', cancel, { once: true });
    if (call.signal?.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
    const active = () => { if (controller.signal.aborted) throw new Error('Interrupted.'); };
    const read = async (url: string, body?: string): Promise<unknown> => {
      active();
      const response = await options.fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body }), signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); active(); }
      if (response.redirected || response.status !== 200
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        void response.body?.cancel().catch(() => {}); throw new Error('Invalid local response.');
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 65536)) {
        void response.body?.cancel().catch(() => {}); throw new Error('Response bound exceeded.');
      }
      reader = response.body?.getReader();
      if (!reader) throw new Error('Missing local response.');
      const buffer = new Uint8Array(65536);
      let size = 0;
      try {
        for (;;) {
          active();
          const chunk = await reader.read();
          active();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > buffer.length) {
            void reader.cancel().catch(() => {}); throw new Error('Response bound exceeded.');
          }
          buffer.set(chunk.value, size); size += chunk.value.byteLength;
        }
      } finally { reader.releaseLock(); reader = undefined; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    };
    const inventory = async () => {
      active();
      const verified = await options.verifyInventory(controller.signal);
      active();
      if (!kevInventoryMatches(verified)) return false;
      const models = await read('http://127.0.0.1:8797/v1/models');
      active();
      if (!isRecord(models) || !Array.isArray(models.data) || models.data.length !== 1) return false;
      const model = models.data[0];
      return isRecord(model) && model.id === KEV_SERVED_MODEL_ID && isRecord(model.architecture)
        && Array.isArray(model.architecture.output_modalities) && model.architecture.output_modalities.includes('decisions');
    };
    const run = async (): Promise<SystemOneLocalResult> => {
      try {
        if (!await inventory()) return failed('SERVED_IDENTITY_MISMATCH');
        active();
        const body = await read(SYSTEMONE_LOCAL_ENDPOINT, bodyJson);
        active();
        if (!await inventory()) return failed('SERVED_IDENTITY_MISMATCH');
        active();
        const snapshot = snapshotBoundedJson(body, 65536);
        return snapshot.ok ? { ok: true, body: snapshot.value, servedModelId: KEV_SERVED_MODEL_ID } : failed('VERDICT_INVALID');
      } catch { return failed(timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED'); }
    };
    try { return await Promise.race([run(), interrupted]); }
    finally {
      clearTimeout(timer); call.signal?.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', stop);
    }
  } };
}
