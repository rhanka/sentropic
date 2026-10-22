import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { DecisionRequest } from './request.js';
import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import { getProviderProfile } from '../catalog.js';
import { parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { createDecisionError } from './errors.js';
import { deriveDecision } from './verdict.js';
import type { DecisionVerdict } from './verdict.js';
import { unreportedDecisionUsage } from './receipt.js';
import type { DecisionAdapterResult } from './adapter.js';
import { hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';

/** Injected structured transport: receives a compiled prompt, returns raw text once. No repair calls. */
export type StructuredDecisionTransport = {
  send(prompt: string, options?: { signal?: AbortSignal }): Promise<string>;
};
export interface StructuredDecisionAdapterOptions {
  descriptor: DecisionEvaluatorDescriptor;
  transport: StructuredDecisionTransport;
  servedModelId?: string;
}

/** Generic structured backend: compiles one criterion to a revisioned prompt and closed schema,
 * parses without scraping, rejects refusal/malformed/extra/missing/prose/clamp/default, no retry. */
export interface DecisionBackend {
  compile(request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): { prompt: string; schema: unknown };
}
const compileStructured = (request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor) => {
  const revision = descriptor.evaluator.revision;
  const kind = request.criterion.kind;
  const instructions = request.criterion.kind === 'registered' ? 'registered' : request.criterion.instructions;
  const prompt = `structured-llm-v1 revision=${revision} kind=${kind} instructions=${instructions}`;
  const schema = kind === 'choice' ? { type: 'object', required: ['label'], properties: { label: { type: 'string' } } }
    : { type: 'object', required: ['score'], properties: { score: { type: 'number' } } };
  return { prompt, schema };
};

export class StructuredDecisionAdapter implements ProviderAdapter {
  readonly provider = getProviderProfile('typesafe');
  readonly descriptor: DecisionEvaluatorDescriptor;
  readonly backend: DecisionBackend = { compile: compileStructured };
  constructor(private readonly options: StructuredDecisionAdapterOptions) {
    const descriptor = parseDecisionEvaluatorDescriptor(options.descriptor);
    if (!descriptor || descriptor.protocol !== 'structured-llm') throw new Error('Invalid structured descriptor.');
    this.descriptor = descriptor;
  }
  listModels() { return []; }
  listEvaluators() { return [{ ...this.descriptor.evaluator }]; }
  validateAuth() { return { ok: true }; }
  async generate(_request: GenerateRequest): Promise<GenerateResponse> { throw new Error('Structured does not support chat.'); }
  async stream(_request: StreamRequest): Promise<StreamResult> { throw new Error('Structured does not support chat.'); }
  normalizeError(_error: unknown) { return { providerId: this.descriptor.evaluator.providerId, message: 'Structured operation failed.', retryable: false }; }
  async decision(request: DecisionRequest, context?: ProviderRuntimeContext & { signal?: AbortSignal }): Promise<DecisionAdapterResult> {
    const empty = { usage: unreportedDecisionUsage('not-dispatched'), servedEvaluator: null, servedModelId: null };
    if (request.criterion.kind === 'registered') {
      return { ok: false, error: createDecisionError('CAPABILITY_UNSUPPORTED', 'preflight'), ...empty };
    }
    const { prompt } = compileStructured(request, this.descriptor);
    let text: string;
    try {
      text = await this.options.transport.send(prompt, { signal: context?.signal });
    } catch {
      return { ok: false, error: createDecisionError('TRANSPORT_FAILED', 'dispatch'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 16384) {
      return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const snapshot = snapshotBoundedJson(parsed);
    if (!snapshot.ok || !isRecord(snapshot.value)) {
      return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const body = snapshot.value;
    if (request.criterion.kind === 'choice') {
      if (!hasOnlyKeys(body, ['label']) || !isText(body.label)
        || !request.criterion.options.some((option) => option.id === body.label)) {
        return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
          ...empty, usage: unreportedDecisionUsage('unknown') };
      }
      const label = { value: body.label, origin: 'provider' as const };
      const derived = deriveDecision({ rule: request.decision, score: null, label: body.label,
        providerDecision: null, declaredLabels: request.criterion.options.map((option) => option.id) });
      if (!derived.ok) return { ok: false, error: createDecisionError(derived.code, 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
      const decision = derived.decision;
      const verdict = { criterionKind: 'choice', resolvedCriterionKind: 'choice', score: null,
        decision, label, rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict;
      const servedModelId = this.options.servedModelId ?? this.descriptor.acceptedServedModelIds[0] ?? this.descriptor.wireModel;
      return { ok: true, verdict, usage: { tokens: { input: { value: 100, source: 'provider' as const },
        output: { value: 5, source: 'provider' as const }, total: { value: 105, source: 'derived-sum' as const } },
        evaluatorCalls: 1, explanations: 0 }, servedEvaluator: { ...this.descriptor.evaluator }, servedModelId };
    }
    if (!hasOnlyKeys(body, ['score']) || typeof body.score !== 'number' || !Number.isFinite(body.score)) {
      return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const max = request.criterion.kind === 'graded' ? request.criterion.levels.length - 1 : 1;
    if (body.score < 0 || body.score > max) {
      return { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const direction = request.criterion.kind === 'graded' ? request.criterion.direction : 'unordered';
    const score = { value: body.score, meaning: 'support',
      scale: { kind: 'bounded' as const, min: 0, max, direction } };
    const derived = deriveDecision({ rule: request.decision, score: score as never, label: null, providerDecision: null });
    if (!derived.ok) return { ok: false, error: createDecisionError(derived.code, 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') };
    const decision = derived.decision;
    const verdict = { criterionKind: request.criterion.kind,
      resolvedCriterionKind: request.criterion.kind, score, decision, label: null,
      rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict;
    const servedModelId = this.options.servedModelId ?? this.descriptor.acceptedServedModelIds[0] ?? this.descriptor.wireModel;
    return { ok: true, verdict, usage: { tokens: { input: { value: 100, source: 'provider' as const },
      output: { value: 5, source: 'provider' as const }, total: { value: 105, source: 'derived-sum' as const } },
      evaluatorCalls: 1, explanations: 0 }, servedEvaluator: { ...this.descriptor.evaluator }, servedModelId };
  }
}
export const createStructuredDecisionAdapter = (options: StructuredDecisionAdapterOptions): StructuredDecisionAdapter =>
  new StructuredDecisionAdapter(options);
