import type { ProviderId } from '../providers.js';
import { isProviderId } from '../providers.js';
import { isDecisionCriterion, isDecisionRule } from './criterion.js';
import { isRawPolicy, isRequestPolicy } from './request-policy.js';
import { has, hasOnlyKeys, isCorrelationId, isRecord, isText, snapshotBoundedJson } from './validation.js';

export type Json = null | boolean | number | string | readonly Json[]
  | { readonly [key: string]: Json };
/** Canonical nonnegative integer decimal micro-USD, never floating point. */
export type MicroUsd = string;

export interface EvaluatorRef {
  providerId: ProviderId;
  evaluatorId: string;
  revision: string;
}

export interface DecisionInputs {
  input?: Json;
  output?: Json;
  context?: readonly Json[];
  reference?: Json;
  state?: Json;
}

export type DecisionCriterion =
  | { kind: 'binary'; instructions: string; criteria?: { true: string; false: string } }
  | { kind: 'graded'; instructions: string;
      direction: 'higher-is-better' | 'lower-is-better' | 'unordered';
      levels: readonly { label: string; description: string }[] }
  | { kind: 'choice'; instructions: string;
      options: readonly { id: string; description: string }[] }
  | { kind: 'registered'; criteriaId: string; revision: string };

export type DecisionRule =
  | { kind: 'provider' }
  | { kind: 'threshold'; field: 'score'; op: 'gte' | 'lte'; value: number }
  | { kind: 'labels'; passing: readonly string[] };

export interface DecisionRequest {
  schemaVersion: 1;
  evaluator: EvaluatorRef;
  inputs: DecisionInputs;
  criterion: DecisionCriterion;
  decision?: DecisionRule;
  policy?: {
    budget?: { maxCostMicroUsd: MicroUsd };
    timeoutMs?: number;
    explanation?: 'none' | 'if-available' | 'required';
  };
  raw?: { mode: 'none' | 'allowlisted'; maxBytes?: number };
  correlationId?: string;
}

export type DecisionRequestParseResult =
  | { ok: true; request: DecisionRequest }
  | { ok: false; code: 'REQUEST_INVALID' | 'CAPABILITY_UNSUPPORTED' | 'PROVIDER_UNKNOWN' };

/** Pure preflight parsing: capabilities and descriptor revisions remain service-owned. */
export function parseDecisionRequest(value: unknown): DecisionRequestParseResult {
  const invalid = { ok: false, code: 'REQUEST_INVALID' } as const;
  const snapshot = snapshotBoundedJson(value);
  if (!snapshot.ok) return invalid;
  value = snapshot.value;
  if (!isRecord(value)) return invalid;
  // Unsupported retention policy takes precedence over ordinary extra-property errors.
  if (isRecord(value.policy) && has(value.policy, 'zdr')) {
    return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
  }
  if (!hasOnlyKeys(value, ['schemaVersion', 'evaluator', 'inputs', 'criterion', 'decision', 'policy', 'raw', 'correlationId'])
    || value.schemaVersion !== 1 || !isRecord(value.evaluator)
    || !hasOnlyKeys(value.evaluator, ['providerId', 'evaluatorId', 'revision'])
    || !isText(value.evaluator.providerId) || !isText(value.evaluator.evaluatorId)
    || !isText(value.evaluator.revision) || !isRecord(value.inputs)
    || !hasOnlyKeys(value.inputs, ['input', 'output', 'context', 'reference', 'state'])
    || (!has(value.inputs, 'output') && !has(value.inputs, 'state'))
    || (has(value.inputs, 'context') && !Array.isArray(value.inputs.context))) return invalid;
  const criterion = value.criterion;
  if (!isDecisionCriterion(criterion)) return invalid;
  if (has(value, 'decision')) {
    const decision = value.decision;
    if (!isDecisionRule(decision)) return invalid;
    if (decision.kind === 'labels' && criterion.kind !== 'registered') {
      const labels = criterion.kind === 'choice' ? criterion.options.map((v) => v.id)
        : criterion.kind === 'graded' ? criterion.levels.map((v) => v.label) : [];
      if (!decision.passing.every((label) => labels.includes(label))) return invalid;
    }
  }
  if ((has(value, 'policy') && !isRequestPolicy(value.policy))
    || (has(value, 'raw') && !isRawPolicy(value.raw))
    || (has(value, 'correlationId') && !isCorrelationId(value.correlationId))) return invalid;
  if (!isProviderId(value.evaluator.providerId)) return { ok: false, code: 'PROVIDER_UNKNOWN' };
  return { ok: true, request: value as unknown as DecisionRequest };
}
