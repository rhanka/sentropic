import type { DecisionEvaluatorDescriptor, ResolvedDecisionCriterion } from './descriptor.js';
import type { DecisionRequest } from './request.js';
import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import { getProviderProfile } from '../catalog.js';
import type { ProviderDescriptor } from '../catalog.js';
import { isProviderId } from '../providers.js';
import { parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { createDecisionError } from './errors.js';
import { deriveDecision } from './verdict.js';
import type { DecisionVerdict } from './verdict.js';
import { unreportedDecisionUsage } from './receipt.js';
import type { DecisionUsage } from './receipt.js';
import type { DecisionAdapterResult } from './adapter.js';
import { hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';

/** Revisioned structured output contract served by this backend. */
export const STRUCTURED_CONTRACT_REVISION = 'structured-llm-v1';
/** Scalar meaning asserted by this backend for structured evidence. */
export const STRUCTURED_SCORE_MEANING = 'support';
/** Adapter-local conservative execution default. Service admission enforces
 * the descriptor bound; direct adapter use never invents liability. */
const STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Closed JSON schema fragment (additionalProperties: false throughout). */
const closedSchema = (required: readonly string[], properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object', required: [...required], properties, additionalProperties: false,
});

/** Injected structured transport: receives the compiled bounded payload once
 * and returns the raw model text once. No repair calls, no hidden retries. */
export type StructuredDecisionTransport = {
  send(payload: StructuredDecisionPayload, options?: { signal?: AbortSignal }): Promise<string>;
};
/** Bounded evaluated content for the transport: full resolved criterion plus
 * evaluated inputs. No tool authority travels with the data. */
export interface StructuredDecisionPayload {
  contractRevision: string;
  prompt: string;
  schema: Record<string, unknown>;
  execution: { maxOutputTokens: number };
  compilation: { templateDigest: string; schemaDigest: string; readout: string };
  criterion: ResolvedDecisionCriterion;
  content: { input: unknown; output: unknown; state: unknown; reference: unknown; context: unknown };
}
export interface StructuredDecisionAdapterOptions {
  descriptor: DecisionEvaluatorDescriptor;
  transport: StructuredDecisionTransport;
}

/** Generic structured backend: compiles one criterion plus evaluated content
 * into prompt, closed schema and execution settings; parses without scraping,
 * rejects refusal/malformed/extra/missing/prose/clamp/default and invented
 * identity/usage, no retry. */
export interface DecisionBackend {
  compile(request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): StructuredDecisionPayload;
}
const compileStructured = (request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): StructuredDecisionPayload => {
  if (request.criterion.kind === 'registered') throw new Error('Structured cannot compile a registered criterion.');
  const revision = descriptor.evaluator.revision;
  const kind = request.criterion.kind;
  const instructions = request.criterion.instructions;
  const prompt = `structured-llm-v1 revision=${revision} kind=${kind} instructions=${instructions}`;
  const servedSchema = closedSchema(['modelId'], { modelId: { type: 'string' } });
  const usageSchema = closedSchema(['inputTokens', 'outputTokens'],
    { inputTokens: { type: 'integer', minimum: 0 }, outputTokens: { type: 'integer', minimum: 0 } });
  const evidence = { served: servedSchema, usage: usageSchema };
  const schema = kind === 'choice'
    ? closedSchema(['label', 'served', 'usage'], { label: { type: 'string' }, ...evidence })
    : closedSchema(['score', 'served', 'usage'], { score: { type: 'number' }, ...evidence });
  return {
    contractRevision: STRUCTURED_CONTRACT_REVISION,
    prompt,
    schema,
    execution: { maxOutputTokens: descriptor.maxBillableOutputTokens > 0
      ? descriptor.maxBillableOutputTokens : STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS },
    compilation: { templateDigest: descriptor.compilation.templateDigest,
      schemaDigest: descriptor.compilation.schemaDigest, readout: descriptor.compilation.readout },
    criterion: structuredClone(request.criterion),
    content: { input: request.inputs.input ?? null, output: request.inputs.output ?? null,
      state: request.inputs.state ?? null, reference: request.inputs.reference ?? null,
      context: request.inputs.context ?? null },
  };
};

/** Transport-reported served identity: accepted-set model string, else mismatch. */
const parseStructuredServedIdentity = (candidate: unknown, descriptor: DecisionEvaluatorDescriptor): string | null => {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['modelId']) || !isText(candidate.modelId)) return null;
  return descriptor.acceptedServedModelIds.includes(candidate.modelId) ? candidate.modelId : null;
};

/** Transport-reported usage: both counters required (§4.3), never invented. */
const parseStructuredReportedUsage = (candidate: unknown): DecisionUsage | null => {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['inputTokens', 'outputTokens'])) return null;
  const { inputTokens, outputTokens } = candidate;
  if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0) return null;
  if (typeof outputTokens !== 'number' || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return null;
  return { tokens: { input: { value: inputTokens, source: 'provider' },
    output: { value: outputTokens, source: 'provider' },
    total: { value: inputTokens + outputTokens, source: 'derived-sum' } },
  evaluatorCalls: 1, explanations: 0 };
};

export class StructuredDecisionAdapter implements ProviderAdapter {
  readonly provider: ProviderDescriptor;
  readonly descriptor: DecisionEvaluatorDescriptor;
  readonly backend: DecisionBackend = { compile: compileStructured };
  constructor(private readonly options: StructuredDecisionAdapterOptions) {
    const descriptor = parseDecisionEvaluatorDescriptor(options.descriptor);
    if (!descriptor || descriptor.protocol !== 'structured-llm') throw new Error('Invalid structured descriptor.');
    // Register under the descriptor-selected provider instead of pinning TypeSafe.
    if (!isProviderId(descriptor.evaluator.providerId)) throw new Error('Invalid structured descriptor.');
    this.provider = getProviderProfile(descriptor.evaluator.providerId);
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
    let payload: StructuredDecisionPayload;
    try {
      payload = compileStructured(request, this.descriptor);
    } catch {
      return { ok: false, error: createDecisionError('CAPABILITY_UNSUPPORTED', 'dispatch'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const compiled = snapshotBoundedJson(payload);
    if (!compiled.ok) {
      return { ok: false, error: createDecisionError('CAPABILITY_UNSUPPORTED', 'dispatch'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    let text: string;
    try {
      text = await this.options.transport.send(compiled.value as StructuredDecisionPayload, { signal: context?.signal });
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
    // Identity before accounting: served model and both counters come from
    // the transport; missing/substituted evidence refuses, never invents.
    const failIdentity = { ok: false, error: createDecisionError('SERVED_IDENTITY_MISMATCH', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const failUsage = { ok: false, error: createDecisionError('USAGE_INVALID', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const failVerdict = { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const servedModelId = parseStructuredServedIdentity(body.served, this.descriptor);
    if (servedModelId === null) return { ...failIdentity };
    const usage = parseStructuredReportedUsage(body.usage);
    if (usage === null) return { ...failUsage };
    const evidence = { usage, servedEvaluator: { ...this.descriptor.evaluator }, servedModelId };
    if (request.criterion.kind === 'choice') {
      if (!hasOnlyKeys(body, ['label', 'served', 'usage']) || !isText(body.label)
        || !request.criterion.options.some((option) => option.id === body.label)) {
        return { ...failVerdict };
      }
      const label = { value: body.label, origin: 'provider' as const };
      const derived = deriveDecision({ rule: request.decision, score: null, label: body.label,
        providerDecision: null, declaredLabels: request.criterion.options.map((option) => option.id) });
      if (!derived.ok) return { ok: false, error: createDecisionError(derived.code, 'parse'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
      const decision = derived.decision;
      const verdict = { criterionKind: 'choice', resolvedCriterionKind: 'choice', score: null,
        decision, label, rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict;
      return { ok: true, verdict, ...evidence };
    }
    if (!hasOnlyKeys(body, ['score', 'served', 'usage']) || typeof body.score !== 'number' || !Number.isFinite(body.score)) {
      return { ...failVerdict };
    }
    const max = request.criterion.kind === 'graded' ? request.criterion.levels.length - 1 : 1;
    if (body.score < 0 || body.score > max) {
      return { ...failVerdict };
    }
    const direction = request.criterion.kind === 'graded' ? request.criterion.direction : 'unordered';
    const score = { value: body.score, meaning: STRUCTURED_SCORE_MEANING,
      scale: { kind: 'bounded' as const, min: 0, max, direction } };
    const derived = deriveDecision({ rule: request.decision, score: score as never, label: null, providerDecision: null });
    if (!derived.ok) return { ok: false, error: createDecisionError(derived.code, 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') };
    const decision = derived.decision;
    const verdict = { criterionKind: request.criterion.kind,
      resolvedCriterionKind: request.criterion.kind, score, decision, label: null,
      rationale: null, confidence: null, distribution: null } as unknown as DecisionVerdict;
    return { ok: true, verdict, ...evidence };
  }
}
export const createStructuredDecisionAdapter = (options: StructuredDecisionAdapterOptions): StructuredDecisionAdapter =>
  new StructuredDecisionAdapter(options);
