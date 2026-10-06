import type { JudgeError } from './errors.js';
import type { EvaluatorRef } from './request.js';
import type { JudgeUsage } from './receipt.js';
import type { JudgeVerdict } from './verdict.js';
import type { JudgeRequest } from './request.js';
import type { ProviderAdapter, ProviderRuntimeContext } from '../registry.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { AuthInput } from '../auth.js';
import { getSecretAuthMaterial } from '../auth.js';
import { getProviderProfile } from '../catalog.js';
import type { JevTransport, JevTransportResult } from '../transport/jev.js';
import { jevDescriptor } from './jev-descriptor.js';
import type { EvaluatorDescriptor } from './jev-descriptor.js';
import { parseEvaluatorDescriptor } from './descriptor-validation.js';
import { encodeJevRequest } from './jev-codec.js';
import { decodeJevResponse } from './jev-response.js';
import { createJudgeError, isJudgeErrorCode } from './errors.js';
import { unreportedJudgeUsage } from './receipt.js';
import { isRecord, snapshotBoundedJson } from './validation.js';

/** Adapter evidence stays available when verdict validation fails after dispatch. */
interface JudgeAdapterEvidence {
  usage: JudgeUsage;
  servedEvaluator: EvaluatorRef | null;
  servedModelId: string | null;
  providerRequestId?: string;
  providerLatencyMs?: number;
}

/** Implementations must validate verdict/usage independently and sanitize upstream IDs. */
export type JudgeAdapterResult = JudgeAdapterEvidence & (
  | { ok: true; verdict: JudgeVerdict }
  | { ok: false; error: JudgeError }
);

export interface JevAdapterOptions { transport: JevTransport; descriptor?: EvaluatorDescriptor }
export class JevAdapter implements ProviderAdapter {
  readonly provider = getProviderProfile('typesafe');
  readonly descriptor: EvaluatorDescriptor;
  constructor(private readonly options: JevAdapterOptions) {
    const descriptor = parseEvaluatorDescriptor(options.descriptor ?? jevDescriptor);
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
  async judge(request: JudgeRequest, context?: ProviderRuntimeContext & { signal?: AbortSignal }): Promise<JudgeAdapterResult> {
    const empty = { usage: unreportedJudgeUsage('not-dispatched'), servedEvaluator: null, servedModelId: null };
    const encoded = encodeJevRequest(request, this.descriptor);
    if (!encoded.ok) return { ok: false, error: createJudgeError(encoded.code, 'preflight'), ...empty };
    if (this.descriptor.qualification.servedIdentity !== 'qualified') {
      return { ok: false, error: createJudgeError('PROVIDER_UNAVAILABLE', 'preflight'), ...empty };
    }
    const auth = getSecretAuthMaterial(context?.auth);
    if (!this.validateAuth(context?.auth).ok || auth?.type !== 'environment-token' || !auth.token) {
      return { ok: false, error: createJudgeError('CREDENTIAL_MISSING', 'preflight'), ...empty };
    }
    let result: JevTransportResult;
    try { result = await this.options.transport.send(encoded.bodyJson, auth.token,
      { signal: context?.signal, timeoutMs: encoded.request.policy?.timeoutMs }); }
    catch { return { ok: false, error: createJudgeError('TRANSPORT_FAILED', 'dispatch'),
      ...empty, usage: unreportedJudgeUsage('unknown') }; }
    if (!result.ok) return { ok: false, error: createJudgeError(isJudgeErrorCode(result.error.code) ? result.error.code : 'TRANSPORT_FAILED',
      result.error.phase === 'parse' ? 'parse' : 'dispatch'), ...empty, usage: unreportedJudgeUsage('unknown') };
    const snapshot = snapshotBoundedJson(result.body);
    const body = snapshot.ok ? snapshot.value : null;
    if (isRecord(body) && typeof body.model === 'string' && body.model.includes(auth.token)) body.model = null;
    const requestId = result.providerRequestId?.includes(auth.token) ? undefined : result.providerRequestId;
    return decodeJevResponse(body, encoded.request, this.descriptor, requestId);
  }
}
export const createJevAdapter = (options: JevAdapterOptions): JevAdapter => new JevAdapter(options);
