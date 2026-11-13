import type { DecisionRequest } from './request.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionAdapterResult } from './adapter.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevResponse } from './jev-response.js';
import { createDecisionError } from './errors.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

/** One named question per mesh request; structured evidence remains JSON data. */
export function encodeGeminiDecisionsRequest(candidate: unknown, descriptor: DecisionEvaluatorDescriptor) {
  const encoded = encodeJevRequest(candidate, descriptor);
  if (!encoded.ok) return encoded;
  const request = encoded.request;
  if (descriptor.protocol !== 'gemini-decisions') return { ok: false, code: 'EVALUATOR_UNKNOWN' } as const;
  if (request.policy?.explanation === 'required' || request.decision?.kind === 'provider') {
    return { ok: false, code: 'CAPABILITY_UNSUPPORTED' } as const;
  }
  const criterion = encoded.criterion;
  if (criterion.kind === 'choice' && (criterion.options.length < 2 || criterion.options.some(({ id }) =>
    [...id].length > 128 || new TextEncoder().encode(id).length > 512 || id !== id.trim()
    || /[\x00-\x1f\x7f\s]/u.test(id.replaceAll(' ', ''))))) {
    return { ok: false, code: 'CAPABILITY_UNSUPPORTED' } as const;
  }
  const question = { ...encoded.body.questions.verdict,
    ...(criterion.kind === 'binary' && criterion.criteria ? { criteria: {
      true_description: criterion.criteria.true, false_description: criterion.criteria.false,
    } } : {}) };
  const input = JSON.stringify(request.inputs);
  const bodyJson = JSON.stringify({ model: descriptor.wireModel, input, questions: { verdict: question } });
  if (new TextEncoder().encode(bodyJson).length > descriptor.maxRequestBytes
    || new TextEncoder().encode(input + JSON.stringify(question)).length > descriptor.maxStateQuestionBytes) {
    return { ok: false, code: 'REQUEST_INVALID' } as const;
  }
  return { ...encoded, bodyJson };
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** Normalize only documented counters. Missing served identity is never inferred from the request. */
export function decodeGeminiDecisionsResponse(candidate: unknown, request: DecisionRequest,
  descriptor: DecisionEvaluatorDescriptor, requestId?: unknown): DecisionAdapterResult {
  const snapshot = snapshotBoundedJson(candidate);
  const body = snapshot.ok && isRecord(snapshot.value) ? snapshot.value : null;
  const identity = decodeJevResponse({ model: body?.model ?? null, answers: body?.answers, usage: {} },
    request, descriptor, requestId);
  const evidence = { usage: identity.usage, servedEvaluator: identity.servedEvaluator,
    servedModelId: identity.servedModelId,
    ...(identity.providerRequestId ? { providerRequestId: identity.providerRequestId } : {}) };
  const invalid = (code: 'USAGE_INVALID' | 'VERDICT_INVALID'): DecisionAdapterResult => ({ ok: false,
    error: createDecisionError(code, 'parse'), ...evidence });
  if (!body) return invalid('VERDICT_INVALID');
  const usage = body.usage;
  if (!isRecord(usage) || !hasOnlyKeys(usage, ['total_input_tokens', 'total_output_tokens', 'total_tokens', 'input_tokens_by_modality'])
    || !count(usage.total_input_tokens) || usage.total_output_tokens !== 0
    || usage.total_tokens !== usage.total_input_tokens || !Array.isArray(usage.input_tokens_by_modality)) return invalid('USAGE_INVALID');
  const modalities = new Set<string>();
  let total = 0;
  for (const entry of usage.input_tokens_by_modality) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['modality', 'tokens']) || !count(entry.tokens)
      || typeof entry.modality !== 'string' || !['text', 'image', 'audio'].includes(entry.modality)
      || modalities.has(entry.modality)) return invalid('USAGE_INVALID');
    modalities.add(entry.modality); total += entry.tokens;
  }
  if (total !== usage.total_input_tokens) return invalid('USAGE_INVALID');
  const normalized = { model: body.model ?? null, answers: body.answers,
    usage: { input_tokens: usage.total_input_tokens, output_tokens: 0 } };
  evidence.usage = decodeJevResponse(normalized, request, descriptor, requestId).usage;
  if (!hasOnlyKeys(body, ['model', 'answers', 'usage'])) return invalid('VERDICT_INVALID');
  if (!isRecord(body.answers) || !hasOnlyKeys(body.answers, ['verdict']) || !isRecord(body.answers.verdict)) return invalid('VERDICT_INVALID');
  const answer = { ...body.answers.verdict };
  const encoded = encodeGeminiDecisionsRequest(request, descriptor);
  if (!encoded.ok) return invalid('VERDICT_INVALID');
  if (answer.type === 'noul') {
    if (typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0.01 || answer.noul > 0.99
      || !hasOnlyKeys(answer, ['type', 'noul', 'confidence'])
      || typeof answer.confidence !== 'number'
      || Math.abs(answer.confidence - Math.max(answer.noul, 1 - answer.noul)) > descriptor.probabilityTolerance) return invalid('VERDICT_INVALID');
    // The existing binary contract carries P(true) only; validate native confidence before dropping it.
    delete answer.confidence;
  } else if (isRecord(answer.probabilities)) {
    const probabilities = Object.values(answer.probabilities);
    if (!probabilities.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)
      || typeof answer.confidence !== 'number'
      || Math.abs(answer.confidence - Math.max(...probabilities as number[])) > descriptor.probabilityTolerance) return invalid('VERDICT_INVALID');
  }
  return decodeJevResponse({ ...normalized, answers: { verdict: answer } }, request, descriptor, requestId);
}
