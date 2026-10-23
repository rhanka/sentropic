import type { JsonValue } from '../contracts.js';

export const PROFILE_CONTRACT_VERSION = 'artifacts-profile/v1' as const;
export const ARTIFACT_CAPABILITY_NAMES = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
] as const;
export type ArtifactCapabilityName = (typeof ARTIFACT_CAPABILITY_NAMES)[number];
export type ArtifactSchema = Readonly<Record<string, unknown>>;
export interface OperationProfile {
  readonly operation: string;
  readonly limits: Record<string, number>;
  readonly defaults: Record<string, JsonValue | undefined>;
}
export interface ArtifactProfileRules {
  readonly lengthUnit: 'utf16';
  readonly textEncoding: 'utf8';
  readonly callerKeyNormalization: 'none';
  readonly rejectLoneSurrogates: true;
  readonly provenance: 'inline-original';
  readonly keyDerivationAlgorithm: string;
  readonly pathMaxBytes: number;
  readonly forbiddenPathPattern: string;
  readonly reservedFirstSegments: readonly string[];
  readonly mimeTypes: readonly string[];
}
export interface ArtifactProviderProfile {
  readonly version: typeof PROFILE_CONTRACT_VERSION;
  readonly selectedCapabilities: readonly string[];
  readonly operations: readonly OperationProfile[];
  readonly contractRevisions: Record<string, string>;
  /** Omission selects the fixed v1 semantics, never a capability selection. */
  readonly rules?: ArtifactProfileRules;
}
export interface EffectiveArtifactProfile extends ArtifactProviderProfile {
  readonly rules: ArtifactProfileRules;
}
export interface CompiledArtifactsProfile extends EffectiveArtifactProfile {
  readonly selectedCapabilities: readonly ArtifactCapabilityName[];
  readonly profile: EffectiveArtifactProfile;
  readonly profileDigest: string;
  readonly schemas: Readonly<Partial<Record<ArtifactCapabilityName, ArtifactSchema>>>;
  readonly idempotency: Readonly<Partial<Record<ArtifactCapabilityName,
    { readonly required: true; readonly scope: 'principal' }>>>;
  validate(name: string, args: unknown, envelopeKey?: string): Readonly<Record<string, JsonValue>>;
  assertSelected(name: string): asserts name is ArtifactCapabilityName;
  capabilityForRoute(method: string, path: string): ArtifactCapabilityName | undefined;
}

/** Projection fields are data-only; invocation correlation is added by L6. */
export class ArtifactProfileInputError extends Error {
  readonly status: number;
  readonly httpStatus: number;
  readonly variant: 'unselected_operation' | 'invalid_request';
  readonly publicCode: string;
  readonly category: 'invalid_request' | 'capability_unselected';
  readonly retriable = false;
  readonly phase: 'selection' | 'validation';
  readonly commitState = 'not_committed';
  constructor(unselected = false) {
    super(unselected ? 'capability_unavailable' : 'invalid_request');
    this.name = 'ArtifactProfileInputError';
    this.status = unselected ? 503 : 400;
    this.httpStatus = this.status;
    this.variant = unselected ? 'unselected_operation' : 'invalid_request';
    this.publicCode = this.message;
    this.category = unselected ? 'capability_unselected' : 'invalid_request';
    this.phase = unselected ? 'selection' : 'validation';
  }
}
