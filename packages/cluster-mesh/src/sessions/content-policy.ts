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

export interface DurationRetention {
  readonly kind: 'duration';
  readonly durationSeconds: number;
}

/** Explicit tagged retention choice; default stored copies use `{ kind: 'none' }`. */
export type ChannelRetention = NoExpiryRetention | DurationRetention;

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
 * Validate the owner-selected per-channel retention map. Every retained
 * channel needs an explicit tagged choice: `{ kind: 'none' }` by default or
 * `{ kind: 'duration', durationSeconds }` with a positive safe-integer
 * duration. Omitted channels and untagged finite values fail as unsigned;
 * zero/negative/fractional durations and unknown tags fail as invalid. No
 * environment/tenant/admin default is ever substituted here.
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
      if (isRecord(entry) && typeof entry['durationSeconds'] === 'number') {
        throw new ContentPolicyError('unsigned_retention', `${channel} retention kind is required`);
      }
      throw new ContentPolicyError('invalid_retention', `${channel} retention is malformed`);
    }
    if (entry['kind'] === 'none') {
      result[channel] = { kind: 'none' };
    } else if (entry['kind'] === 'duration') {
      const seconds = entry['durationSeconds'];
      if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new ContentPolicyError(
          'invalid_retention',
          `${channel} durationSeconds must be a positive safe integer`,
        );
      }
      result[channel] = { kind: 'duration', durationSeconds: seconds };
    } else {
      throw new ContentPolicyError('invalid_retention', `${channel} retention kind is unknown`);
    }
  }
  return result;
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
