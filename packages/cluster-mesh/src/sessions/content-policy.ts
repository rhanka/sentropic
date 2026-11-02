import { createHash } from 'node:crypto';

/** Frozen supplement format for the RC2 content-policy proposal (contract §10). */
export const POLICY_FORMAT = 'h2a.session-content-policy/1';
export const POLICY_DIGEST_DOMAIN = 'h2a.session-content-policy/1/policy\0';

/** The 17 frozen policy-supplement record names (contract §10). */
export const FROZEN_POLICY_RECORDS: readonly string[] = [
  'ContentPolicyV1',
  'ContentPolicyIntentV1',
  'ContentPolicyProposalV1',
  'ContentPolicyChallengeRequestV1',
  'ContentPolicyNonceV1',
  'ContentPolicyNonceAckV1',
  'ContentPolicyEvidenceRequestV1',
  'ContentPolicyIdpClaimsV1',
  'ContentPolicyIdpEvidenceV1',
  'ContentPolicyAppAttestationV1',
  'ContentPolicyProofV1',
  'ContentPolicyActivationAckV1',
  'ContentPolicyActivationReceiptV1',
  'ContentPolicySubmissionV1',
  'ContentPolicyCaptureGrantV1',
  'ContentPolicyCaptureAckV1',
  'ContentPolicyCaptureReceiptV1',
];

/** Independently grantable policy channels; all start off. */
export type PolicyChannelName =
  | 'session.events'
  | 'terminal.live'
  | 'terminal.cache'
  | 'native.mirror';

export const POLICY_CHANNELS: readonly PolicyChannelName[] = [
  'session.events', 'terminal.live', 'terminal.cache', 'native.mirror',
];

/** Channels carrying an owner-selected retained copy. */
export type RetainedPolicyChannel = 'session.events' | 'terminal.cache' | 'native.mirror';

export const RETAINED_POLICY_CHANNELS: readonly RetainedPolicyChannel[] = [
  'session.events',
  'terminal.cache',
  'native.mirror',
];

export interface NoExpiryRetention {
  readonly kind: 'none';
}

export interface FiniteRetention {
  readonly kind: 'finite';
  readonly durationMs: number;
}

/**
 * Explicit v1 product interoperability cap: ten Julian years
 * (10 * 365.25 * 86400000 ms), per contract annex E (r2 W-P3-3).
 * It is not a statutory retention obligation.
 */
export const TEN_JULIAN_YEAR_MS = 315576000000;

/** Explicit tagged retention choice; default stored copies use `{ kind: 'none' }`. */
export type ChannelRetention = NoExpiryRetention | FiniteRetention;

export type ContentPolicyErrorCode =
  | 'invalid_request'
  | 'invalid_retention'
  | 'unsigned_retention'
  | 'policy_digest_mismatch'
  | 'r15_unaccepted'
  | 'revision_conflict';

export class ContentPolicyError extends Error {
  constructor(
    readonly code: ContentPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContentPolicyError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate the owner-selected per-channel retention map against the frozen
 * ContentPolicyV1 shape. Every retained channel needs an explicit tagged
 * choice: `{ kind: 'none' }` (no expiry, not disabled storage) or
 * `{ kind: 'finite', durationMs }` with an integer 1..TEN_JULIAN_YEAR_MS.
 * Omitted channels and untagged finite values fail as unsigned;
 * zero/negative/fractional/over-cap durations and unknown tags fail as
 * invalid. No environment/tenant/admin default is ever substituted here.
 */
export const validateChannelRetention = (
  value: unknown,
): Record<RetainedPolicyChannel, ChannelRetention> => {
  if (!isRecord(value)) {
    throw new ContentPolicyError('invalid_retention', 'retention map must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!RETAINED_POLICY_CHANNELS.includes(key as RetainedPolicyChannel)) {
      throw new ContentPolicyError('invalid_request', `unknown retention channel ${key}`);
    }
  }
  const result = {} as Record<RetainedPolicyChannel, ChannelRetention>;
  for (const channel of RETAINED_POLICY_CHANNELS) {
    const entry = value[channel];
    if (entry === undefined) {
      throw new ContentPolicyError('unsigned_retention', `${channel} retention is required`);
    }
    if (!isRecord(entry) || typeof entry['kind'] !== 'string') {
      if (isRecord(entry) && typeof entry['durationMs'] === 'number') {
        throw new ContentPolicyError('unsigned_retention', `${channel} retention kind is required`);
      }
      throw new ContentPolicyError('invalid_retention', `${channel} retention is malformed`);
    }
    if (entry['kind'] === 'none') {
      result[channel] = { kind: 'none' };
    } else if (entry['kind'] === 'finite') {
      const durationMs = entry['durationMs'];
      if (
        typeof durationMs !== 'number' || !Number.isSafeInteger(durationMs)
        || durationMs <= 0 || durationMs > TEN_JULIAN_YEAR_MS
      ) {
        throw new ContentPolicyError(
          'invalid_retention',
          `${channel} durationMs must be an integer in 1..${TEN_JULIAN_YEAR_MS}`,
        );
      }
      result[channel] = { kind: 'finite', durationMs };
    } else {
      throw new ContentPolicyError('invalid_retention', `${channel} retention kind is unknown`);
    }
  }
  return result;
};

/**
 * r2 annex E retention-deadline evaluator (W-P3-3), matching
 * vectors/r2-semantics.json `retentionDeadline`: `none` means no expiry
 * (null), `finite` gives firstAdmissionAt+durationMs set once, with
 * safe-integer overflow rejection. Amend/read/replay/import/reconnect
 * never extend the result; the caller stores it immutably.
 */
export const computeRetentionDeadline = (
  retention: ChannelRetention,
  firstAdmissionAt: number,
): number | null => {
  if (retention.kind === 'none') return null;
  if (!Number.isSafeInteger(firstAdmissionAt)) {
    throw new ContentPolicyError('invalid_retention', 'firstAdmissionAt must be a safe integer');
  }
  if (retention.durationMs > TEN_JULIAN_YEAR_MS) {
    throw new ContentPolicyError('invalid_retention', 'durationMs exceeds the ten-Julian-year product cap');
  }
  const deadline = firstAdmissionAt + retention.durationMs;
  if (!Number.isSafeInteger(deadline)) {
    throw new ContentPolicyError('invalid_retention', 'retention deadline overflows a safe integer');
  }
  return deadline;
};

/** Canonical JSON with sorted keys so both authorities hash the same bytes. */
export const canonicalizePolicy = (policy: unknown): string => {
  if (Array.isArray(policy)) return `[${policy.map(canonicalizePolicy).join(',')}]`;
  if (isRecord(policy)) {
    const keys = Object.keys(policy).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizePolicy(policy[key])}`).join(',')}}`;
  }
  return JSON.stringify(policy) ?? 'null';
};

/** Policy digest under the frozen supplement domain (contract §10). */
export const computePolicyDigest = (policy: unknown): string =>
  createHash('sha256')
    .update(POLICY_DIGEST_DOMAIN, 'utf8')
    .update(canonicalizePolicy(policy), 'utf8')
    .digest('hex');

export const verifyPolicyDigest = (policy: unknown, digest: string): boolean =>
  computePolicyDigest(policy) === digest;
