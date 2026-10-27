import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { AuthInput } from '../auth.js';
import { getSecretAuthMaterial } from '../auth.js';
import { getProviderProfile } from '../catalog.js';
import type { DecisionRequest } from './request.js';
import type { DecisionAdapterResult } from './adapter.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { OpenAiDecisionsTransport } from '../transport/openai-decisions.js';
import { openAiDecisionsDescriptor } from './openai-descriptor.js';
import { parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { encodeOpenAiDecisionsRequest, decodeOpenAiDecisionsResponse } from './openai-codec.js';
import { createDecisionError } from './errors.js';
import { unreportedDecisionUsage } from './receipt.js';
import { isRecord, snapshotBoundedJson } from './validation.js';
import { canExecuteDecisionCandidate } from './qualification.js';

export interface OpenAiDecisionsAdapterOptions { transport: OpenAiDecisionsTransport; descriptor?: DecisionEvaluatorDescriptor }
/** Explicit native registration; ordinary OpenAI chat composition never acquires it. */
export class OpenAiDecisionsAdapter implements ProviderAdapter {
  readonly provider = { ...getProviderProfile('typesafe'), providerId: 'openai' as const,
    family: 'openai' as const, label: 'OpenAI Decisions', decisionOnly: true as const };
  readonly descriptor: DecisionEvaluatorDescriptor;
  constructor(private readonly options: OpenAiDecisionsAdapterOptions) {
    const descriptor = parseDecisionEvaluatorDescriptor(options.descriptor ?? openAiDecisionsDescriptor);
    if (!descriptor || descriptor.protocol !== 'openai-decisions' || descriptor.evaluator.providerId !== 'openai'
      || descriptor.wireModel !== 'gpt-6-luna' || descriptor.nativeDecision || descriptor.maxBillableOutputTokens !== 0
      || descriptor.compilation.readout !== 'openai-decisions-v1'
      || descriptor.compilation.templateDigest !== openAiDecisionsDescriptor.compilation.templateDigest
      || descriptor.compilation.schemaDigest !== openAiDecisionsDescriptor.compilation.schemaDigest
      || descriptor.definition.validationProfile.profile !== 'native-distribution-v1'
      || descriptor.definition.validationProfile.version !== 'v1') throw new Error('Invalid OpenAI Decisions descriptor.');
    this.descriptor = descriptor;
  }
  listModels() { return []; }
  listEvaluators() { return [{ ...this.descriptor.evaluator }]; }
  validateAuth(source?: AuthInput) {
    const auth = getSecretAuthMaterial(source);
    return { ok: auth?.type === 'environment-token' && auth.envVar === 'OPENAI_API_KEY' && typeof auth.token === 'string'
      && auth.token.trim().length > 0 && auth.token === auth.token.trim() && !/[\r\n]/.test(auth.token) };
  }
  async generate(_request: GenerateRequest): Promise<GenerateResponse> { throw new Error('Decisions does not support chat.'); }
  async stream(_request: StreamRequest): Promise<StreamResult> { throw new Error('Decisions does not support chat.'); }
  normalizeError(_error: unknown) { return { providerId: 'openai' as const, message: 'Decisions operation failed.', retryable: false }; }
  async decision(request: DecisionRequest, context?: ProviderRuntimeContext & { signal?: AbortSignal }): Promise<DecisionAdapterResult> {
    const empty = { usage: unreportedDecisionUsage('not-dispatched'), servedEvaluator: null, servedModelId: null };
    const failed = (code: Parameters<typeof createDecisionError>[0], phase: 'preflight' | 'dispatch' = 'preflight'): Extract<DecisionAdapterResult, { ok: false }> =>
      ({ ok: false, error: createDecisionError(code, phase), ...empty,
        ...(phase === 'dispatch' ? { usage: unreportedDecisionUsage('unknown') } : {}) });
    const encoded = encodeOpenAiDecisionsRequest(request, this.descriptor);
    if (!encoded.ok) return failed(encoded.code);
    if (!canExecuteDecisionCandidate(this.descriptor)) return failed('PROVIDER_UNAVAILABLE');
    const auth = getSecretAuthMaterial(context?.auth);
    if (!this.validateAuth(context?.auth).ok || auth?.type !== 'environment-token' || !auth.token) return failed('CREDENTIAL_MISSING');
    try {
      const result = await this.options.transport.send(encoded.bodyJson, auth.token,
        { signal: context?.signal, timeoutMs: encoded.request.policy?.timeoutMs });
      if (!result.ok) return { ...failed(result.error.code, 'dispatch'), error: result.error };
      const snapshot = snapshotBoundedJson(result.body);
      const body = snapshot.ok ? snapshot.value : null;
      if (isRecord(body) && typeof body.model === 'string' && body.model.includes(auth.token)) body.model = null;
      return decodeOpenAiDecisionsResponse(body, encoded.request, this.descriptor,
        result.providerRequestId?.includes(auth.token) ? undefined : result.providerRequestId);
    } catch { return failed('TRANSPORT_FAILED', 'dispatch'); }
  }
}
export const createOpenAiDecisionsAdapter = (options: OpenAiDecisionsAdapterOptions): OpenAiDecisionsAdapter => new OpenAiDecisionsAdapter(options);
