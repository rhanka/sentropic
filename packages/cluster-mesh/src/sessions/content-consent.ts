import { createHash } from 'node:crypto';

/** Independently grantable D2 capabilities; all initially off. */
export type ContentChannel =
  | 'terminal.live'
  | 'terminal.cache'
  | 'native.mirror'
  | 'keyboard.control';

/** Retained-copy channels carrying an owner-selected retention policy. */
export type RetainedChannel = 'terminal.cache' | 'native.mirror';

export const RETAINED_CHANNELS: readonly RetainedChannel[] = ['terminal.cache', 'native.mirror'];
export const CONTENT_CHANNELS: readonly ContentChannel[] = [
  'terminal.live',
  'terminal.cache',
  'native.mirror',
  'keyboard.control',
];

export interface NoExpiryRetention {
  readonly mode: 'none';
}

export interface DurationRetention {
  readonly mode: 'duration';
  readonly durationSeconds: number;
}

/** Explicit tagged retention choice; default stored copies use `{ mode: 'none' }`. */
export type RetentionPolicy = NoExpiryRetention | DurationRetention;
export type RetentionByChannel = Record<RetainedChannel, RetentionPolicy>;

export type ContentConsentErrorCode =
  | 'invalid_request'
  | 'invalid_retention'
  | 'unsigned_retention'
  | 'policy_digest_mismatch'
  | 'challenge_replayed'
  | 'challenge_expired'
  | 'challenge_unknown'
  | 'project_not_found'
  | 'project_not_active'
  | 'project_revoked'
  | 'project_excluded'
  | 'session_excluded'
  | 'suppressed_scope'
  | 'ineligible_session'
  | 'cross_tenant_refused'
  | 'cross_project_refused'
  | 'cross_source_refused'
  | 'cross_owner_refused'
  | 'source_reauthorization_required'
  | 'history_authorization_required'
  | 'unprovable_range'
  | 'not_resumable'
  | 'live_expired'
  | 'lease_skew_exceeded'
  | 'grant_revoked'
  | 'grant_closed'
  | 'admin_read_refused'
  | 'membership_required';

export class ContentConsentError extends Error {
  constructor(
    readonly code: ContentConsentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContentConsentError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate the owner-selected per-channel retention map. Every retained
 * channel needs an explicit tagged choice: `{ mode: 'none' }` by default or
 * `{ mode: 'duration', durationSeconds }` with a positive safe-integer
 * duration. Omitted channels and untagged finite values fail as unsigned;
 * zero/negative/fractional/overflowing durations and unknown tags fail as
 * invalid. No environment/tenant/admin default is ever substituted here.
 */
export const validateRetentionByChannel = (value: unknown): RetentionByChannel => {
  if (!isRecord(value)) {
    throw new ContentConsentError('invalid_retention', 'retentionByChannel must be an object');
  }
  const result = {} as Record<RetainedChannel, RetentionPolicy>;
  for (const channel of RETAINED_CHANNELS) {
    const entry = value[channel];
    if (entry === undefined) {
      throw new ContentConsentError('unsigned_retention', `${channel} retention is required`);
    }
    if (!isRecord(entry) || typeof entry['mode'] !== 'string') {
      if (isRecord(entry) && typeof entry['durationSeconds'] === 'number') {
        throw new ContentConsentError('unsigned_retention', `${channel} retention mode is required`);
      }
      throw new ContentConsentError('invalid_retention', `${channel} retention is malformed`);
    }
    if (entry['mode'] === 'none') {
      result[channel] = { mode: 'none' };
    } else if (entry['mode'] === 'duration') {
      const seconds = entry['durationSeconds'];
      if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new ContentConsentError('invalid_retention', `${channel} durationSeconds must be a positive safe integer`);
      }
      result[channel] = { mode: 'duration', durationSeconds: seconds };
    } else {
      throw new ContentConsentError('invalid_retention', `${channel} retention mode is unknown`);
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

/** SHA-256 hex digest of the canonical policy; the source recomputes it. */
export const computePolicyDigest = (policy: unknown): string =>
  createHash('sha256').update(canonicalizePolicy(policy), 'utf8').digest('hex');

export const verifyPolicyDigest = (policy: unknown, digest: string): boolean =>
  computePolicyDigest(policy) === digest;
