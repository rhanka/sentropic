import type { JudgeRequest } from './request.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import type { JudgeErrorCode } from './errors.js';
import { encodeJevRequest } from './jev-codec.js';

export interface JudgeHostPolicy { timeoutMs?: number; maxCostMicroUsd?: string; allowRaw?: boolean }
/** Capability/decision refusal precedes credential acquisition and financial admission. */
export function validateJevPolicy(request: JudgeRequest, descriptor: EvaluatorDescriptor,
  host: JudgeHostPolicy = {}): JudgeErrorCode | null {
  const encoded = encodeJevRequest(request, descriptor);
  if (!encoded.ok) return encoded.code;
  const criterion = encoded.criterion;
  if (descriptor.qualification.servedIdentity !== 'qualified') return 'PROVIDER_UNAVAILABLE';
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
