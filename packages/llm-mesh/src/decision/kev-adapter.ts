import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { AuthInput } from '../auth.js';
import { getSecretAuthMaterial } from '../auth.js';
import { getProviderProfile } from '../catalog.js';
import type { DecisionRequest } from './request.js';
import type { DecisionAdapterResult } from './adapter.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import type { SystemOneLocalTransport } from '../transport/systemone-local.js';
import { kevDescriptor, parseKevDescriptor, KEV_SERVED_MODEL_ID } from './kev-descriptor.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevResponse } from './jev-response.js';
import { createDecisionError } from './errors.js';
import { unreportedDecisionUsage } from './receipt.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';
import { canExecuteDecisionCandidate } from './qualification.js';

export interface KevAdapterOptions { transport: SystemOneLocalTransport; descriptor?: DecisionEvaluatorDescriptor }
/** Explicit native local registration. Runtime lifecycle and filesystem custody remain host-owned. */
export class KevAdapter implements ProviderAdapter {
  readonly provider = { ...getProviderProfile('local'), label: 'Kev local System One', decisionOnly: true as const };
  readonly descriptor: DecisionEvaluatorDescriptor;
  constructor(private readonly options: KevAdapterOptions) {
    const descriptor = parseKevDescriptor(options.descriptor ?? kevDescriptor);
    if (!descriptor) throw new Error('Invalid Kev descriptor.');
    this.descriptor = descriptor;
  }
  listModels() { return []; }
  listEvaluators() { return [{ ...this.descriptor.evaluator }]; }
  validateAuth(source?: AuthInput) {
    const auth = getSecretAuthMaterial(source);
    return { ok: auth?.type === 'environment-token' && auth.envVar === 'KEV_LOCAL_API_KEY'
      && typeof auth.token === 'string' && auth.token.trim().length > 0 && auth.token === auth.token.trim()
      && !/[\r\n]/.test(auth.token) };
  }
  async generate(_request: GenerateRequest): Promise<GenerateResponse> { throw new Error('Kev does not support chat.'); }
  async stream(_request: StreamRequest): Promise<StreamResult> { throw new Error('Kev does not support chat.'); }
  normalizeError(_error: unknown) { return { providerId: 'local' as const, message: 'Kev operation failed.', retryable: false }; }
  async decision(request: DecisionRequest, context?: ProviderRuntimeContext & { signal?: AbortSignal }): Promise<DecisionAdapterResult> {
    const failed = (code: Parameters<typeof createDecisionError>[0], phase: 'preflight' | 'dispatch' | 'parse' = 'preflight'): DecisionAdapterResult =>
      ({ ok: false, error: createDecisionError(code, phase), servedEvaluator: null, servedModelId: null,
        usage: unreportedDecisionUsage(phase === 'preflight' ? 'not-dispatched' : 'unknown') });
    const encoded = encodeJevRequest(request, this.descriptor);
    if (!encoded.ok) return failed(encoded.code);
    if (!canExecuteDecisionCandidate(this.descriptor)) return failed('PROVIDER_UNAVAILABLE');
    const auth = getSecretAuthMaterial(context?.auth);
    if (!this.validateAuth(context?.auth).ok || auth?.type !== 'environment-token' || !auth.token) return failed('CREDENTIAL_MISSING');
    try {
      const result = await this.options.transport.send(encoded.bodyJson, auth.token,
        { signal: context?.signal, timeoutMs: encoded.request.policy?.timeoutMs });
      if (!result.ok) return { ...failed(result.error.code, 'dispatch'), error: result.error };
      const snapshot = snapshotBoundedJson(result.body, 65536);
      if (result.servedModelId !== KEV_SERVED_MODEL_ID) return failed('SERVED_IDENTITY_MISMATCH', 'parse');
      if (!snapshot.ok || !isRecord(snapshot.value)) return failed('VERDICT_INVALID', 'parse');
      const body = snapshot.value;
      if (typeof body.model === 'string' && body.model.includes(auth.token)) body.model = null;
      const decoded = decodeJevResponse(body, encoded.request, this.descriptor);
      if (!hasOnlyKeys(body, ['model', 'answers', 'usage'])) return {
        ...decoded, ok: false, error: createDecisionError('VERDICT_INVALID', 'parse') };
      if (decoded.ok && decoded.usage.tokens.output.value !== 0) return {
        ...decoded, ok: false, error: createDecisionError('USAGE_INVALID', 'parse') };
      return decoded;
    } catch { return failed('TRANSPORT_FAILED', 'dispatch'); }
  }
}
export const createKevAdapter = (options: KevAdapterOptions): KevAdapter => new KevAdapter(options);
