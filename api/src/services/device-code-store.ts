/**
 * In-memory device-code store (RFC 8628-style) for headless device enrollment.
 *
 * A browserless binary (Sentropic Cowork) cannot present a browser session cookie,
 * so it obtains a session token pair via a device-code handshake:
 *   1. binary -> POST /auth/device/code              (issue a pending code)
 *   2. user   -> POST /auth/device/approve           (authenticated, links user + device name)
 *   3. binary -> POST /auth/device/poll (interval)   (consume on approval -> token pair)
 *
 * The store is process-scoped (mirrors `tab-registry.ts`): entries do not survive
 * server restarts. Codes are single-use, short-lived, and polling is throttled.
 */

import type { CoworkDeviceCapability } from './cowork/device-identity';

export type DeviceCodeStatus = 'pending' | 'approved' | 'denied';

export interface DeviceCodeEntry {
  deviceCode: string;
  userCode: string;
  status: DeviceCodeStatus;
  /** Requested device name (binary hint), overridden by the approver if provided. */
  requestedDeviceName: string | null;
  /** Set on approval. */
  userId: string | null;
  /** Role of the approving user, used to mint the session. */
  approvedRole: string | null;
  approvedDeviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Last poll timestamp, used to throttle (slow_down). */
  lastPolledAt: Date | null;
  /** Minimum seconds between polls. */
  intervalSec: number;
  /** Untrusted identity staged until both human approval and proof complete. */
  identity: PendingDeviceIdentity | null;
}

export interface PendingDeviceIdentity {
  deviceId: string;
  devicePublicKey: string;
  capabilities: CoworkDeviceCapability[];
  serverNonce: string;
}

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_INTERVAL_SEC = 5;
// user_code charset excludes ambiguous chars (0/O, 1/I) for readability.
const USER_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const byDeviceCode = new Map<string, DeviceCodeEntry>();
const byUserCode = new Map<string, DeviceCodeEntry>();

function randomUserCodeSegment(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += USER_CODE_CHARSET[bytes[i] % USER_CODE_CHARSET.length];
  }
  return out;
}

function generateUserCode(): string {
  // Format: PAIR-XXXX (collision-checked against active entries).
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `PAIR-${randomUserCodeSegment(4)}`;
    if (!byUserCode.has(code)) return code;
  }
  // Extremely unlikely; widen the segment to guarantee uniqueness.
  return `PAIR-${randomUserCodeSegment(6)}`;
}

function isExpired(entry: DeviceCodeEntry, now = Date.now()): boolean {
  return entry.expiresAt.getTime() <= now;
}

function purgeIfExpired(entry: DeviceCodeEntry | undefined): DeviceCodeEntry | undefined {
  if (!entry) return undefined;
  if (isExpired(entry)) {
    byDeviceCode.delete(entry.deviceCode);
    byUserCode.delete(entry.userCode);
    return undefined;
  }
  return entry;
}

export interface IssuedDeviceCode {
  deviceCode: string;
  userCode: string;
  intervalSec: number;
  expiresAt: Date;
  serverNonce: string | null;
}

export interface DeviceIdentityEnrollmentRequest {
  deviceId: string;
  devicePublicKey: string;
  capabilities: CoworkDeviceCapability[];
}

/**
 * Issue a new pending device code. No auth required (the binary is not yet enrolled).
 */
export function issueDeviceCode(
  requestedDeviceName?: string | null,
  enrollment?: DeviceIdentityEnrollmentRequest,
): IssuedDeviceCode {
  const now = new Date();
  const deviceCode = crypto.randomUUID();
  const userCode = generateUserCode();
  const entry: DeviceCodeEntry = {
    deviceCode,
    userCode,
    status: 'pending',
    requestedDeviceName: (requestedDeviceName || '').trim() || null,
    userId: null,
    approvedRole: null,
    approvedDeviceName: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_MS),
    lastPolledAt: null,
    intervalSec: DEFAULT_INTERVAL_SEC,
    identity: enrollment
      ? {
          ...enrollment,
          // 256 random bits exceeds BR-41c's 128-bit enrollment challenge floor.
          serverNonce: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
        }
      : null,
  };
  byDeviceCode.set(deviceCode, entry);
  byUserCode.set(userCode, entry);
  return {
    deviceCode,
    userCode,
    intervalSec: DEFAULT_INTERVAL_SEC,
    expiresAt: entry.expiresAt,
    serverNonce: entry.identity?.serverNonce ?? null,
  };
}

/** Read-only lookup used to verify enrollment proof before a code is consumed. */
export function findPendingDeviceIdentity(deviceCode: string): PendingDeviceIdentity | null {
  return purgeIfExpired(byDeviceCode.get((deviceCode || '').trim()))?.identity ?? null;
}

/**
 * Look up a pending entry by user_code (case-insensitive), purging if expired.
 */
export function findByUserCode(userCode: string): DeviceCodeEntry | undefined {
  const normalized = (userCode || '').trim().toUpperCase();
  if (!normalized) return undefined;
  return purgeIfExpired(byUserCode.get(normalized));
}

export type ApproveResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_resolved' };

/**
 * Approve a pending code, linking it to the authenticated user + device name.
 */
export function approveDeviceCode(
  userCode: string,
  userId: string,
  role: string,
  deviceName?: string | null,
): ApproveResult {
  const entry = findByUserCode(userCode);
  if (!entry) return { ok: false, reason: 'not_found' };
  if (entry.status !== 'pending') return { ok: false, reason: 'already_resolved' };
  entry.status = 'approved';
  entry.userId = userId;
  entry.approvedRole = role;
  entry.approvedDeviceName =
    (deviceName || '').trim() || entry.requestedDeviceName || 'Sentropic Cowork';
  return { ok: true };
}

export type PollOutcome =
  | { status: 'authorization_pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'proof_required' }
  | {
      status: 'approved';
      userId: string;
      role: string;
      deviceName: string;
      identity: PendingDeviceIdentity | null;
    };

/**
 * Poll a device code. Throttles via `slow_down` when polled faster than `interval`.
 * On approval, consumes the code (single-use) and returns the linked user + device name.
 */
export function pollDeviceCode(deviceCode: string, proofValid = false): PollOutcome {
  const entry = purgeIfExpired(byDeviceCode.get((deviceCode || '').trim()));
  if (!entry) return { status: 'expired' };

  const now = new Date();
  if (entry.lastPolledAt) {
    const elapsedSec = (now.getTime() - entry.lastPolledAt.getTime()) / 1000;
    if (elapsedSec < entry.intervalSec) {
      // Do not advance lastPolledAt on a throttled poll, so the client can retry
      // after the interval without being penalized again.
      return { status: 'slow_down' };
    }
  }
  entry.lastPolledAt = now;

  if (entry.status === 'denied') {
    byDeviceCode.delete(entry.deviceCode);
    byUserCode.delete(entry.userCode);
    return { status: 'denied' };
  }

  if (entry.status === 'approved' && entry.userId) {
    if (entry.identity && !proofValid) return { status: 'proof_required' };
    // Single-use: consume on approval delivery.
    byDeviceCode.delete(entry.deviceCode);
    byUserCode.delete(entry.userCode);
    return {
      status: 'approved',
      userId: entry.userId,
      role: entry.approvedRole || 'editor',
      deviceName: entry.approvedDeviceName || 'Sentropic Cowork',
      identity: entry.identity,
    };
  }

  return { status: 'authorization_pending' };
}

/**
 * Clear all entries (useful for tests).
 */
export function clearAll(): void {
  byDeviceCode.clear();
  byUserCode.clear();
}
