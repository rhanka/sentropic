import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionRequest, DecisionRule, EvaluatorRef } from './request.js';
import { parseDecisionRequest } from './request.js';
import { digestStructuredArtifact, hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';
import { freezeDecisionData } from './descriptor-validation.js';

export interface DecisionOperatingPolicy {
  revision: string; language: string; domain: string; intendedUse: string; maxInputBytes: number;
  decision: DecisionRule | null;
}
export interface DecisionQualificationScope {
  executionDigest: string; evaluator: EvaluatorRef; criterionDigest: string;
  criterionKind: 'binary' | 'graded' | 'choice'; policyDigest: string;
}

/** Evidence and publication profile can evolve without changing assessed execution. */
export function decisionExecutionDigest(descriptor: DecisionEvaluatorDescriptor): string {
  const { qualification, executionProfile, definition, ...execution } = descriptor;
  const { bundleDigest, ...validation } = definition;
  return digestStructuredArtifact({ ...execution, definition: validation });
}

/** Exact registered identity AND resolved rubric, or exact arbitrary instructions. */
export function decisionQualificationScope(descriptor: DecisionEvaluatorDescriptor, candidate: DecisionRequest,
  candidatePolicy: DecisionOperatingPolicy): DecisionQualificationScope | null {
  const parsed = parseDecisionRequest(candidate);
  const snapshot = snapshotBoundedJson(candidatePolicy);
  if (!parsed.ok || !snapshot.ok || !isRecord(snapshot.value)) return null;
  const request = parsed.request;
  const policy = snapshot.value;
  if (!hasOnlyKeys(policy, ['revision', 'language', 'domain', 'intendedUse', 'maxInputBytes', 'decision'])
    || ![policy.revision, policy.language, policy.domain, policy.intendedUse].every(isText)
    || typeof policy.maxInputBytes !== 'number' || !Number.isSafeInteger(policy.maxInputBytes)
    || policy.maxInputBytes < 1 || policy.maxInputBytes > descriptor.maxRequestBytes
    || new TextEncoder().encode(JSON.stringify(request.inputs)).length > policy.maxInputBytes
    || digestStructuredArtifact(policy.decision) !== digestStructuredArtifact(request.decision ?? null)
    || digestStructuredArtifact(request.evaluator) !== digestStructuredArtifact(descriptor.evaluator)) return null;
  const resolved = request.criterion.kind === 'registered'
    ? descriptor.registeredCriteria.find((entry) => request.criterion.kind === 'registered'
      && entry.criteriaId === request.criterion.criteriaId && entry.revision === request.criterion.revision)?.criterion
    : request.criterion;
  if (!resolved) return null;
  return freezeDecisionData({ executionDigest: decisionExecutionDigest(descriptor), evaluator: { ...descriptor.evaluator },
    criterionDigest: digestStructuredArtifact({ requested: request.criterion, resolved }),
    criterionKind: resolved.kind, policyDigest: digestStructuredArtifact(policy) });
}
