import type { DecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionErrorCode } from './errors.js';
import { encodeJevRequest } from './jev-codec.js';
import { encodeOpenAiDecisionsRequest } from './openai-request.js';
import { canExecuteDecisionCandidate } from './qualification.js';

export interface DecisionHostPolicy { timeoutMs?: number; maxCostMicroUsd?: string; allowRaw?: boolean }
/** Capability/decision refusal precedes credential acquisition and financial admission. */
export function validateDecisionPolicy(request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor,
  host: DecisionHostPolicy = {}): DecisionErrorCode | null {
  const encoded = descriptor.protocol === 'openai-decisions' ? encodeOpenAiDecisionsRequest(request, descriptor) : encodeJevRequest(request, descriptor);
  if (!encoded.ok) return encoded.code;
  const criterion = encoded.criterion;
  if (!canExecuteDecisionCandidate(descriptor)) return 'PROVIDER_UNAVAILABLE';
  if (request.policy?.explanation === 'required' || request.decision?.kind === 'provider') return 'CAPABILITY_UNSUPPORTED';
  if (request.raw?.mode === 'allowlisted' && host.allowRaw !== true) return 'CAPABILITY_UNSUPPORTED';
  if (criterion.kind === 'choice' && criterion.options.some((option) => ['__proto__', 'constructor', 'prototype'].includes(option.id))) {
    return 'CAPABILITY_UNSUPPORTED';
  }
  const rule = request.decision;
  if (rule?.kind === 'threshold') {
    if (criterion.kind === 'choice') return 'CAPABILITY_UNSUPPORTED';
    const max = criterion.kind === 'binary' ? 1 : criterion.levels.length - 1;
    if (rule.value < 0 || rule.value > max) return 'REQUEST_INVALID';
  }
  if (rule?.kind === 'labels') {
    if (criterion.kind !== 'choice') return 'CAPABILITY_UNSUPPORTED';
    if (!rule.passing.every((label) => criterion.options.some((option) => option.id === label))) return 'REQUEST_INVALID';
  }
  return null;
}
