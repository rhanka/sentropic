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
import { digestStructuredArtifact, hasOnlyKeys, isRecord, isText, snapshotBoundedJson } from './validation.js';

/** Revisioned structured output contract served by this backend. */
export const STRUCTURED_CONTRACT_REVISION = 'structured-llm-v1';
/** Scalar meaning asserted by this backend for structured evidence. */
export const STRUCTURED_SCORE_MEANING = 'support';
/** Validation profile this backend implements and enforces. */
export const STRUCTURED_VALIDATION_PROFILE = { profile: 'structured-llm-v1', version: 'v1' } as const;
/** Prompt template this backend instantiates; digest-bound to the descriptor. */
export const STRUCTURED_PROMPT_TEMPLATE =
  'structured-llm-v1 revision={revision} kind={kind} instructions={instructions}';
/** Adapter-local conservative execution default. Service admission enforces
 * the descriptor bound; direct adapter use never invents liability. */
const STRUCTURED_DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Closed JSON schema fragment (additionalProperties: false throughout). */
const closedSchema = (required: readonly string[], properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object', required: [...required], properties, additionalProperties: false,
});

/** Closed evidence schema this backend sends for one criterion kind. */
export const structuredSchemaForKind = (kind: string): Record<string, unknown> => kind === 'choice'
  ? closedSchema(['label'], { label: { type: 'string' } })
  : closedSchema(['score'], { score: { type: 'number' } });

/** Readout identity this backend declares for its sampling configuration. */
export const STRUCTURED_READOUT_IDENTITY = 'structured-llm-v1';

/**
 * Mint the digest-bound compilation + definition pair for one effective
 * output budget and readout identity. The family schema digest covers all
 * three criterion schemas; per-kind entries in the definition bind each
 * dispatched schema individually. Fixtures mint through this helper so
 * declared digests always bind the artifacts this backend dispatches.
 */
export const mintStructuredContractDigests = (input: { maxOutputTokens: number; readout: string }): {
  templateDigest: string;
  schemaDigest: string;
  definition: {
    validationProfile: { profile: string; version: string };
    kinds: { kind: string; schemaDigest: string }[];
    evidenceRequirements: string[];
    executionDigest: string;
    bundleDigest: string;
  };
} => {
  const templateDigest = digestStructuredArtifact(STRUCTURED_PROMPT_TEMPLATE);
  const schemas = { binary: structuredSchemaForKind('binary'), graded: structuredSchemaForKind('graded'),
    choice: structuredSchemaForKind('choice') };
  const schemaDigest = digestStructuredArtifact(schemas);
  const kinds = (Object.keys(schemas) as ('binary' | 'graded' | 'choice')[]).map((kind) => ({
    kind, schemaDigest: digestStructuredArtifact(schemas[kind]),
  }));
  const executionDigest = digestStructuredArtifact({ maxOutputTokens: input.maxOutputTokens });
  const bundleDigest = digestStructuredArtifact({ contractRevision: STRUCTURED_CONTRACT_REVISION, readout: input.readout,
    templateDigest, schemaDigest, executionDigest, validationProfile: { ...STRUCTURED_VALIDATION_PROFILE } });
  return { templateDigest, schemaDigest,
    definition: { validationProfile: { ...STRUCTURED_VALIDATION_PROFILE }, kinds,
      evidenceRequirements: ['served-identity', 'reported-usage'], executionDigest, bundleDigest } };
};

/** Provider envelope returned by the injected structured transport: the raw
 * model text plus the provider-side response metadata, delivered separately.
 * Identity and usage come from this envelope only; generated text never
 * supplies them. One send, one envelope, no repair calls, no hidden retries. */
export interface StructuredProviderEnvelope {
  text: string;
  served: unknown;
  usage: unknown;
}
export type StructuredDecisionTransport = {
  send(payload: StructuredDecisionPayload, options?: { signal?: AbortSignal }): Promise<StructuredProviderEnvelope>;
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
 * into prompt, closed schema and execution settings; parses the generated
 * verdict evidence only, rejects refusal/malformed/extra/missing/prose/
 * clamp/default and any generated identity/usage, and takes served identity
 * and reported counters exclusively from the provider envelope, no retry. */
export interface DecisionBackend {
  compile(request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): StructuredDecisionPayload;
}
const compileStructured = (request: DecisionRequest, descriptor: DecisionEvaluatorDescriptor): StructuredDecisionPayload => {
  if (request.criterion.kind === 'registered') throw new Error('Structured cannot compile a registered criterion.');
  const revision = descriptor.evaluator.revision;
  const kind = request.criterion.kind;
  const instructions = request.criterion.instructions;
  const prompt = STRUCTURED_PROMPT_TEMPLATE.replace('{revision}', revision).replace('{kind}', kind)
    .replace('{instructions}', instructions);
  // The generated-output schema carries the verdict evidence only. Served
  // identity and reported usage travel in the provider envelope, never in
  // model text, so generated fields cannot establish their own provenance.
  const schema = structuredSchemaForKind(kind);
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
    // Complete definition binding (§3.2): the declared validation profile,
    // covered kinds, required evidence and digests must match the artifacts
    // actually compiled and dispatched here; anything else is refused before
    // any provider contact.
    const definition = this.descriptor.definition;
    const refuseDefinition = { ok: false, error: createDecisionError('CAPABILITY_UNSUPPORTED', 'dispatch'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const compiledPayload = compiled.value as StructuredDecisionPayload;
    const kindEntry = definition.kinds.find((entry) => entry.kind === request.criterion.kind);
    if (definition.validationProfile.profile !== STRUCTURED_VALIDATION_PROFILE.profile
      || definition.validationProfile.version !== STRUCTURED_VALIDATION_PROFILE.version
      || !kindEntry
      || !definition.evidenceRequirements.includes('served-identity')
      || !definition.evidenceRequirements.includes('reported-usage')) return { ...refuseDefinition };
    const actualTemplateDigest = digestStructuredArtifact(STRUCTURED_PROMPT_TEMPLATE);
    const actualFamily = { binary: structuredSchemaForKind('binary'), graded: structuredSchemaForKind('graded'),
      choice: structuredSchemaForKind('choice') };
    const actualSchemaDigest = digestStructuredArtifact(actualFamily);
    const actualSchemaKindDigest = digestStructuredArtifact(compiledPayload.schema);
    const actualExecutionDigest = digestStructuredArtifact({ maxOutputTokens: compiledPayload.execution.maxOutputTokens });
    const actualBundleDigest = digestStructuredArtifact({ contractRevision: compiledPayload.contractRevision,
      readout: this.descriptor.compilation.readout, templateDigest: actualTemplateDigest,
      schemaDigest: actualSchemaDigest, executionDigest: actualExecutionDigest,
      validationProfile: { ...STRUCTURED_VALIDATION_PROFILE } });
    if (this.descriptor.compilation.templateDigest !== actualTemplateDigest
      || this.descriptor.compilation.schemaDigest !== actualSchemaDigest
      || kindEntry.schemaDigest !== actualSchemaKindDigest
      || definition.executionDigest !== actualExecutionDigest
      || definition.bundleDigest !== actualBundleDigest) return { ...refuseDefinition };
    let envelope: StructuredProviderEnvelope;
    try {
      envelope = await this.options.transport.send(compiled.value as StructuredDecisionPayload, { signal: context?.signal });
    } catch {
      return { ok: false, error: createDecisionError('TRANSPORT_FAILED', 'dispatch'),
        ...empty, usage: unreportedDecisionUsage('unknown') };
    }
    const envelopeRecord = isRecord(envelope) ? envelope : null;
    const text = envelopeRecord !== null && typeof envelopeRecord.text === 'string' ? envelopeRecord.text : null;
    if (text === null || new TextEncoder().encode(text).byteLength > 16384) {
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
    // the provider envelope only; generated text never supplies them, and
    // missing/substituted envelope evidence refuses, never invents.
    const failIdentity = { ok: false, error: createDecisionError('SERVED_IDENTITY_MISMATCH', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const failUsage = { ok: false, error: createDecisionError('USAGE_INVALID', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const failVerdict = { ok: false, error: createDecisionError('VERDICT_INVALID', 'parse'),
      ...empty, usage: unreportedDecisionUsage('unknown') } as const;
    const servedModelId = parseStructuredServedIdentity(envelopeRecord?.served, this.descriptor);
    if (servedModelId === null) return { ...failIdentity };
    const usage = parseStructuredReportedUsage(envelopeRecord?.usage);
    if (usage === null) return { ...failUsage };
    const evidence = { usage, servedEvaluator: { ...this.descriptor.evaluator }, servedModelId };
    if (request.criterion.kind === 'choice') {
      if (!hasOnlyKeys(body, ['label']) || !isText(body.label)
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
    if (!hasOnlyKeys(body, ['score']) || typeof body.score !== 'number' || !Number.isFinite(body.score)) {
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
