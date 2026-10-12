// K1 registered descriptor, projection SPI and effective-change
// derivation (L3a v4 §6). Descriptors are trusted installed code.

import {
  errResult,
  isNonEmptyString,
  okResult,
  validatePageLimits,
  type ValidationResult,
} from './contracts.js';
import { isProfileId, type ProfileId } from './profiles.js';
import { UnsupportedProfileError } from './errors.js';

export const PROJECTION_CAUSES = [
  'atomic',
  'stage',
  'staged-publication',
  'generation-publication',
  'purge',
] as const;
export type ProjectionCause = (typeof PROJECTION_CAUSES)[number];

export const isProjectionCause = (value: unknown): value is ProjectionCause =>
  typeof value === 'string' && (PROJECTION_CAUSES as readonly string[]).includes(value);

export interface ModuleDescriptor {
  readonly contractVersion: string;
  readonly contractDigest: string;
  readonly schemaVersions: readonly string[];
  readonly requiredProfiles: readonly string[];
  readonly optionalProfiles: readonly string[];
  readonly chainKinds: readonly string[];
  readonly queryNames: readonly string[];
  readonly boundaries: readonly string[];
  readonly pageLimits: { readonly maxRecords: number; readonly maxEncodedBytes: number };
}

export const validateModuleDescriptor = (descriptor: ModuleDescriptor): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(descriptor.contractVersion)) errors.push('descriptor requires a contractVersion');
  if (!isNonEmptyString(descriptor.contractDigest)) errors.push('descriptor requires a contractDigest');
  if (!Array.isArray(descriptor.schemaVersions) || descriptor.schemaVersions.length === 0) {
    errors.push('descriptor requires at least one schema version');
  }
  const required: ProfileId[] = [];
  for (const profile of descriptor.requiredProfiles) {
    if (!isProfileId(profile)) errors.push(`unknown required profile: ${profile}`);
    else required.push(profile);
  }
  for (const profile of descriptor.optionalProfiles) {
    if (!isProfileId(profile)) errors.push(`unknown optional profile: ${profile}`);
    else if (required.includes(profile)) errors.push(`profile cannot be both required and optional: ${profile}`);
  }
  if (!Array.isArray(descriptor.chainKinds) || descriptor.chainKinds.length === 0) {
    errors.push('descriptor requires at least one chain kind');
  }
  const queries = new Set<string>();
  for (const query of descriptor.queryNames) {
    if (!isNonEmptyString(query)) errors.push('query names must be non-empty');
    else if (queries.has(query)) errors.push(`duplicate query name: ${query}`);
    else queries.add(query);
  }
  if (queries.size === 0) errors.push('descriptor requires at least one query');
  const limits = validatePageLimits(descriptor.pageLimits);
  if (!limits.ok) errors.push(limits.errors.join('; '));
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export interface AppliedEffect {
  readonly kind: 'record' | 'append' | 'index' | 'genesis';
  readonly key: string;
  readonly digest: string;
  readonly duplicate?: boolean;
}

export interface EffectiveChange {
  readonly kind: 'created' | 'appended' | 'index-changed';
  readonly key: string;
}

// Effective domain changes after duplicate classification (§6.4): identical
// genesis or immutable-record replay emits no new creation event, recovery
// returns existing identities, equal-digest replacement is an index change.
export const deriveEffectiveChanges = (applied: readonly AppliedEffect[]): EffectiveChange[] => {
  const changes: EffectiveChange[] = [];
  const seen = new Set<string>();
  for (const effect of applied) {
    if (effect.duplicate === true) continue;
    const identity = `${effect.kind}:${effect.key}:${effect.digest}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (effect.kind === 'genesis' || effect.kind === 'record') changes.push({ kind: 'created', key: effect.key });
    else if (effect.kind === 'append') changes.push({ kind: 'appended', key: effect.key });
    else changes.push({ kind: 'index-changed', key: effect.key });
  }
  return changes;
};

export interface ProjectionDelta {
  readonly cause: ProjectionCause;
  readonly records: readonly string[];
  readonly aggregates: readonly string[];
  readonly relationships: readonly string[];
  readonly barriers: readonly string[];
  readonly unitId?: string;
}

export const validateProjectionDelta = (delta: ProjectionDelta): ValidationResult => {
  if (!isProjectionCause(delta.cause)) return errResult('delta requires a known cause');
  return okResult();
};

export interface ModuleStorageHandle {
  readonly moduleId: string;
  readonly bind: (grant: unknown) => Promise<unknown>;
}

export interface ScopedModuleStorage {
  readonly moduleId: string;
  readonly profiles: readonly ProfileId[];
  readonly capability: (profile: ProfileId) => unknown;
}

export const validateCapabilityAcquisition = (
  advertised: readonly ProfileId[],
  profile: ProfileId,
): ValidationResult => {
  if (!isProfileId(profile)) return errResult('unknown profile id');
  if (!advertised.includes(profile)) return errResult(`profile not advertised: ${profile}`);
  return okResult();
};

export const acquireCapability = (advertised: readonly ProfileId[], profile: ProfileId): void => {
  const validity = validateCapabilityAcquisition(advertised, profile);
  if (!validity.ok) throw new UnsupportedProfileError(profile);
};
