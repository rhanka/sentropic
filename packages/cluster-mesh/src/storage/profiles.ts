// K1 profile catalogue and capability negotiation (L3a v4.1 frozen §3).
// Data-pure: no backend, no enforcement; enforcement lives in K3/composition.

import { errResult, okResult, type ValidationResult } from './contracts.js';
import { UnsupportedProfileError } from './errors.js';

export const PROFILE_IDS = [
  'atomic-units-v1',
  'immutable-chains-v1',
  'immutable-boundaries-v1',
  'scope-outbox-v1',
  'visibility-barriers-v1',
  'staged-units-v1',
  'purge-jobs-v1',
  'generations-v1',
  'leased-snapshots-v1',
  'fenced-writers-v1',
  'restore-witness-v1',
] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const isProfileId = (value: unknown): value is ProfileId =>
  typeof value === 'string' && (PROFILE_IDS as readonly string[]).includes(value);

export interface ProfileClaim {
  readonly profile: ProfileId;
  readonly version: string;
  readonly digest: string;
}

export const validateProfileClaim = (claim: unknown): ValidationResult => {
  if (typeof claim !== 'object' || claim === null) return errResult('profile claim must be an object');
  const candidate = claim as Record<string, unknown>;
  if (!isProfileId(candidate['profile'])) return errResult('unknown profile id');
  if (typeof candidate['version'] !== 'string' || candidate['version'].length === 0) {
    return errResult('profile claim requires a version');
  }
  if (typeof candidate['digest'] !== 'string' || candidate['digest'].length === 0) {
    return errResult('profile claim requires a digest');
  }
  return okResult();
};

export const CONSUMER_REQUIREMENTS = {
  'm1-adapter': ['atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1'],
  'comments-operational': [
    'atomic-units-v1',
    'immutable-chains-v1',
    'immutable-boundaries-v1',
    'scope-outbox-v1',
    'visibility-barriers-v1',
  ],
  'comments-c4': [
    'atomic-units-v1',
    'immutable-chains-v1',
    'immutable-boundaries-v1',
    'scope-outbox-v1',
    'visibility-barriers-v1',
    'staged-units-v1',
  ],
  'comments-purge': [
    'atomic-units-v1',
    'immutable-chains-v1',
    'immutable-boundaries-v1',
    'scope-outbox-v1',
    'visibility-barriers-v1',
    'purge-jobs-v1',
    'fenced-writers-v1',
  ],
  'local-live': [
    'atomic-units-v1',
    'scope-outbox-v1',
    'generations-v1',
    'leased-snapshots-v1',
    'fenced-writers-v1',
  ],
  'product-live': [
    'atomic-units-v1',
    'scope-outbox-v1',
    'generations-v1',
    'leased-snapshots-v1',
    'fenced-writers-v1',
  ],
  'restore-witness': ['restore-witness-v1'],
} as const satisfies Record<string, readonly ProfileId[]>;

export type ConsumerClaim = keyof typeof CONSUMER_REQUIREMENTS;

export const missingProfiles = (
  advertised: readonly ProfileId[],
  required: readonly ProfileId[],
): readonly ProfileId[] => required.filter((profile) => !advertised.includes(profile));

export const satisfiesRequirements = (
  advertised: readonly ProfileId[],
  consumer: ConsumerClaim,
): boolean => missingProfiles(advertised, CONSUMER_REQUIREMENTS[consumer]).length === 0;

export const requireProfile = (advertised: readonly ProfileId[], profile: ProfileId): void => {
  if (!advertised.includes(profile)) throw new UnsupportedProfileError(profile);
};

// Frozen public catalogues (O6): PROFILE_IDS and CONSUMER_REQUIREMENTS are
// exported for adapters, so planting an entry through one handle must never
// widen negotiation on another. Every requirement list is frozen too.
Object.freeze(PROFILE_IDS);
for (const entry of Object.values(CONSUMER_REQUIREMENTS)) Object.freeze(entry);
Object.freeze(CONSUMER_REQUIREMENTS);
