export type GuardActionPolicy = 'audit_mask_copy' | 'mask_in_flight' | 'block';
export type GuardDetectorCategory = 'pii' | 'tech_secret';
export type GuardVerdict = 'pass' | 'masked' | 'blocked' | 'unavailable' | 'timeout';

export interface GuardFinding {
  readonly detectorId: string;
  readonly category: GuardDetectorCategory;
  readonly count: number;
  readonly action: GuardActionPolicy;
}

/** Branded payload guaranteed to have passed GuardEngine masking (zero raw path). */
export interface MaskedCapturePayload {
  readonly __maskedCapturePayload: true;
  readonly payload: unknown;
  readonly findings: readonly GuardFinding[];
  readonly truncated?: boolean;
}

export interface GuardScanResult {
  readonly verdict: GuardVerdict;
  readonly findings: readonly GuardFinding[];
  readonly inFlightPayload: unknown;
  readonly maskedCapture: MaskedCapturePayload;
}

export interface GuardTextScanResult {
  readonly maskedText: string;
  readonly findings: readonly GuardFinding[];
  readonly blocked: boolean;
}

export interface GuardPort {
  inspectRequest(payload: unknown): GuardScanResult;
  maskForCapture(payload: unknown): MaskedCapturePayload;
  scanText(text: string): GuardTextScanResult;
}

export interface ExternalGuardRequest {
  readonly version: '1';
  readonly stageId: string;
  readonly requestId: string;
  readonly phase: 'request' | 'response';
  readonly payload: MaskedCapturePayload;
  readonly deadlineMs: number;
}

export interface ExternalGuardResponse {
  readonly action: 'pass' | 'mask' | 'reject' | 'audit';
  readonly findings: readonly GuardFinding[];
  readonly maskedPayload?: MaskedCapturePayload;
}

/** Typed agentgateway.dev webhook contract — accepts MaskedCapturePayload only. */
export interface ExternalGuardPort {
  evaluate(request: ExternalGuardRequest, signal?: AbortSignal): Promise<ExternalGuardResponse>;
}
