import type { JudgeRequest } from './request.js';
import type { JudgeConnectionFailure, JudgeReceipt, JudgeResult, RemoteJudgeClient } from './receipt.js';
import { parseJudgeUsage, resolveJudgeCorrelationId, unreportedJudgeUsage } from './receipt.js';
import type { JudgeError } from './errors.js';
import { createJudgeError, isJudgeErrorCode } from './errors.js';
import { hasJudgeVerdictValue } from './verdict.js';
import { JUDGE_MAX_JSON_BYTES, isMicroUsd, isRecord, snapshotBoundedJson } from './validation.js';

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

const BUDGET_STATES = new Set(['not-admitted', 'released', 'settled', 'pending-reconciliation']);
const COST_STATUSES = new Set(['actual', 'estimated', 'not-incurred']);

function isValidJudgeVerdict(v: unknown): boolean {
  if (!isRecord(v) || !['binary', 'graded', 'choice'].includes(v.resolvedCriterionKind as string)) return false;
  return hasJudgeVerdictValue(v as any);
}

function isValidJudgeReceipt(r: unknown, expectedCorrelationId: string): r is JudgeReceipt {
  if (!isRecord(r)) return false;
  if (r.schemaVersion !== 1 || typeof r.callId !== 'string' || !r.callId) return false;
  if (r.correlationId !== expectedCorrelationId) return false;
  if (!isRecord(r.budget) || !BUDGET_STATES.has(r.budget.state as string) || typeof r.budget.overrun !== 'boolean') return false;
  if (!isRecord(r.cost) || !COST_STATUSES.has(r.cost.status as string) || !isMicroUsd(r.cost.amountMicroUsd)) return false;
  if (r.outcome !== 'verdict' && r.outcome !== 'error') return false;
  if (r.outcome === 'error' && (typeof r.errorCode !== 'string' || !r.errorCode)) return false;
  if (r.outcome === 'verdict' && r.errorCode !== undefined) return false;
  return parseJudgeUsage(r.usage) !== null;
}

/** Remote judge client calling an authenticated mesh endpoint without custody of provider keys. */
export function createRemoteJudgeClient(options: RemoteJudgeClientOptions): RemoteJudgeClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const cap = options.maxResponseBytes ?? JUDGE_MAX_JSON_BYTES;
  const endpoint = resolveEndpoint(options.baseUrl);
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());

  return {
    async judge(request: JudgeRequest, callOptions?: { signal?: AbortSignal }): Promise<JudgeResult | JudgeConnectionFailure> {
      let correlationId = 'unknown';
      try {
        const raw = request.correlationId !== undefined
          ? resolveJudgeCorrelationId(request.correlationId, generate)
          : resolveJudgeCorrelationId(generate(), () => globalThis.crypto.randomUUID());
        if (!raw) {
          return { kind: 'connection-failure', ok: false, error: connectionError('MESH_UNAVAILABLE', 'preflight'),
            receipt: null, usage: unreportedJudgeUsage('not-dispatched'), callStatus: 'not-sent', correlationId: 'unknown' };
        }
        correlationId = raw;
      } catch {
        return { kind: 'connection-failure', ok: false, error: connectionError('MESH_UNAVAILABLE', 'preflight'),
          receipt: null, usage: unreportedJudgeUsage('not-dispatched'), callStatus: 'not-sent', correlationId: 'unknown' };
      }
      const serverTimeout = request.policy?.timeoutMs ?? 10_000;
      const serverWithMargin = serverTimeout + 1_000;
      const effectiveTimeout = options.timeoutMs !== undefined ? Math.min(options.timeoutMs, serverWithMargin) : serverWithMargin;
      const timeoutMs = Math.max(1, Math.min(61_000, effectiveTimeout));
      const controller = new AbortController();
      let timedOut = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const onAbort = () => { void reader?.cancel().catch(() => {}); controller.abort(); };
      const timer = setTimeout(() => { timedOut = true; void reader?.cancel().catch(() => {}); controller.abort(); }, timeoutMs);
      callOptions?.signal?.addEventListener('abort', onAbort, { once: true });

      const preflightFail = (code: ConnectionErrorCode): JudgeConnectionFailure => {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
        return {
          kind: 'connection-failure', ok: false, error: connectionError(code, 'preflight'),
          receipt: null, usage: unreportedJudgeUsage('not-dispatched'), callStatus: 'not-sent', correlationId,
        };
      };
      if (callOptions?.signal?.aborted) return preflightFail('CANCELLED');

      const racePreflight = async <T>(promiseOrValue: T | Promise<T>): Promise<T> => {
        if (controller.signal.aborted) throw new Error('preflight-interrupted');
        let cleanup: (() => void) | undefined;
        try {
          return await Promise.race([
            promiseOrValue,
            new Promise<never>((_, reject) => {
              const abort = () => reject(new Error('preflight-interrupted'));
              controller.signal.addEventListener('abort', abort, { once: true });
              cleanup = () => controller.signal.removeEventListener('abort', abort);
            }),
          ]);
        } finally {
          cleanup?.();
        }
      };

      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
      try {
        if (options.authToken) {
          const token = await racePreflight(typeof options.authToken === 'function' ? options.authToken() : options.authToken);
          if (token) headers.authorization = `Bearer ${token}`;
        }
        if (options.headers) {
          const extra = await racePreflight(typeof options.headers === 'function' ? options.headers() : options.headers);
          if (extra) Object.assign(headers, extra);
        }
      } catch {
        return preflightFail(controller.signal.aborted || callOptions?.signal?.aborted ? (timedOut ? 'TIMEOUT' : 'CANCELLED') : 'MESH_UNAVAILABLE');
      }
      if (controller.signal.aborted || callOptions?.signal?.aborted) return preflightFail(timedOut ? 'TIMEOUT' : 'CANCELLED');

      const fail = (code: ConnectionErrorCode): JudgeConnectionFailure => ({
        kind: 'connection-failure', ok: false, error: connectionError(code, 'dispatch'),
        receipt: null, usage: unreportedJudgeUsage('unknown'), callStatus: 'unknown', correlationId,
      });

      let response: Response;
      try {
        response = await fetchFn(endpoint, {
          method: 'POST', redirect: 'manual', headers, body: JSON.stringify({ ...request, correlationId }), signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
        return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
      }

      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
        void response.body?.cancel().catch(() => {});
        return fail('MESH_UNAVAILABLE');
      }

      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)) {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
        void response.body?.cancel().catch(() => {});
        return fail('MESH_UNAVAILABLE');
      }
      const buffer = new Uint8Array(Math.min(cap, 65_536));
      let size = 0;
      let chunks: Uint8Array = buffer;
      try {
        reader = response.body?.getReader();
        if (reader) {
          for (;;) {
            const chunk = await reader.read();
            if (timedOut || controller.signal.aborted || callOptions?.signal?.aborted) {
              return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
            }
            if (chunk.done) break;
            if (size + chunk.value.byteLength > cap) {
              await reader.cancel().catch(() => {});
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
      } finally {
        try { reader?.releaseLock(); } catch {}
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
      }

      if (timedOut || controller.signal.aborted || callOptions?.signal?.aborted) {
        return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
      }

      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks.subarray(0, size))); }
      catch { return fail('MESH_UNAVAILABLE'); }
      const snapshot = snapshotBoundedJson(parsed, cap);
      if (!snapshot.ok || !isRecord(snapshot.value)) return fail('MESH_UNAVAILABLE');
      const val = snapshot.value;
      if (val.kind === 'verdict' && val.ok === true && isValidJudgeVerdict(val.verdict)
        && isValidJudgeReceipt(val.receipt, correlationId) && val.receipt.outcome === 'verdict') {
        return val as unknown as JudgeResult;
      }
      if (val.kind === 'error' && val.ok === false && isRecord(val.error)
        && isValidJudgeReceipt(val.receipt, correlationId) && val.receipt.outcome === 'error'
        && val.error.code === val.receipt.errorCode) {
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
