import type { DecisionRequest } from './request.js';
import { parseDecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor, ResolvedDecisionCriterion } from './descriptor.js';
import type { DecisionErrorCode } from './errors.js';

export type OpenAiDecisionsEncoding = { ok: true; request: DecisionRequest; criterion: ResolvedDecisionCriterion; bodyJson: string }
  | { ok: false; code: DecisionErrorCode };

/** Dedicated one-question protocol; evidence stays in input data, never in instructions. */
export function encodeOpenAiDecisionsRequest(candidate: unknown, descriptor: DecisionEvaluatorDescriptor): OpenAiDecisionsEncoding {
  const parsed = parseDecisionRequest(candidate);
  if (!parsed.ok) return parsed;
  const request = parsed.request;
  if (descriptor.protocol !== 'openai-decisions' || request.evaluator.providerId !== descriptor.evaluator.providerId
    || request.evaluator.evaluatorId !== descriptor.evaluator.evaluatorId) return { ok: false, code: 'EVALUATOR_UNKNOWN' };
  if (request.evaluator.revision !== descriptor.evaluator.revision) return { ok: false, code: 'REVISION_MISMATCH' };
  const ref = request.criterion;
  const criterion = ref.kind === 'registered' ? descriptor.registeredCriteria.find((entry) =>
    entry.criteriaId === ref.criteriaId && entry.revision === ref.revision)?.criterion : ref;
  if (!criterion || (criterion.kind === 'choice' && (criterion.options.length < 2 || criterion.options.length > 255))
    || (criterion.kind === 'graded' && (criterion.levels.length < 2 || criterion.levels.length > 10))
    || request.policy?.explanation === 'required' || request.decision?.kind === 'provider') return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
  const question = { name: 'verdict', instructions: criterion.kind === 'binary' && criterion.criteria
    ? JSON.stringify({ instructions: criterion.instructions, criteria: criterion.criteria }) : criterion.instructions,
    type: criterion.kind === 'binary' ? 'predicate' : criterion.kind === 'graded' ? 'score' : 'choice',
    ...(criterion.kind === 'choice' ? { choices: criterion.options.map((option) => ({ value: option.id, description: option.description })) } : {}),
    ...(criterion.kind === 'graded' ? { levels: criterion.levels.map((level) => ({ label: level.label, description: level.description })) } : {}) };
  const input = JSON.stringify(request.inputs);
  // Explicit mode without breakpoints disables the currently documented implicit cache.
  const bodyJson = JSON.stringify({ model: descriptor.wireModel, input, questions: [question], prompt_cache_options: { mode: 'explicit' } });
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  if (bytes(bodyJson) > descriptor.maxRequestBytes || bytes(input) + bytes(JSON.stringify(question)) > descriptor.maxStateQuestionBytes) {
    return { ok: false, code: 'REQUEST_INVALID' };
  }
  return { ok: true, request, criterion, bodyJson };
}
