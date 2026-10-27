import type { DecisionError } from './errors.js';
import type { EvaluatorRef } from './request.js';
import type { DecisionUsage } from './receipt.js';
import type { DecisionVerdict } from './verdict.js';
import type { DecisionRequest } from './request.js';
import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { AuthInput } from '../auth.js';
import { getSecretAuthMaterial } from '../auth.js';
import { getProviderProfile } from '../catalog.js';
import type { JevTransport, JevTransportResult } from '../transport/jev.js';
import { jevDescriptor } from './descriptor.js';
import type { DecisionEvaluatorDescriptor } from './descriptor.js';
import { parseDecisionEvaluatorDescriptor } from './descriptor-validation.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevResponse } from './jev-response.js';
import { createDecisionError, isDecisionErrorCode } from './errors.js';
import { unreportedDecisionUsage } from './receipt.js';
import { isRecord, snapshotBoundedJson } from './validation.js';
import { makeJevProviderRaw } from './raw.js';
import { canExecuteDecisionCandidate } from './qualification.js';

/** Adapter evidence stays available when verdict validation fails after dispatch. */
interface DecisionAdapterEvidence {
  usage: DecisionUsage;
  servedEvaluator: EvaluatorRef | null;
  servedModelId: string | null;
  providerRequestId?: string;
  providerLatencyMs?: number;
}

/** Implementations must validate verdict/usage independently and sanitize upstream IDs. */
export type DecisionAdapterResult = DecisionAdapterEvidence & (
  | { ok: true; verdict: DecisionVerdict }
  | { ok: false; error: DecisionError }
);

export interface JevAdapterOptions { transport: JevTransport; descriptor?: DecisionEvaluatorDescriptor }
export class JevAdapter implements ProviderAdapter {
  readonly provider = getProviderProfile('typesafe');
  readonly descriptor: DecisionEvaluatorDescriptor;
  constructor(private readonly options: JevAdapterOptions) {
    const descriptor = parseDecisionEvaluatorDescriptor(options.descriptor ?? jevDescriptor);
    if (!descriptor) throw new Error('Invalid JEV descriptor.');
    this.descriptor = descriptor;
  }
  listModels() { return []; }
  listEvaluators() { return [{ ...this.descriptor.evaluator }]; }
  validateAuth(source?: AuthInput) {
    const auth = getSecretAuthMaterial(source);
    return { ok: auth?.type === 'environment-token' && auth.envVar === 'JEV_API_KEY'
      && typeof auth.token === 'string' && auth.token.trim().length > 0 && auth.token === auth.token.trim()
      && !/[\r\n]/.test(auth.token) };
  }
  async generate(_request: GenerateRequest): Promise<GenerateResponse> { throw new Error('JEV does not support chat.'); }
  async stream(_request: StreamRequest): Promise<StreamResult> { throw new Error('JEV does not support chat.'); }
  normalizeError(_error: unknown) { return { providerId: 'typesafe' as const, message: 'JEV operation failed.', retryable: false }; }
  async decision(request: DecisionRequest, context?: ProviderRuntimeContext & { signal?: AbortSignal }): Promise<DecisionAdapterResult> {
    const empty = { usage: unreportedDecisionUsage('not-dispatched'), servedEvaluator: null, servedModelId: null };
    const encoded = encodeJevRequest(request, this.descriptor);
    if (!encoded.ok) return { ok: false, error: createDecisionError(encoded.code, 'preflight'), ...empty };
    if (!canExecuteDecisionCandidate(this.descriptor)) {
      return { ok: false, error: createDecisionError('PROVIDER_UNAVAILABLE', 'preflight'), ...empty };
    }
    const auth = getSecretAuthMaterial(context?.auth);
    if (!this.validateAuth(context?.auth).ok || auth?.type !== 'environment-token' || !auth.token) {
      return { ok: false, error: createDecisionError('CREDENTIAL_MISSING', 'preflight'), ...empty };
    }
    let result: JevTransportResult;
    try { result = await this.options.transport.send(encoded.bodyJson, auth.token,
      { signal: context?.signal, timeoutMs: encoded.request.policy?.timeoutMs }); }
    catch { return { ok: false, error: createDecisionError('TRANSPORT_FAILED', 'dispatch'),
      ...empty, usage: unreportedDecisionUsage('unknown') }; }
    if (!result.ok) return { ok: false, error: createDecisionError(isDecisionErrorCode(result.error.code) ? result.error.code : 'TRANSPORT_FAILED',
      result.error.phase === 'parse' ? 'parse' : 'dispatch'), ...empty, usage: unreportedDecisionUsage('unknown') };
    const snapshot = snapshotBoundedJson(result.body);
    const body = snapshot.ok ? snapshot.value : null;
    if (isRecord(body) && typeof body.model === 'string' && body.model.includes(auth.token)) body.model = null;
    const requestId = result.providerRequestId?.includes(auth.token) ? undefined : result.providerRequestId;
    const decoded = decodeJevResponse(body, encoded.request, this.descriptor, requestId);
    if (decoded.ok && isRecord(body) && isRecord(body.answers)) {
      const raw = makeJevProviderRaw(body.answers.verdict, encoded.request);
      if (raw) decoded.verdict.providerRaw = raw;
    }
    return decoded;
  }
}
export const createJevAdapter = (options: JevAdapterOptions): JevAdapter => new JevAdapter(options);
