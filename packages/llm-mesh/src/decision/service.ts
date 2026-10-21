import type { ProviderAdapter, ProviderRegistry } from '../registry.js';
import type { EvaluatorRef, DecisionRequest } from './request.js';
import { parseDecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionErrorCode } from './errors.js';
import { freezeDecisionData, parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { validateDecisionPolicy } from './policy.js';
import type { DecisionHostPolicy } from './policy.js';
import { isRecord, snapshotBoundedJson } from './validation.js';
import type { AuthResolution, AuthResolver } from '../auth.js';
import type { DecisionClient } from './receipt.js';
import type { DecisionServiceOptions } from './host-options.js';
import { beginDecisionExecution, decisionInterruption, persistDecisionResult } from './execution.js';
import { createDecisionError } from './errors.js';
import { admitDecision } from './admission.js';
import { dispatchDecision } from './dispatch.js';
import { hasOnlyKeys } from './validation.js';
import { isMicroUsd } from './pricing.js';
import { runWithDecisionDeadline } from './deadline.js';

export interface DecisionSelectionOptions {
  registry: ProviderRegistry;
  resolveEvaluator(ref: EvaluatorRef): DecisionEvaluatorDescriptor | null | Promise<DecisionEvaluatorDescriptor | null>;
  policy?: DecisionHostPolicy;
  /** Explicit evaluator allowlist (P28): when present, only exactly listed
   * evaluator references are admitted. Absent, the registry inventory decides. */
  evaluatorAllowlist?: readonly EvaluatorRef[];
}
export type DecisionSelection = { ok: true; request: DecisionRequest; descriptor: DecisionEvaluatorDescriptor; adapter: ProviderAdapter }
  | { ok: false; code: DecisionErrorCode };

/** Order-insensitive snapshot comparison for descriptor records. */
function canonicalDecisionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDecisionJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalDecisionJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** An allowlist entry admits one exact evaluator reference; nothing else matches. */
const allowlistsEvaluator = (allowlist: readonly unknown[] | undefined, ref: EvaluatorRef): boolean =>
  allowlist !== undefined && allowlist.some((entry) => isRecord(entry)
    && entry.providerId === ref.providerId && entry.evaluatorId === ref.evaluatorId && entry.revision === ref.revision);

/** Preflight binds one authoritative descriptor: any request-affecting disagreement refuses before credentials or spend. */
function sameDecisionDescriptor(left: DecisionEvaluatorDescriptor, right: DecisionEvaluatorDescriptor): boolean {
  const text = (values: readonly string[]) => canonicalDecisionJson([...values].sort());
  if (left.evaluator.providerId !== right.evaluator.providerId || left.evaluator.evaluatorId !== right.evaluator.evaluatorId
    || left.evaluator.revision !== right.evaluator.revision || left.wireModel !== right.wireModel
    || text(left.acceptedServedModelIds) !== text(right.acceptedServedModelIds)
    || left.qualification.servedIdentity !== right.qualification.servedIdentity
    || left.qualification.billingBound !== right.qualification.billingBound
    || text(left.qualification.evidenceRefs) !== text(right.qualification.evidenceRefs)
    || left.maxBillableInputTokens !== right.maxBillableInputTokens || left.maxRequestBytes !== right.maxRequestBytes
    || left.maxStateQuestionBytes !== right.maxStateQuestionBytes || left.probabilityTolerance !== right.probabilityTolerance
    || left.scoreNativeKeys !== right.scoreNativeKeys || left.nativeDecision !== right.nativeDecision
    || left.confidence.meaning !== right.confidence.meaning || left.confidence.meaningRef !== right.confidence.meaningRef
    || left.confidence.min !== right.confidence.min || left.confidence.max !== right.confidence.max
    || left.compilation.templateDigest !== right.compilation.templateDigest
    || left.compilation.schemaDigest !== right.compilation.schemaDigest
    || left.compilation.readout !== right.compilation.readout
    || left.priceProtocol.authority !== right.priceProtocol.authority
    || left.priceProtocol.revision !== right.priceProtocol.revision
    || left.registeredCriteria.length !== right.registeredCriteria.length
    || left.retention.status !== right.retention.status || left.retention.basis !== right.retention.basis
    || left.retention.retentionDays !== right.retention.retentionDays || left.retention.gap !== right.retention.gap
    || text(left.retention.evidenceRefs) !== text(right.retention.evidenceRefs)) return false;
  const rightByKey = new Map(right.registeredCriteria.map((entry) => [JSON.stringify([entry.criteriaId, entry.revision]), entry]));
  return left.registeredCriteria.every((entry) => {
    const other = rightByKey.get(JSON.stringify([entry.criteriaId, entry.revision]));
    return other !== undefined && canonicalDecisionJson(entry.criterion) === canonicalDecisionJson(other.criterion);
  });
}

/** The significant-input snapshot stays service-owned through every asynchronous phase. */
export async function preflightDecisionRequest(candidate: unknown, options: DecisionSelectionOptions): Promise<DecisionSelection> {
  const parsed = parseDecisionRequest(candidate);
  if (!parsed.ok) return parsed;
  const request = freezeDecisionData(parsed.request);
  // P28: an explicit allowlist refuses before provider lookup; a general
  // catalogue entry never implies admission and no provider route is touched.
  if (options.evaluatorAllowlist !== undefined
    && !allowlistsEvaluator(options.evaluatorAllowlist, request.evaluator)) {
    return { ok: false, code: 'EVALUATOR_UNKNOWN' };
  }
  try {
    const adapter = options.registry.getProvider(request.evaluator.providerId);
    if (!adapter || adapter.provider.providerId !== request.evaluator.providerId) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    if (!adapter.decision || !adapter.listEvaluators) return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
    const inventory = snapshotBoundedJson(adapter.listEvaluators());
    if (!inventory.ok || !Array.isArray(inventory.value)) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    const refs = inventory.value.filter((ref) => isRecord(ref) && ref.providerId === request.evaluator.providerId
      && ref.evaluatorId === request.evaluator.evaluatorId);
    if (!refs.length) return { ok: false, code: 'EVALUATOR_UNKNOWN' };
    if (!refs.some((ref) => ref.revision === request.evaluator.revision)) return { ok: false, code: 'REVISION_MISMATCH' };
    const descriptor = parseDecisionEvaluatorDescriptor(await options.resolveEvaluator({ ...request.evaluator }));
    if (!descriptor || descriptor.evaluator.providerId !== request.evaluator.providerId
      || descriptor.evaluator.evaluatorId !== request.evaluator.evaluatorId
      || descriptor.evaluator.revision !== request.evaluator.revision) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    if ('descriptor' in adapter && adapter.descriptor !== undefined) {
      const adapterDescriptor = parseDecisionEvaluatorDescriptor(adapter.descriptor);
      if (!adapterDescriptor || !sameDecisionDescriptor(adapterDescriptor, descriptor)) {
        return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
      }
    }
    const code = validateDecisionPolicy(request, descriptor, options.policy);
    return code ? { ok: false, code } : { ok: true, request, descriptor, adapter };
  } catch { return { ok: false, code: 'PROVIDER_UNAVAILABLE' }; }
}

export type DecisionAuthResolution = { ok: true; auth: AuthResolution } | { ok: false; code: 'CREDENTIAL_MISSING' };
/** Host custody only: no request credential, caller-selected owner or key fallback. */
export async function resolveDecisionAuth(descriptor: DecisionEvaluatorDescriptor, resolver: AuthResolver): Promise<DecisionAuthResolution> {
  try {
    const snapshot = snapshotBoundedJson(await resolver({ providerId: descriptor.evaluator.providerId,
      modelId: descriptor.wireModel, preferredSources: ['environment-token'] }));
    if (!snapshot.ok || !isRecord(snapshot.value) || !isRecord(snapshot.value.material) || !isRecord(snapshot.value.descriptor)) {
      return { ok: false, code: 'CREDENTIAL_MISSING' };
    }
    const { material, descriptor: authDescriptor } = snapshot.value;
    if (material.type !== 'environment-token' || material.envVar !== 'JEV_API_KEY'
      || authDescriptor.sourceType !== 'environment-token' || typeof material.token !== 'string'
      || !material.token.trim() || material.token !== material.token.trim() || /[\r\n]/.test(material.token)) {
      return { ok: false, code: 'CREDENTIAL_MISSING' };
    }
    return { ok: true, auth: freezeDecisionData(snapshot.value as unknown as AuthResolution) };
  } catch { return { ok: false, code: 'CREDENTIAL_MISSING' }; }
}

/** An explicit allowlist holds only exact, well-shaped evaluator references. */
const isEvaluatorAllowlist = (value: unknown): value is readonly EvaluatorRef[] =>
  Array.isArray(value) && value.every((entry) => isRecord(entry)
    && hasOnlyKeys(entry, ['providerId', 'evaluatorId', 'revision'])
    && typeof entry.providerId === 'string' && entry.providerId !== ''
    && typeof entry.evaluatorId === 'string' && entry.evaluatorId !== ''
    && typeof entry.revision === 'string' && entry.revision !== '');

/** Trusted composition only. Construction performs no discovery, key resolution or I/O. */
export function createDecisionService(supplied: DecisionServiceOptions): DecisionClient {
  const policy = snapshotBoundedJson(supplied.policy ?? {});
  if (!supplied.registry || ![supplied.resolveEvaluator, supplied.resolveAuth, supplied.resolvePrice, supplied.authorize,
    supplied.budget?.admit, supplied.budget?.markDispatched, supplied.budget?.release, supplied.budget?.settle,
    supplied.receipts?.persist].every((port) => typeof port === 'function')
    || (supplied.evaluatorAllowlist !== undefined && !isEvaluatorAllowlist(supplied.evaluatorAllowlist))
    || !policy.ok || !isRecord(policy.value)
    || !hasOnlyKeys(policy.value, ['timeoutMs', 'maxCostMicroUsd', 'allowRaw'])
    || (policy.value.timeoutMs !== undefined && (!Number.isSafeInteger(policy.value.timeoutMs)
      || typeof policy.value.timeoutMs !== 'number' || policy.value.timeoutMs < 1 || policy.value.timeoutMs > 60000))
    || (policy.value.maxCostMicroUsd !== undefined && !isMicroUsd(policy.value.maxCostMicroUsd))
    || (policy.value.allowRaw !== undefined && typeof policy.value.allowRaw !== 'boolean')) throw new Error('Invalid decision host configuration.');
  const options = { ...supplied, policy: freezeDecisionData(policy.value as DecisionHostPolicy),
    ...(supplied.evaluatorAllowlist === undefined ? {}
      : { evaluatorAllowlist: freezeDecisionData(supplied.evaluatorAllowlist.map((entry) => ({ ...entry }))) }) };
  return { async decide(candidate, callOptions) {
    const execution = beginDecisionExecution(candidate, { clock: options.clock, generateId: options.generateId,
      timeoutMs: options.policy.timeoutMs, signal: callOptions?.signal });
    return runWithDecisionDeadline(execution, async () => {
      if (execution.idError) return persistDecisionResult(execution, options.receipts, createDecisionError('MESH_UNAVAILABLE', 'preflight'));
      const interrupted = decisionInterruption(execution, 'preflight');
      if (interrupted) return persistDecisionResult(execution, options.receipts, interrupted);
      const selection = await preflightDecisionRequest(candidate, options);
      if (!selection.ok) return persistDecisionResult(execution, options.receipts, createDecisionError(selection.code, 'preflight'));
      execution.receipt.evaluator = { ...selection.descriptor.evaluator };
      execution.receipt.retention = structuredClone(selection.descriptor.retention);
      const admitted = await admitDecision(execution, selection, options);
      if (!admitted.ok) return persistDecisionResult(execution, options.receipts, admitted.error);
      return dispatchDecision(execution, selection, admitted, options);
    });
  } };
}
