import { parseJudgeRequest } from './request.js';
import type { JudgeRequest } from './request.js';
import type { EvaluatorDescriptor, ResolvedJudgeCriterion } from './jev-descriptor.js';
import { isJudgeCriterion } from './criterion.js';
import { snapshotBoundedJson } from './validation.js';
import type { JudgeErrorCode } from './errors.js';

export interface JevRequestBody {
  model: string;
  state: JudgeRequest['inputs'];
  questions: { verdict: { type: 'noul' | 'score' | 'choice'; instructions: string;
    criteria?: { true: string; false: string } | readonly string[] | Record<string, string> } };
}
export type JevEncoding = { ok: true; body: JevRequestBody; bodyJson: string; request: JudgeRequest; criterion: ResolvedJudgeCriterion }
  | { ok: false; code: JudgeErrorCode };

/** One question, no instruction/content concatenation, coercion or omitted significant fields. */
export function encodeJevRequest(candidate: unknown, descriptor: EvaluatorDescriptor): JevEncoding {
  const parsed = parseJudgeRequest(candidate);
  if (!parsed.ok) return parsed;
  const request = parsed.request;
  if (request.evaluator.providerId !== descriptor.evaluator.providerId
    || request.evaluator.evaluatorId !== descriptor.evaluator.evaluatorId) return { ok: false, code: 'EVALUATOR_UNKNOWN' };
  if (request.evaluator.revision !== descriptor.evaluator.revision) return { ok: false, code: 'REVISION_MISMATCH' };
  let criterion: ResolvedJudgeCriterion;
  if (request.criterion.kind === 'registered') {
    const ref = request.criterion;
    const found = descriptor.registeredCriteria.find((entry) => entry.criteriaId === ref.criteriaId && entry.revision === ref.revision);
    const snapshot = snapshotBoundedJson(found?.criterion);
    if (!snapshot.ok || !isJudgeCriterion(snapshot.value) || snapshot.value.kind === 'registered') {
      return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
    }
    criterion = snapshot.value;
  } else criterion = request.criterion;
  if ((criterion.kind === 'graded' && (criterion.levels.length < 2 || criterion.levels.length > 10))
    || (criterion.kind === 'choice' && criterion.options.length > 255)) return { ok: false, code: 'CAPABILITY_UNSUPPORTED' };
  const question: JevRequestBody['questions']['verdict'] = { type: criterion.kind === 'binary' ? 'noul'
    : criterion.kind === 'graded' ? 'score' : 'choice', instructions: criterion.instructions };
  if (criterion.kind === 'binary' && criterion.criteria) question.criteria = { ...criterion.criteria };
  if (criterion.kind === 'graded') question.criteria = criterion.levels.map((level) => level.description);
  if (criterion.kind === 'choice') question.criteria = Object.fromEntries(criterion.options.map((option) => [option.id, option.description]));
  const body: JevRequestBody = { model: descriptor.wireModel, state: request.inputs, questions: { verdict: question } };
  // JSON.stringify reorders integer-like map keys; serialize choice entries in caller order.
  const questionJson = criterion.kind !== 'choice' ? JSON.stringify(question)
    : JSON.stringify({ type: question.type, instructions: question.instructions }).slice(0, -1)
      + ',"criteria":{' + criterion.options.map((option) => JSON.stringify(option.id) + ':' + JSON.stringify(option.description)).join(',') + '}}';
  const stateJson = JSON.stringify(body.state);
  const bodyJson = '{"model":' + JSON.stringify(body.model) + ',"state":' + stateJson + ',"questions":{"verdict":' + questionJson + '}}';
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  if (bytes(bodyJson) > descriptor.maxRequestBytes || bytes(stateJson) + bytes(questionJson) > descriptor.maxStateQuestionBytes) {
    return { ok: false, code: 'REQUEST_INVALID' };
  }
  return { ok: true, body, bodyJson, request, criterion };
}
