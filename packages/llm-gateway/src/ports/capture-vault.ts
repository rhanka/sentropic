import type { MaskedCapturePayload } from './guards.js';

export const TEN_JULIAN_YEAR_MS = 315_576_000_000;
export const DEFAULT_CAPTURE_RETENTION_MS = 2_592_000_000; // 30 days
export const DEFAULT_CAPTURE_ENABLED = false;
export const DEFAULT_WORKSTATION_CAPTURE_QUOTA_BYTES = 512 * 1024 * 1024;

export type CaptureRetention =
  | { readonly kind: 'none' }
  | { readonly kind: 'finite'; readonly durationMs: number };

/** Pure retention deadline helper mirroring @sentropic/cluster-mesh without importing it (DM6). */
export const computeCaptureRetentionDeadline = (
  retention: CaptureRetention,
  firstAdmissionAt: number,
): number | null => {
  if (!Number.isSafeInteger(firstAdmissionAt) || firstAdmissionAt < 0) {
    throw new RangeError('firstAdmissionAt must be a non-negative safe integer');
  }
  if (retention.kind === 'none') return null;
  if (!Number.isSafeInteger(retention.durationMs) || retention.durationMs <= 0 || retention.durationMs > TEN_JULIAN_YEAR_MS) {
    throw new RangeError(`capture retention durationMs must be within 1..${TEN_JULIAN_YEAR_MS}`);
  }
  return firstAdmissionAt + retention.durationMs;
};

export interface TurnCaptureWriteInput {
  readonly captureId?: string;
  readonly stageId: string;
  readonly ownerScopeRef: string;
  readonly requestId: string;
  readonly wire: string;
  readonly model: string;
  readonly requestCapture: MaskedCapturePayload;
  readonly responseCapture: MaskedCapturePayload;
  readonly createdAtMs?: number;
  readonly truncated?: boolean;
  readonly integrity?: string;
}

export interface TurnCaptureRecord {
  readonly captureId: string;
  readonly stageId: string;
  readonly ownerScopeRef: string;
  readonly requestId: string;
  readonly wire: string;
  readonly model: string;
  readonly keyId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number | null;
  readonly requestCapture: MaskedCapturePayload;
  readonly responseCapture: MaskedCapturePayload;
  readonly truncated: boolean;
  readonly integrity?: string;
}

export interface TurnCaptureWriteResult {
  readonly stored: boolean;
  readonly captureId?: string;
  readonly reason?: 'capture_disabled' | 'capture_quota_exceeded';
  readonly bytesStored?: number;
  readonly expiresAtMs?: number | null;
}

export interface TurnCapturePurgeReceipt {
  readonly purgedAtIso: string;
  readonly purgedCount: number;
  readonly freedBytes: number;
  readonly purgedCaptureIds: readonly string[];
}

export interface CaptureVaultPort {
  readonly enabled: boolean;
  writeTurnCapture(input: TurnCaptureWriteInput): Promise<TurnCaptureWriteResult>;
  readTurnCapture(input: { readonly ownerScopeRef: string; readonly captureId: string }): Promise<TurnCaptureRecord>;
  purgeExpiredCaptures(nowMs?: number): Promise<TurnCapturePurgeReceipt>;
}
