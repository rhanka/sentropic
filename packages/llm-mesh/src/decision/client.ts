import { parseDecisionRequest, type DecisionRequest } from './request.js';
import type { DecisionConnectionFailure, DecisionReceipt, DecisionResult, RemoteDecisionClient } from './receipt.js';
import { parseDecisionUsage, resolveDecisionCorrelationId, unreportedDecisionUsage } from './receipt.js';
import type { DecisionError } from './errors.js';
import { createDecisionError, isDecisionErrorCode } from './errors.js';
import { sanitizeJevId } from './jev-response.js';
import type { DecisionCost } from './receipt.js';
import { parseDecisionConfidence, parseDecisionScore } from './verdict.js';
import type { DecisionVerdict } from './verdict.js';
import { DECISION_MAX_JSON_BYTES, has, hasOnlyKeys, isMicroUsd, isRecord, snapshotBoundedJson } from './validation.js';

export interface RemoteDecisionClientOptions {
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
  return trimmed.endsWith('/decision') ? trimmed : `${trimmed}/decision`;
};

type ConnectionErrorCode = 'MESH_UNAVAILABLE' | 'TRANSPORT_FAILED' | 'TIMEOUT' | 'CANCELLED';
const connectionError = (code: ConnectionErrorCode, phase: 'preflight' | 'dispatch') =>
  createDecisionError(code, phase) as DecisionError & { code: ConnectionErrorCode };

const BUDGET_STATES = new Set(['not-admitted', 'released', 'settled', 'pending-reconciliation']);

const DISPATCH_STATES = new Set(['not-started', 'started', 'completed', 'unknown']);

/** Only the three service-emitted value shapes: binary scores alone, choice
 * labels with a distribution, graded scores with one. Anything else never
 * leaves the service, so the client rejects it without consulting the wire. */
const hasServiceVerdictShape = (score: unknown, label: unknown, confidence: unknown, distribution: unknown): boolean => {
  const hasScore = score !== null, hasLabel = label !== null;
  const hasConfidence = confidence !== null, hasDistribution = distribution !== null;
  if (hasLabel) return !hasScore && hasDistribution && hasConfidence;
  if (hasDistribution) return hasScore && hasConfidence;
  return hasScore && !hasConfidence;
};

/** Raw native values must agree with the typed verdict derived with them:
 * same values under the same fields, and a truncation flag that matches
 * exactly which native fields were omitted. */
const wireRawAgreesWithTyped = (data: Record<string, unknown>, verdict: {
  score: unknown; label: unknown; confidence: unknown; distribution: unknown }, truncated: boolean): boolean => {
  const score = isRecord(verdict.score) && typeof verdict.score.value === 'number' ? verdict.score.value : null;
  const label = isRecord(verdict.label) && typeof verdict.label.value === 'string' ? verdict.label.value : null;
  const confidence = isRecord(verdict.confidence) && typeof verdict.confidence.value === 'number'
    ? verdict.confidence.value : null;
  const distribution = Array.isArray(verdict.distribution) ? verdict.distribution : null;
  const expected = distribution === null ? ['noul']
    : label !== null ? ['choice', 'probabilities', 'confidence'] : ['score', 'probabilities', 'confidence'];
  if (!Object.keys(data).every((key) => expected.includes(key))) return false;
  if (has(data, 'noul') && data.noul !== score) return false;
  if (has(data, 'score') && data.score !== score) return false;
  if (has(data, 'choice') && data.choice !== label) return false;
  if (has(data, 'confidence') && data.confidence !== confidence) return false;
  if (has(data, 'probabilities')) {
    const probs = data.probabilities;
    if (!isRecord(probs) || !distribution) return false;
    if (Object.keys(probs).length !== distribution.length) return false;
    for (const entry of distribution) {
      if (!isRecord(entry) || typeof entry.nativeOutcome !== 'string' || typeof entry.probability !== 'number'
        || !has(probs, entry.nativeOutcome) || probs[entry.nativeOutcome] !== entry.probability) return false;
    }
  }
  return truncated === expected.some((key) => !has(data, key));
};

/** Cost union invariant: an unincurred or estimated cost never carries a spent amount. */
function isValidWireCost(cost: unknown): cost is DecisionCost {
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
  if (!hasOnlyKeys(retention, ['status', 'basis', 'evidenceRefs', 'retentionDays', 'gap'])) return false;
  if (retention.status !== 'non-zdr' && retention.status !== 'unknown' && retention.status !== 'not-evaluated') return false;
  if (retention.basis !== 'published-policy' && retention.basis !== 'none') return false;
  if (!Array.isArray(retention.evidenceRefs) || !retention.evidenceRefs.every((ref) => typeof ref === 'string')) return false;
  if (retention.retentionDays !== null && (typeof retention.retentionDays !== 'number'
    || !Number.isSafeInteger(retention.retentionDays) || retention.retentionDays < 0)) return false;
  return retention.gap === undefined || retention.gap === 'unknown (source-gap)';
}

const EVALUATOR_KEYS = ['providerId', 'evaluatorId', 'revision'] as const;

const bindsEvaluator = (candidate: unknown, request: DecisionRequest): boolean =>
  isRecord(candidate) && hasOnlyKeys(candidate, EVALUATOR_KEYS)
  && candidate.providerId === request.evaluator.providerId
  && candidate.evaluatorId === request.evaluator.evaluatorId
  && candidate.revision === request.evaluator.revision;

const RECEIPT_KEYS = ['schemaVersion', 'callId', 'correlationId', 'evaluator', 'servedEvaluator',
  'servedModelId', 'providerRequestId', 'startedAt', 'finishedAt', 'latencyMs', 'providerLatencyMs',
  'dispatch', 'attempts', 'usage', 'cost', 'retention', 'budget', 'outcome', 'errorCode'] as const;

function isValidDecisionReceipt(r: unknown, request: DecisionRequest, expectedCorrelationId: string): r is DecisionReceipt {
  if (!isRecord(r)) return false;
  if (!hasOnlyKeys(r, RECEIPT_KEYS)) return false;
  if (r.schemaVersion !== 1 || typeof r.callId !== 'string' || !r.callId) return false;
  if (r.correlationId !== expectedCorrelationId) return false;
  if (r.evaluator !== null && !bindsEvaluator(r.evaluator, request)) return false;
  if (r.servedEvaluator !== null && (!isRecord(r.servedEvaluator)
    || !hasOnlyKeys(r.servedEvaluator, ['providerId', 'evaluatorId', 'revision'])
    || typeof r.servedEvaluator.providerId !== 'string' || typeof r.servedEvaluator.evaluatorId !== 'string'
    || typeof r.servedEvaluator.revision !== 'string')) return false;
  if (r.servedModelId !== null && sanitizeJevId(r.servedModelId) !== r.servedModelId) return false;
  if (has(r, 'providerRequestId') && sanitizeJevId(r.providerRequestId) !== r.providerRequestId) return false;
  if (has(r, 'providerLatencyMs') && (typeof r.providerLatencyMs !== 'number'
    || !Number.isFinite(r.providerLatencyMs) || r.providerLatencyMs < 0)) return false;
  if (typeof r.startedAt !== 'string' || Number.isNaN(Date.parse(r.startedAt))) return false;
  if (typeof r.finishedAt !== 'string' || Number.isNaN(Date.parse(r.finishedAt))) return false;
  if (typeof r.latencyMs !== 'number' || !Number.isFinite(r.latencyMs) || r.latencyMs < 0) return false;
  if (!DISPATCH_STATES.has(r.dispatch as string)) return false;
  if (r.attempts !== 0 && r.attempts !== 1) return false;
  if (!isValidWireRetention(r.retention)) return false;
  if (!isRecord(r.budget) || !hasOnlyKeys(r.budget, ['state', 'overrun', 'reservedMicroUsd'])
    || !BUDGET_STATES.has(r.budget.state as string) || typeof r.budget.overrun !== 'boolean'
    || (r.budget.reservedMicroUsd !== undefined && !isMicroUsd(r.budget.reservedMicroUsd))) return false;
  const cost = r.cost;
  if (!isValidWireCost(cost)) return false;
  if (r.outcome !== 'verdict' && r.outcome !== 'error') return false;
  if (r.outcome === 'error' && (typeof r.errorCode !== 'string' || !r.errorCode)) return false;
  if (r.outcome === 'verdict' && r.errorCode !== undefined) return false;
  const usage = parseDecisionUsage(r.usage);
  if (!usage) return false;
  // A verdict proves dispatch: identities served, one attempt completed,
  // provider counters reported, liability estimated under a held budget.
  // V-I1: a successful receipt names exactly the transmitted evaluator.
  if (r.outcome === 'verdict') {
    if (r.evaluator === null || r.servedEvaluator === null || r.servedModelId === null) return false;
    if (!bindsEvaluator(r.servedEvaluator, request)) return false;
    if (r.attempts !== 1 || r.dispatch !== 'completed') return false;
    if (usage.tokens.input.source !== 'provider' || usage.tokens.output.source !== 'provider'
      || usage.evaluatorCalls !== 1 || usage.explanations !== 0) return false;
    if (cost.status !== 'estimated') return false;
    if (r.budget.state !== 'settled' && r.budget.state !== 'pending-reconciliation') return false;
  }
  return true;
}

type WireDistributionEntry = { outcome: string; nativeOutcome: string; probability: number };

const wireDistributionEntries = (distribution: unknown): WireDistributionEntry[] | null => {
  if (!Array.isArray(distribution) || !distribution.length) return null;
  const entries: WireDistributionEntry[] = [];
  for (const entry of distribution) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['outcome', 'nativeOutcome', 'probability'])
      || typeof entry.outcome !== 'string' || typeof entry.nativeOutcome !== 'string'
      || typeof entry.probability !== 'number' || !Number.isFinite(entry.probability)
      || entry.probability < 0 || entry.probability > 1) return null;
    entries.push({ outcome: entry.outcome, nativeOutcome: entry.nativeOutcome, probability: entry.probability });
  }
  if (Math.abs(entries.reduce((sum, entry) => sum + entry.probability, 0) - 1) > 1e-4) return null;
  return entries;
};

/** V4-L1 JEV evidence binding: exact native index/label mapping, order-independent, no invention. */
function isValidChoiceEvidence(distribution: unknown, label: unknown, request: DecisionRequest): boolean {
  if (request.criterion.kind !== 'choice') return false;
  const declared = request.criterion.options.map((option) => option.id);
  const entries = wireDistributionEntries(distribution);
  if (!entries || entries.length !== declared.length) return false;
  const declaredSet = new Set(declared);
  const outcomeSet = new Set<string>();
  const nativeSet = new Set<string>();
  for (const entry of entries) {
    if (entry.outcome !== entry.nativeOutcome) return false;
    if (!declaredSet.has(entry.outcome) || !declaredSet.has(entry.nativeOutcome)) return false;
    outcomeSet.add(entry.outcome);
    nativeSet.add(entry.nativeOutcome);
  }
  if (outcomeSet.size !== declared.length || nativeSet.size !== declared.length) return false;
  if (!isRecord(label) || !hasOnlyKeys(label, ['value', 'origin'])
    || typeof label.value !== 'string' || label.origin !== 'provider') return false;
  if (!declaredSet.has(label.value)) return false;
  const max = Math.max(...entries.map((entry) => entry.probability));
  const selected = entries.find((entry) => entry.outcome === label.value);
  return selected !== undefined && selected.probability === max;
}

function isValidGradedEvidence(distribution: unknown, score: unknown, request: DecisionRequest): boolean {
  if (request.criterion.kind !== 'graded') return false;
  const levels = request.criterion.levels;
  const entries = wireDistributionEntries(distribution);
  if (!entries || entries.length !== levels.length) return false;
  const expectedNative = new Set(levels.map((_, index) => String(index)));
  const seenNative = new Set<string>();
  const seenOutcome = new Set<string>();
  for (const entry of entries) {
    if (!expectedNative.has(entry.nativeOutcome)) return false;
    const index = Number(entry.nativeOutcome);
    if (!Number.isSafeInteger(index) || index < 0 || index >= levels.length) return false;
    if (levels[index].label !== entry.outcome) return false;
    seenNative.add(entry.nativeOutcome);
    seenOutcome.add(entry.outcome);
  }
  if (seenNative.size !== levels.length || seenOutcome.size !== levels.length) return false;
  if (score === null || !isRecord(score) || typeof score.value !== 'number') return false;
  const weighted = entries.reduce((sum, entry) => sum + Number(entry.nativeOutcome) * entry.probability, 0);
  return Math.abs(weighted - (score as { value: number }).value) <= 1e-4;
}

function sameDecisionRule(left: unknown, right: DecisionRequest['decision']): boolean {
  if (right === undefined) return false;
  if (!isRecord(left)) return false;
  if (right.kind === 'threshold') {
    return hasOnlyKeys(left, ['kind', 'field', 'op', 'value'])
      && left.kind === 'threshold' && left.field === 'score'
      && (left.op === 'gte' || left.op === 'lte')
      && left.op === right.op && left.value === right.value;
  }
  if (right.kind === 'labels') {
    if (!hasOnlyKeys(left, ['kind', 'passing']) || left.kind !== 'labels' || !Array.isArray(left.passing)) return false;
    const passing = left.passing as unknown[];
    return passing.length === right.passing.length
      && passing.every((value, index) => value === right.passing[index]);
  }
  return false;
}

/** V-D1/V-D2: exact rule echo and recomputation from native evidence. JEV has no native boolean. */
function isValidWireDecision(decision: unknown, request: DecisionRequest, evidence: { score: DecisionVerdict['score']; label: DecisionVerdict['label'] }): boolean {
  if (request.decision === undefined) return decision === null;
  if (request.decision.kind === 'provider') return false;
  if (decision === null) return false;
  if (!isRecord(decision) || typeof decision.pass !== 'boolean' || typeof decision.origin !== 'string') return false;
  if (request.decision.kind === 'threshold') {
    if (decision.origin !== 'threshold' || !hasOnlyKeys(decision, ['pass', 'origin', 'rule'])) return false;
    if (!sameDecisionRule(decision.rule, request.decision)) return false;
    if (evidence.score === null) return false;
    // V-D2: the threshold must lie within the trusted native bounded scale.
    const parsed = parseDecisionScore(evidence.score);
    if (parsed === null || parsed.scale.kind !== 'bounded') return false;
    if (request.decision.value < parsed.scale.min || request.decision.value > parsed.scale.max) return false;
    const value = parsed.value;
    const expected = request.decision.op === 'gte' ? value >= request.decision.value : value <= request.decision.value;
    return decision.pass === expected;
  }
  if (request.decision.kind === 'labels') {
    if (decision.origin !== 'labels' || !hasOnlyKeys(decision, ['pass', 'origin', 'rule'])) return false;
    if (!sameDecisionRule(decision.rule, request.decision)) return false;
    if (!isRecord(evidence.label) || typeof evidence.label.value !== 'string') return false;
    return decision.pass === request.decision.passing.includes(evidence.label.value);
  }
  return false;
}

/** Raw evidence is accepted only when allowlisted by the request, byte-exact,
 * and in full agreement with the typed verdict it was derived with. */
function isValidWireProviderRaw(raw: unknown, request: DecisionRequest, verdict: {
  score: unknown; label: unknown; confidence: unknown; distribution: unknown }): boolean {
  if (raw === undefined) return true;
  if (!isRecord(raw) || request.raw?.mode !== 'allowlisted') return false;
  if (!hasOnlyKeys(raw, ['data', 'bytes', 'truncated']) || !isRecord(raw.data)) return false;
  if (typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0) return false;
  if (typeof raw.truncated !== 'boolean') return false;
  const actual = new TextEncoder().encode(JSON.stringify(raw.data)).byteLength;
  if (raw.bytes !== actual || raw.bytes > Math.min(16384, request.raw.maxBytes ?? 16384)) return false;
  return wireRawAgreesWithTyped(raw.data, verdict, raw.truncated);
}

const VERDICT_KEYS = ['criterionKind', 'resolvedCriterionKind', 'score', 'decision', 'label',
  'rationale', 'confidence', 'distribution', 'providerRaw'] as const;

function isValidDecisionVerdict(v: unknown, request: DecisionRequest): v is DecisionVerdict {
  if (!isRecord(v)) return false;
  if (!hasOnlyKeys(v, VERDICT_KEYS)) return false;
  if (v.criterionKind !== request.criterion.kind) return false;
  // V-D3: direct criteria bind resolved kind to the transmitted kind. Registered has no
  // trusted resolution in L1 and fails closed; the explicit context arrives in L2.
  if (request.criterion.kind === 'registered') return false;
  if (v.resolvedCriterionKind !== request.criterion.kind) return false;
  // V-D1/V-D4: JEV declares no native boolean; any provider-origin decision is forged.
  if (isRecord(v.decision) && v.decision.origin === 'provider') return false;
  // V-D4: the implicit native profile declares no rationale capability and JEV
  // always emits rationale null, so any rationale is invented evidence.
  if (v.rationale !== null) return false;
  if (!hasServiceVerdictShape(v.score, v.label, v.confidence, v.distribution)) return false;
  if (request.criterion.kind === 'binary') {
    if (v.score === null || v.label !== null || v.distribution !== null || v.confidence !== null) return false;
    const score = parseDecisionScore(v.score);
    if (!score || score.meaning !== 'probability-true' || score.scale.kind !== 'bounded'
      || score.scale.min !== 0 || score.scale.max !== 1 || score.scale.direction !== 'unordered') return false;
    if (!isValidWireDecision(v.decision, request, { score, label: null })) return false;
  } else if (request.criterion.kind === 'choice') {
    if (v.score !== null || v.label === null || v.distribution === null || v.confidence === null) return false;
    const confidence = parseDecisionConfidence(v.confidence);
    if (!confidence || confidence.meaning !== 'provider-confidence' || confidence.min !== 0 || confidence.max !== 1) return false;
    if (!isValidChoiceEvidence(v.distribution, v.label, request)) return false;
    const label = isRecord(v.label) && typeof v.label.value === 'string'
      ? { value: v.label.value, origin: 'provider' as const } : null;
    if (!isValidWireDecision(v.decision, request, { score: null, label: label as DecisionVerdict['label'] })) return false;
  } else if (request.criterion.kind === 'graded') {
    if (v.score === null || v.label !== null || v.distribution === null || v.confidence === null) return false;
    const score = parseDecisionScore(v.score);
    const confidence = parseDecisionConfidence(v.confidence);
    if (!score || !confidence) return false;
    if (score.meaning !== 'rubric-grade' || score.scale.kind !== 'bounded'
      || score.scale.min !== 0 || score.scale.max !== request.criterion.levels.length - 1
      || score.scale.direction !== request.criterion.direction) return false;
    if (confidence.meaning !== 'provider-confidence' || confidence.min !== 0 || confidence.max !== 1) return false;
    if (!isValidGradedEvidence(v.distribution, score, request)) return false;
    if (!isValidWireDecision(v.decision, request, { score, label: null })) return false;
  } else {
    return false;
  }
  return isValidWireProviderRaw(v.providerRaw, request, { score: v.score, label: v.label,
    confidence: v.confidence, distribution: v.distribution });
}

/** Wire errors never carry wording: rebuild from code, phase and receipt liability evidence. */
function rebuildWireError(error: unknown, receipt: DecisionReceipt): DecisionError | null {
  if (!isRecord(error) || !hasOnlyKeys(error, ['code', 'message', 'phase', 'retryable', 'retryAfterMs'])
    || !isDecisionErrorCode(error.code)
    || !['preflight', 'admission', 'dispatch', 'parse', 'settlement'].includes(error.phase as string)) return null;
  const unresolved = receipt.budget.state !== 'not-admitted' && receipt.budget.state !== 'released';
  const nonRetryable = unresolved || error.retryable === false;
  const rebuilt = createDecisionError(error.code, error.phase as DecisionError['phase'],
    { retryAfterMs: !nonRetryable && has(error, 'retryAfterMs') && typeof error.retryAfterMs === 'number'
      ? error.retryAfterMs : undefined });
  if (nonRetryable) {
    rebuilt.retryable = false;
    delete rebuilt.retryAfterMs;
  }
  return rebuilt;
}

/** Remote decision client calling an authenticated mesh endpoint without custody of provider keys. */
export function createRemoteDecisionClient(options: RemoteDecisionClientOptions): RemoteDecisionClient {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const cap = options.maxResponseBytes ?? DECISION_MAX_JSON_BYTES;
  const endpoint = resolveEndpoint(options.baseUrl);
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());

  return {
    async decide(request: DecisionRequest, callOptions?: { signal?: AbortSignal }): Promise<DecisionResult | DecisionConnectionFailure> {
      let correlationId = 'unknown';
      try {
        const raw = request.correlationId !== undefined
          ? resolveDecisionCorrelationId(request.correlationId, generate)
          : resolveDecisionCorrelationId(generate(), () => globalThis.crypto.randomUUID());
        if (!raw) {
          return { kind: 'connection-failure', ok: false, error: connectionError('MESH_UNAVAILABLE', 'preflight'),
            receipt: null, usage: unreportedDecisionUsage('not-dispatched'), callStatus: 'not-sent', correlationId: 'unknown' };
        }
        correlationId = raw;
      } catch {
        return { kind: 'connection-failure', ok: false, error: connectionError('MESH_UNAVAILABLE', 'preflight'),
          receipt: null, usage: unreportedDecisionUsage('not-dispatched'), callStatus: 'not-sent', correlationId: 'unknown' };
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

      const preflightFail = (code: ConnectionErrorCode): DecisionConnectionFailure => {
        clearTimeout(timer);
        callOptions?.signal?.removeEventListener('abort', onAbort);
        return {
          kind: 'connection-failure', ok: false, error: connectionError(code, 'preflight'),
          receipt: null, usage: unreportedDecisionUsage('not-dispatched'), callStatus: 'not-sent', correlationId,
        };
      };
      if (callOptions?.signal?.aborted) return preflightFail('CANCELLED');

      // Detached 256-KiB snapshot before any async resolution: later caller
      // mutation, NaN/undefined smuggling, depth and size abuse never egress.
      const outgoing = parseDecisionRequest({ ...request, correlationId });
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

      const fail = (code: ConnectionErrorCode): DecisionConnectionFailure => ({
        kind: 'connection-failure', ok: false, error: connectionError(code, 'dispatch'),
        receipt: null, usage: unreportedDecisionUsage('unknown'), callStatus: 'unknown', correlationId,
      });

      // Race dispatch against deadline/cancellation: an injected fetch that
      // ignores abort still resolves to TIMEOUT/CANCELLED, and a late
      // settlement is discarded without retrying or surfacing rejections.
      let response: Response;
      let interruptDispatch = (): void => {};
      try {
        const pending = fetchFn(endpoint, {
          method: 'POST', redirect: 'manual', headers, body: JSON.stringify(outgoing.request), signal: controller.signal,
        });
        let lost = false;
        const guard = new Promise<never>((_, reject) => {
          interruptDispatch = () => { lost = true; reject(new Error('dispatch-interrupted')); };
          if (controller.signal.aborted || callOptions?.signal?.aborted) interruptDispatch();
        });
        if (!controller.signal.aborted && !callOptions?.signal?.aborted) {
          controller.signal.addEventListener('abort', interruptDispatch, { once: true });
        }
        void Promise.resolve(pending).then(
          (late) => { if (lost) void late.body?.cancel().catch(() => {}); },
          () => {},
        );
        try {
          response = await Promise.race([pending, guard]);
        } finally {
          controller.signal.removeEventListener('abort', interruptDispatch);
        }
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
            const chunk = await racePreflight(reader.read());
            if (timedOut || controller.signal.aborted || callOptions?.signal?.aborted) {
              return fail(timedOut ? 'TIMEOUT' : callOptions?.signal?.aborted ? 'CANCELLED' : 'TRANSPORT_FAILED');
            }
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
      // V-K1/V-K2: closed envelopes and field-by-field reconstruction. Undeclared
      // content can never survive, even when raw permission is allowlisted.
      const rebuildVerdict = (verdict: DecisionVerdict): DecisionVerdict => {
        const rebuilt: Record<string, unknown> = {
          criterionKind: verdict.criterionKind,
          resolvedCriterionKind: verdict.resolvedCriterionKind,
          score: structuredClone(verdict.score),
          decision: structuredClone(verdict.decision),
          label: structuredClone(verdict.label),
          rationale: structuredClone(verdict.rationale),
          confidence: structuredClone(verdict.confidence),
          distribution: structuredClone(verdict.distribution),
        };
        if (Object.hasOwn(verdict, 'providerRaw')) rebuilt.providerRaw = structuredClone(verdict.providerRaw);
        return rebuilt as unknown as DecisionVerdict;
      };
      const rebuildReceipt = (receipt: DecisionReceipt): DecisionReceipt => {
        const rebuilt: Record<string, unknown> = {
          schemaVersion: receipt.schemaVersion,
          callId: receipt.callId,
          correlationId: receipt.correlationId,
          evaluator: receipt.evaluator === null ? null : { providerId: receipt.evaluator.providerId,
            evaluatorId: receipt.evaluator.evaluatorId, revision: receipt.evaluator.revision },
          servedEvaluator: receipt.servedEvaluator === null ? null : { providerId: receipt.servedEvaluator.providerId,
            evaluatorId: receipt.servedEvaluator.evaluatorId, revision: receipt.servedEvaluator.revision },
          servedModelId: receipt.servedModelId,
          startedAt: receipt.startedAt,
          finishedAt: receipt.finishedAt,
          latencyMs: receipt.latencyMs,
          dispatch: receipt.dispatch,
          attempts: receipt.attempts,
          usage: structuredClone(receipt.usage),
          cost: structuredClone(receipt.cost),
          retention: structuredClone(receipt.retention),
          budget: structuredClone(receipt.budget),
          outcome: receipt.outcome,
        };
        if (Object.hasOwn(receipt, 'providerRequestId')) rebuilt.providerRequestId = receipt.providerRequestId;
        if (Object.hasOwn(receipt, 'providerLatencyMs')) rebuilt.providerLatencyMs = receipt.providerLatencyMs;
        if (Object.hasOwn(receipt, 'errorCode')) rebuilt.errorCode = receipt.errorCode;
        return rebuilt as unknown as DecisionReceipt;
      };
      // Concordance and permissions bind the transmitted snapshot: the live
      // request may have mutated during auth resolution or transport.
      if (isRecord(val) && hasOnlyKeys(val, ['kind', 'ok', 'verdict', 'receipt'])
        && val.kind === 'verdict' && val.ok === true
        && isValidDecisionReceipt(val.receipt, outgoing.request, correlationId) && val.receipt.outcome === 'verdict'
        && isValidDecisionVerdict(val.verdict, outgoing.request)) {
        return { kind: 'verdict', ok: true, verdict: rebuildVerdict(val.verdict), receipt: rebuildReceipt(val.receipt) };
      }
      if (isRecord(val) && hasOnlyKeys(val, ['kind', 'ok', 'error', 'receipt'])
        && val.kind === 'error' && val.ok === false
        && isValidDecisionReceipt(val.receipt, outgoing.request, correlationId) && val.receipt.outcome === 'error') {
        const error = rebuildWireError(val.error, val.receipt);
        if (error && val.receipt.errorCode === error.code) {
          return { kind: 'error', ok: false, error, receipt: rebuildReceipt(val.receipt) };
        }
        return fail('MESH_UNAVAILABLE');
      }
      return fail('MESH_UNAVAILABLE');
    },
  };
}
