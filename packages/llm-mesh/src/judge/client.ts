import { parseJudgeRequest, type JudgeRequest } from './request.js';
import type { JudgeConnectionFailure, JudgeReceipt, JudgeResult, RemoteJudgeClient } from './receipt.js';
import { parseJudgeUsage, resolveJudgeCorrelationId, unreportedJudgeUsage } from './receipt.js';
import type { JudgeError } from './errors.js';
import { createJudgeError, isJudgeErrorCode } from './errors.js';
import { isJudgeDecisionRule } from './criterion.js';
import type { JudgeCost } from './receipt.js';
import { parseJudgeConfidence, parseJudgeScore } from './verdict.js';
import type { JudgeVerdict } from './verdict.js';
import { JUDGE_MAX_JSON_BYTES, has, hasOnlyKeys, isMicroUsd, isRecord, snapshotBoundedJson } from './validation.js';

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

const DECISION_ORIGINS = new Set(['provider-threshold', 'provider-choice', 'provider-capped', 'client-clamp']);
const DISPATCH_STATES = new Set(['not-started', 'started', 'completed', 'unknown']);
const RAW_FIELDS = ['noul', 'score', 'choice', 'probabilities', 'confidence'] as const;

/** Cost union invariant: an unincurred or estimated cost never carries a spent amount. */
function isValidWireCost(cost: unknown): cost is JudgeCost {
  if (!isRecord(cost)) return false;
  if (cost.status === 'actual') {
    return hasOnlyKeys(cost, ['status', 'amountMicroUsd', 'source', 'priceRevision', 'rounding'])
      && isMicroUsd(cost.amountMicroUsd) && cost.source === 'provider' && cost.rounding === 'ceil-micro-usd'
      && (cost.priceRevision === undefined || typeof cost.priceRevision === 'string');
  }
  if (cost.status === 'estimated') {
    return hasOnlyKeys(cost, ['status', 'amountMicroUsd', 'source', 'priceRevision', 'rounding'])
      && isMicroUsd(cost.amountMicroUsd) && cost.rounding === 'ceil-micro-usd'
      && typeof cost.priceRevision === 'string'
      && (cost.source === 'reported-usage-times-rate' || cost.source === 'call-rate' || cost.source === 'reserved-liability');
  }
  return cost.status === 'not-incurred' && hasOnlyKeys(cost, ['status', 'amountMicroUsd', 'source'])
    && cost.amountMicroUsd === '0' && cost.source === 'no-dispatch';
}

function isValidWireRetention(retention: unknown): boolean {
  if (!isRecord(retention)) return false;
  if (retention.status !== 'non-zdr' && retention.status !== 'unknown' && retention.status !== 'not-evaluated') return false;
  if (retention.basis !== 'published-policy' && retention.basis !== 'none') return false;
  if (!Array.isArray(retention.evidenceRefs) || !retention.evidenceRefs.every((ref) => typeof ref === 'string')) return false;
  if (retention.retentionDays !== null && (typeof retention.retentionDays !== 'number'
    || !Number.isSafeInteger(retention.retentionDays) || retention.retentionDays < 0)) return false;
  return retention.gap === undefined || retention.gap === 'unknown (source-gap)';
}

function isValidJudgeReceipt(r: unknown, request: JudgeRequest, expectedCorrelationId: string): r is JudgeReceipt {
  if (!isRecord(r)) return false;
  if (r.schemaVersion !== 1 || typeof r.callId !== 'string' || !r.callId) return false;
  if (r.correlationId !== expectedCorrelationId) return false;
  if (r.evaluator !== null) {
    if (!isRecord(r.evaluator) || r.evaluator.providerId !== request.evaluator.providerId
      || r.evaluator.evaluatorId !== request.evaluator.evaluatorId
      || r.evaluator.revision !== request.evaluator.revision) return false;
  }
  if (r.servedEvaluator !== null && (!isRecord(r.servedEvaluator) || typeof r.servedEvaluator.providerId !== 'string'
    || typeof r.servedEvaluator.evaluatorId !== 'string' || typeof r.servedEvaluator.revision !== 'string')) return false;
  if (typeof r.startedAt !== 'string' || Number.isNaN(Date.parse(r.startedAt))) return false;
  if (typeof r.finishedAt !== 'string' || Number.isNaN(Date.parse(r.finishedAt))) return false;
  if (typeof r.latencyMs !== 'number' || !Number.isFinite(r.latencyMs) || r.latencyMs < 0) return false;
  if (!DISPATCH_STATES.has(r.dispatch as string)) return false;
  if (r.attempts !== 0 && r.attempts !== 1) return false;
  if (!isValidWireRetention(r.retention)) return false;
  if (!isRecord(r.budget) || !BUDGET_STATES.has(r.budget.state as string) || typeof r.budget.overrun !== 'boolean'
    || (r.budget.reservedMicroUsd !== undefined && !isMicroUsd(r.budget.reservedMicroUsd))) return false;
  if (!isValidWireCost(r.cost)) return false;
  if (r.outcome !== 'verdict' && r.outcome !== 'error') return false;
  if (r.outcome === 'error' && (typeof r.errorCode !== 'string' || !r.errorCode)) return false;
  if (r.outcome === 'verdict' && r.errorCode !== undefined) return false;
  return parseJudgeUsage(r.usage) !== null;
}

const wireDistributionEntries = (distribution: unknown): { outcome: string; probability: number }[] | null => {
  if (!Array.isArray(distribution) || !distribution.length) return null;
  const entries: { outcome: string; probability: number }[] = [];
  for (const entry of distribution) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['outcome', 'nativeOutcome', 'probability'])
      || typeof entry.outcome !== 'string' || typeof entry.nativeOutcome !== 'string'
      || typeof entry.probability !== 'number' || !Number.isFinite(entry.probability)
      || entry.probability < 0 || entry.probability > 1) return null;
    entries.push({ outcome: entry.outcome, probability: entry.probability });
  }
  if (Math.abs(entries.reduce((sum, entry) => sum + entry.probability, 0) - 1) > 1e-4) return null;
  return entries;
};

/** Distribution and label concordance: binary carries neither, choice binds both to the declared labels. */
function isValidWireDistribution(distribution: unknown, label: unknown, request: JudgeRequest): boolean {
  if (request.criterion.kind === 'binary') return distribution === null && label === null;
  if (request.criterion.kind === 'choice') {
    const declared = request.criterion.options.map((option) => option.id);
    const entries = wireDistributionEntries(distribution);
    if (!entries || entries.length !== declared.length) return false;
    const seen = new Set(entries.map((entry) => entry.outcome));
    if (seen.size !== entries.length || !declared.every((id) => seen.has(id))) return false;
    return isRecord(label) && hasOnlyKeys(label, ['value', 'origin'])
      && typeof label.value === 'string' && seen.has(label.value) && label.origin === 'provider';
  }
  if (distribution !== null && !wireDistributionEntries(distribution)) return false;
  return label === null || (isRecord(label) && hasOnlyKeys(label, ['value', 'origin'])
    && typeof label.value === 'string' && label.origin === 'provider');
}

/** Raw evidence is accepted only when allowlisted by the request, allowlisted by field, and byte-exact. */
function isValidWireProviderRaw(raw: unknown, request: JudgeRequest): boolean {
  if (raw === undefined) return true;
  if (!isRecord(raw) || request.raw?.mode !== 'allowlisted') return false;
  if (!hasOnlyKeys(raw, ['data', 'bytes', 'truncated']) || !isRecord(raw.data)
    || !Object.keys(raw.data).every((key) => (RAW_FIELDS as readonly string[]).includes(key))) return false;
  if (typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0) return false;
  if (typeof raw.truncated !== 'boolean') return false;
  const actual = new TextEncoder().encode(JSON.stringify(raw.data)).byteLength;
  return raw.bytes === actual && raw.bytes <= Math.min(16384, request.raw.maxBytes ?? 16384);
}

function isValidJudgeVerdict(v: unknown, request: JudgeRequest): v is JudgeVerdict {
  if (!isRecord(v)) return false;
  if (v.criterionKind !== request.criterion.kind) return false;
  if (!['binary', 'graded', 'choice'].includes(v.resolvedCriterionKind as string)) return false;
  if (!isRecord(v.decision) || typeof v.decision.pass !== 'boolean' || !DECISION_ORIGINS.has(v.decision.origin as string)
    || (v.decision.rule !== undefined && !isJudgeDecisionRule(v.decision.rule))) return false;
  if (request.criterion.kind === 'binary' && (v.score === null || parseJudgeScore(v.score) === null)) return false;
  if (request.criterion.kind === 'choice' && (v.score !== null || parseJudgeConfidence(v.confidence) === null)) return false;
  if (v.score !== null && parseJudgeScore(v.score) === null) return false;
  if (v.confidence !== null && parseJudgeConfidence(v.confidence) === null) return false;
  if (v.rationale !== null && (!isRecord(v.rationale) || typeof v.rationale.text !== 'string'
    || v.rationale.origin !== 'provider')) return false;
  if (!isValidWireDistribution(v.distribution, v.label, request)) return false;
  return isValidWireProviderRaw(v.providerRaw, request);
}

/** Wire errors never carry wording or retry metadata: rebuild both from the code and phase. */
function rebuildWireError(error: unknown): JudgeError | null {
  if (!isRecord(error) || !isJudgeErrorCode(error.code)
    || !['preflight', 'admission', 'dispatch', 'parse', 'settlement'].includes(error.phase as string)) return null;
  return createJudgeError(error.code, error.phase as JudgeError['phase'],
    { retryAfterMs: has(error, 'retryAfterMs') && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : undefined });
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

      // Detached 256-KiB snapshot before any async resolution: later caller
      // mutation, NaN/undefined smuggling, depth and size abuse never egress.
      const outgoing = parseJudgeRequest({ ...request, correlationId });
      if (!outgoing.ok) return preflightFail('MESH_UNAVAILABLE');

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
          method: 'POST', redirect: 'manual', headers, body: JSON.stringify(outgoing.request), signal: controller.signal,
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
      if (val.kind === 'verdict' && val.ok === true
        && isValidJudgeReceipt(val.receipt, request, correlationId) && val.receipt.outcome === 'verdict'
        && isValidJudgeVerdict(val.verdict, request)) {
        return val as unknown as JudgeResult;
      }
      if (val.kind === 'error' && val.ok === false
        && isValidJudgeReceipt(val.receipt, request, correlationId) && val.receipt.outcome === 'error') {
        const error = rebuildWireError(val.error);
        if (error && (val.receipt as JudgeReceipt).errorCode === error.code) {
          return { kind: 'error', ok: false, error, receipt: val.receipt } as unknown as JudgeResult;
        }
        return fail('MESH_UNAVAILABLE');
      }
      return fail('MESH_UNAVAILABLE');
    },
  };
}
