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
  readonly protectedViolation?: boolean;
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

export interface SecretMatch {
  /** UTF-16 code unit offset where the secret starts in the source string. */
  readonly start: number;
  /** Exclusive UTF-16 end offset. */
  readonly end: number;
  /** Rule id reporting the match (e.g. `custom:kubeconfig-token` or `@secretlint/...`). */
  readonly ruleId: string;
  /** Human-readable message (never contains raw secret value). */
  readonly message: string;
}

/** Structured user-supplied secret pattern (JavaScript regex). */
export interface CustomSecretPattern {
  /** Short identifier, surfaced in the redaction tag as `custom:<id>`. */
  readonly id: string;
  /** JavaScript regular-expression source. */
  readonly pattern: string;
  /** Regex flags; `g` is always enforced. Default `''`. */
  readonly flags?: string;
}

export interface SecretScanOptions {
  /** Optional logical file path for host adapters (e.g. L1.3d secretlint). */
  readonly filePath?: string;
  /** Extra structured regex patterns applied on top of default patterns. */
  readonly customPatterns?: readonly CustomSecretPattern[];
  /** Apply built-in KUBECONFIG_PATTERNS when true (default true). */
  readonly includeDefaultPatterns?: boolean;
}

/** Pure synchronous secret range scanner port (zero external dependencies). */
export interface SecretScannerPort {
  scan(text: string, options?: SecretScanOptions): readonly SecretMatch[];
  /** Optional pre-dedupe scan returning overlapping matches so policy evaluation sees every matching rule. */
  scanRaw?(text: string, options?: SecretScanOptions): readonly SecretMatch[];
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
