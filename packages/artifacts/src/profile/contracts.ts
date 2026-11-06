import type { JsonValue } from '../contracts.js';
import type { EffectiveArtifactCommand } from '../server/command-identity.js';

export const PROFILE_CONTRACT_VERSION = 'artifacts-profile/v1' as const;
export const ARTIFACT_CAPABILITY_NAMES = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore', 'artifacts_list_versions', 'artifacts_revert',
  'artifacts_lookup_people', 'artifacts_list_access',
  'artifacts_publish_bundle',
  'artifacts_revoke_reader_consent',
  // Files parity LOT 2 — appended last; frozen at birth like every definition above.
  'artifacts_create_upload_page',
  'artifacts_list_assets',
  'artifacts_publish_bundle_v2',
  'artifacts_list_app_sources', 'artifacts_fetch_app_source',
  'artifacts_git_attach', 'artifacts_git_commit', 'artifacts_git_publish', 'artifacts_git_live',
  'artifacts_live_write', 'artifacts_live_read', 'artifacts_live_reset',
  'artifacts_live_status', 'artifacts_live_control',
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
  /** G1 lock 1 (deployment): allow the `public` sharing mode; absent ⇒ closed. */
  readonly allowPublicSharing?: boolean;
}
export interface ArtifactProviderProfile {
  /** Trusted public contract revision; independent from the host policy revision. */
  readonly profileRevisionId?: string;
  /** Explicit projection switchover; omitted profiles retain the v1 wire shape. */
  readonly resultEnvelopeVersion?: 1 | 2;
  /** Require caller-supplied CAS preconditions on every publication writer. */
  readonly requireExpectedCurrentReleaseId?: boolean;
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
  readonly validators: CompiledValidators;
  readonly schemas: Readonly<Partial<Record<ArtifactCapabilityName, ArtifactSchema>>>;
  readonly idempotency: Readonly<Partial<Record<ArtifactCapabilityName,
    { readonly required: true; readonly scope: 'principal' }>>>;
  validate(name: string, args: unknown, envelopeKey?: string,
    options?: { deferPrecondition: true }): Readonly<Record<string, JsonValue>>;
  assertSelected(name: string): asserts name is ArtifactCapabilityName;
  capabilityForRoute(method: string, path: string): ArtifactCapabilityName | undefined;
}

export interface CompiledValidators {
  readonly validateBindingName: (value: unknown) => boolean;
  readonly validateCallerKey: (value: unknown) => boolean;
  readonly validateFileEntry: (entry: unknown) => boolean;
  readonly normalizeCommand: (command: unknown) => EffectiveArtifactCommand;
}

/** Projection fields are data-only; invocation correlation is added by L6. */
export const PRECONDITION_REQUIRED_MESSAGE = 'expectedCurrentReleaseId is required by the active artifact profile. Re-read this artifact with artifacts_get or artifacts_list, then send expectedCurrentReleaseId using the currentReleaseId returned by that read. Send null only if the read confirms that there is no current release. Before editing an existing release, read it with artifacts_get_source and use that releaseId. The server will not infer this value.';

export class ArtifactProfileInputError extends Error {
  readonly kind: 'operational' | 'ordinary';
  readonly status: number;
  readonly httpStatus: number;
  readonly variant: 'unselected_operation' | 'invalid_request' | 'precondition_required';
  readonly publicCode: string;
  readonly category: 'invalid_request' | 'capability_unselected' | 'precondition_required';
  readonly retriable = false;
  readonly phase: 'selection' | 'entry';
  readonly commitState = 'not_committed';
  constructor(unselected = false, preconditionRequired = false, readonly details?: Record<string, unknown>) {
    super(unselected ? 'capability_unavailable' : preconditionRequired ? 'precondition_required' : 'invalid_request');
    this.name = 'ArtifactProfileInputError';
    this.kind = unselected ? 'operational' : 'ordinary';
    this.status = unselected ? 503 : preconditionRequired ? 428 : 400;
    this.httpStatus = this.status;
    this.variant = unselected ? 'unselected_operation' : preconditionRequired ? 'precondition_required' : 'invalid_request';
    this.publicCode = this.message;
    this.category = unselected ? 'capability_unselected' : preconditionRequired ? 'precondition_required' : 'invalid_request';
    this.phase = unselected ? 'selection' : 'entry';
  }
}
