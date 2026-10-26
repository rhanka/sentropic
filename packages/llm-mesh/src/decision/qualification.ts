import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionRequest } from './request.js';
import type { DecisionOperatingPolicy, DecisionQualificationScope } from './qualification-scope.js';
import { decisionQualificationScope } from './qualification-scope.js';
import { assessDecisionCalibration } from './assessment.js';
import { freezeDecisionData } from './descriptor-validation.js';
import { quoteDecision } from './pricing.js';
import { isRecord, snapshotBoundedJson } from './validation.js';

export { decisionExecutionDigest, decisionQualificationScope } from './qualification-scope.js';
export type { DecisionOperatingPolicy, DecisionQualificationScope } from './qualification-scope.js';
export interface DecisionReadinessEvidence {
  contractConformance: boolean; transportAccessible: boolean; policy: DecisionOperatingPolicy;
  assessments: readonly unknown[]; price?: unknown;
}
export interface DecisionEvaluatorDiscovery {
  evaluator: DecisionEvaluatorDescriptor['evaluator']; protocol: string;
  executionProfile: 'production' | 'qualification'; experimental: boolean;
  identityQualified: boolean; billingQualified: boolean; contractConformance: boolean;
  transportAccessible: boolean; calibrationQualified: boolean; priceQualified: boolean;
  qualifiedScopes: readonly DecisionQualificationScope[];
  productionReady?: boolean; reasons: readonly string[];
}

/** Trusted inventory and evidence projection. No provider calls, keys or universal ready flag. */
export function discoverDecisionEvaluator(descriptor: DecisionEvaluatorDescriptor,
  candidate?: DecisionReadinessEvidence, request?: DecisionRequest): DecisionEvaluatorDiscovery {
  const snapshot = snapshotBoundedJson(candidate ?? {}, 16 * 1024 * 1024);
  const evidence = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : {};
  const profile = descriptor.executionProfile ?? 'production';
  const identity = descriptor.qualification.servedIdentity === 'qualified' && descriptor.acceptedServedModelIds.length > 0;
  const billing = descriptor.qualification.billingBound === 'qualified';
  const contract = evidence.contractConformance === true;
  const transport = evidence.transportAccessible === true;
  const scope = request && isRecord(evidence.policy)
    ? decisionQualificationScope(descriptor, request, evidence.policy as unknown as DecisionOperatingPolicy) : null;
  const records = Array.isArray(evidence.assessments) ? evidence.assessments : [];
  const scopes: DecisionQualificationScope[] = [];
  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.scope)) continue;
    const recordedScope = record.scope as unknown as DecisionQualificationScope;
    if (assessDecisionCalibration(record, descriptor, recordedScope).status === 'passed') scopes.push(recordedScope);
  }
  const calibrated = scope !== null && records.some((r) => assessDecisionCalibration(r, descriptor, scope).status === 'passed');
  const priced = !!request && quoteDecision(request, descriptor, evidence.price).ok;
  const reasons: string[] = [];
  if (!identity) reasons.push('identity-unqualified');
  if (!billing) reasons.push('billing-unqualified');
  if (!contract) reasons.push('contract-unqualified');
  if (!transport) reasons.push('transport-unavailable');
  if (request && !priced) reasons.push('price-or-bound-unavailable');
  if (request && !calibrated) reasons.push('calibration-missing');
  if (profile === 'qualification') reasons.push('experimental-profile');
  return freezeDecisionData({ evaluator: { ...descriptor.evaluator }, protocol: descriptor.protocol ?? 'jev-native',
    executionProfile: profile, experimental: profile === 'qualification', identityQualified: identity, billingQualified: billing,
    contractConformance: contract, transportAccessible: transport, priceQualified: priced, calibrationQualified: calibrated,
    qualifiedScopes: scopes, reasons,
    ...(request ? { productionReady: reasons.length === 0 } : {}) });
}

/** Qualification may accept provisional IDs; empty inventory always stays fixture-only. */
export const canExecuteDecisionCandidate = (descriptor: DecisionEvaluatorDescriptor): boolean =>
  descriptor.acceptedServedModelIds.length > 0
  && (descriptor.qualification.servedIdentity === 'qualified' || descriptor.executionProfile === 'qualification');
