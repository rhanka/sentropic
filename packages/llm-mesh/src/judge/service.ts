import type { ProviderAdapter, ProviderRegistry } from '../registry.js';
import type { EvaluatorRef, JudgeRequest } from './request.js';
import { parseJudgeRequest } from './request.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import type { JudgeErrorCode } from './errors.js';
import { freezeJudgeData, parseEvaluatorDescriptor } from './descriptor-validation.js';
import { validateJevPolicy } from './policy.js';
import type { JudgeHostPolicy } from './policy.js';
import { isRecord, snapshotBoundedJson } from './validation.js';
import type { AuthResolution, AuthResolver } from '../auth.js';
import type { JudgeClient } from './receipt.js';
import type { JudgeServiceOptions } from './host-options.js';
import { beginJudgeExecution, judgeInterruption, persistJudgeResult } from './execution.js';
import { createJudgeError } from './errors.js';
import { admitJudge } from './admission.js';
import { dispatchJudge } from './dispatch.js';
import { hasOnlyKeys } from './validation.js';
import { isMicroUsd } from './pricing.js';
import { runWithJudgeDeadline } from './deadline.js';

export interface JudgeSelectionOptions {
  registry: ProviderRegistry;
  resolveEvaluator(ref: EvaluatorRef): EvaluatorDescriptor | null | Promise<EvaluatorDescriptor | null>;
  policy?: JudgeHostPolicy;
}
export type JudgeSelection = { ok: true; request: JudgeRequest; descriptor: EvaluatorDescriptor; adapter: ProviderAdapter }
  | { ok: false; code: JudgeErrorCode };

/** The significant-input snapshot stays service-owned through every asynchronous phase. */
export async function preflightJudgeRequest(candidate: unknown, options: JudgeSelectionOptions): Promise<JudgeSelection> {
  const parsed = parseJudgeRequest(candidate);
  if (!parsed.ok) return parsed;
  const request = freezeJudgeData(parsed.request);
  try {
    const adapter = options.registry.getProvider(request.evaluator.providerId);
    if (!adapter || adapter.provider.providerId !== request.evaluator.providerId) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    if (!adapter.judge || !adapter.listEvaluators) return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
    const inventory = snapshotBoundedJson(adapter.listEvaluators());
    if (!inventory.ok || !Array.isArray(inventory.value)) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    const refs = inventory.value.filter((ref) => isRecord(ref) && ref.providerId === request.evaluator.providerId
      && ref.evaluatorId === request.evaluator.evaluatorId);
    if (!refs.length) return { ok: false, code: 'EVALUATOR_UNKNOWN' };
    if (!refs.some((ref) => ref.revision === request.evaluator.revision)) return { ok: false, code: 'REVISION_MISMATCH' };
    const descriptor = parseEvaluatorDescriptor(await options.resolveEvaluator({ ...request.evaluator }));
    if (!descriptor || descriptor.evaluator.providerId !== request.evaluator.providerId
      || descriptor.evaluator.evaluatorId !== request.evaluator.evaluatorId
      || descriptor.evaluator.revision !== request.evaluator.revision) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
    if ('descriptor' in adapter && adapter.descriptor !== undefined) {
      const adapterDescriptor = parseEvaluatorDescriptor(adapter.descriptor);
      if (!adapterDescriptor
        || adapterDescriptor.wireModel !== descriptor.wireModel
        || adapterDescriptor.qualification.servedIdentity !== descriptor.qualification.servedIdentity) {
        return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
      }
    }
    const code = validateJevPolicy(request, descriptor, options.policy);
    return code ? { ok: false, code } : { ok: true, request, descriptor, adapter };
  } catch { return { ok: false, code: 'PROVIDER_UNAVAILABLE' }; }
}

export type JudgeAuthResolution = { ok: true; auth: AuthResolution } | { ok: false; code: 'CREDENTIAL_MISSING' };
/** Host custody only: no request credential, caller-selected owner or key fallback. */
export async function resolveJudgeAuth(descriptor: EvaluatorDescriptor, resolver: AuthResolver): Promise<JudgeAuthResolution> {
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
    return { ok: true, auth: freezeJudgeData(snapshot.value as unknown as AuthResolution) };
  } catch { return { ok: false, code: 'CREDENTIAL_MISSING' }; }
}

/** Trusted composition only. Construction performs no discovery, key resolution or I/O. */
export function createJudgeService(supplied: JudgeServiceOptions): JudgeClient {
  const policy = snapshotBoundedJson(supplied.policy ?? {});
  if (!supplied.registry || ![supplied.resolveEvaluator, supplied.resolveAuth, supplied.resolvePrice, supplied.authorize,
    supplied.budget?.admit, supplied.budget?.markDispatched, supplied.budget?.release, supplied.budget?.settle,
    supplied.receipts?.persist].every((port) => typeof port === 'function') || !policy.ok || !isRecord(policy.value)
    || !hasOnlyKeys(policy.value, ['timeoutMs', 'maxCostMicroUsd', 'allowRaw'])
    || (policy.value.timeoutMs !== undefined && (!Number.isSafeInteger(policy.value.timeoutMs)
      || typeof policy.value.timeoutMs !== 'number' || policy.value.timeoutMs < 1 || policy.value.timeoutMs > 60000))
    || (policy.value.maxCostMicroUsd !== undefined && !isMicroUsd(policy.value.maxCostMicroUsd))
    || (policy.value.allowRaw !== undefined && typeof policy.value.allowRaw !== 'boolean')) throw new Error('Invalid judge host configuration.');
  const options = { ...supplied, policy: freezeJudgeData(policy.value as JudgeHostPolicy) };
  return { async judge(candidate, callOptions) {
    const execution = beginJudgeExecution(candidate, { clock: options.clock, generateId: options.generateId,
      timeoutMs: options.policy.timeoutMs, signal: callOptions?.signal });
    return runWithJudgeDeadline(execution, async () => {
      if (execution.idError) return persistJudgeResult(execution, options.receipts, createJudgeError('MESH_UNAVAILABLE', 'preflight'));
      const interrupted = judgeInterruption(execution, 'preflight');
      if (interrupted) return persistJudgeResult(execution, options.receipts, interrupted);
      const selection = await preflightJudgeRequest(candidate, options);
      if (!selection.ok) return persistJudgeResult(execution, options.receipts, createJudgeError(selection.code, 'preflight'));
      execution.receipt.evaluator = { ...selection.descriptor.evaluator };
      execution.receipt.retention = structuredClone(selection.descriptor.retention);
      const admitted = await admitJudge(execution, selection, options);
      if (!admitted.ok) return persistJudgeResult(execution, options.receipts, admitted.error);
      return dispatchJudge(execution, selection, admitted, options);
    });
  } };
}
