/**
 * L0 frozen profile declaration (immo #861, ask 1 shape, spec r2 section 2).
 *
 * Stable data shapes, bounds and version constants for explicit capability
 * selection and the effective publication profile, plus the frozen
 * provider-profile interfaces L1 compiles. No behavior: L1 wires these
 * shapes into the factories.
 */

import type { EffectiveArtifactCommand } from './command-identity-contract.js';
import type { JsonValue } from '../src/contracts.js';

/** Version of the frozen effective-profile shape. */
export const PROFILE_CONTRACT_VERSION = 'artifacts-profile/v1' as const;

/** All fifteen existing tool names, frozen (L1 wires the compiler to this set). */
export const KNOWN_ARTIFACT_TOOL_NAMES = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
] as const;

export type KnownArtifactToolName = (typeof KNOWN_ARTIFACT_TOOL_NAMES)[number];

/** Radar ask-1 selection: the only four tools the Radar host enables. */
export const RADAR_SELECTED_TOOL_NAMES = [
  'artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get',
] as const;

export type RadarSelectedToolName = (typeof RADAR_SELECTED_TOOL_NAMES)[number];

/**
 * Frozen C2 capability routes: selected capability, provider route and
 * Radar command. The adapter accepts exactly these four method/path
 * combinations, not an arbitrary HTTP proxy.
 */
export const RADAR_OPERATION_ROUTES = [
  { capability: 'artifacts_ensure', method: 'POST', path: '/ensure', command: 'ensure' },
  { capability: 'artifacts_publish', method: 'POST', path: '/publish', command: 'publish' },
  { capability: 'artifacts_list', method: 'POST', path: '/list', command: 'list' },
  { capability: 'artifacts_get', method: 'GET', path: '/meta/{artifactId}', command: 'meta' },
] as const;

export type RadarOperationRoute = (typeof RADAR_OPERATION_ROUTES)[number];

/** Host-bound invocation scope for the Radar selection. */
export const RADAR_INVOCATION_SCOPE = 'immo:read' as const;

/** Explicit capability selection: unknown and duplicate entries are rejected. */
export interface ToolSelection {
  readonly tools: readonly string[];
}

/** Closed effective-profile MIME allowlist for publish files. */
export const PROFILE_TEXT_MIME_TYPES = [
  'text/html', 'text/css', 'text/javascript', 'application/json',
] as const;

export type ProfileMimeType = (typeof PROFILE_TEXT_MIME_TYPES)[number];

/** First path segments a publish file must never use. */
export const PROFILE_RESERVED_FIRST_SEGMENTS = [
  'api', '__artifacts', 'livez', 'health',
] as const;

/** Frozen C4 bounds (UTF-16 code units unless noted). */
export const PROFILE_BOUNDS = {
  bindingNameMinUnits: 1,
  bindingNameMaxUnits: 128,
  idempotencyKeyMaxUnits: 256,
  publishFilesMin: 1,
  publishFilesMax: 32,
  maxDecodedFileBytes: 262144,
  maxDecodedTotalBytes: 262144,
  /** Candidate ceiling inherited from the existing provider validator. */
  pathMaxBytes: 1024,
  listLimitMin: 1,
  listLimitMax: 100,
  listLimitDefault: 20,
  listOffsetDefault: 0,
  /** The HTTP control route keeps its separate encoded-body budget. */
  httpControlMaxEncodedBytes: 2 * 1024 * 1024,
} as const;

/** Inputs that participate in composition integrity evidence. */
export const COMPOSITION_DIGEST_INPUTS = [
  'selection', 'profile', 'providerContractRevisions',
] as const;

/** One operation profile inside the effective profile. */
export interface OperationProfile {
  readonly operation: string;
  readonly limits: Record<string, number>;
  readonly defaults: Record<string, JsonValue | undefined>;
}

/** Immutable versioned effective profile driving one composition. */
export interface EffectiveProfile {
  readonly version: typeof PROFILE_CONTRACT_VERSION;
  readonly selection: ToolSelection;
  readonly operations: readonly OperationProfile[];
  readonly contractRevisions: Record<string, string>;
  readonly profileDigest: string;
}

/**
 * Frozen provider profile input: explicit selected tools, complete
 * operation profiles and required contract versions. Unknown and
 * duplicate entries are rejected; an empty selection exposes and
 * executes nothing; a missing selection fails construction.
 */
export interface ArtifactProviderProfile {
  readonly version: typeof PROFILE_CONTRACT_VERSION;
  readonly selectedCapabilities: readonly string[];
  readonly operations: readonly OperationProfile[];
  readonly contractRevisions: Record<string, string>;
}

/**
 * Compiled profile driving schema generation, validation, normalization,
 * defaults, command hashing and runtime limits. Selection, full profile
 * data and provider-contract revisions participate in the digest; a
 * semantic-only change invalidates the evidence even when JSON Schema
 * text is unchanged.
 */
export interface CompiledArtifactsProfile extends ArtifactProviderProfile {
  readonly schemas: Record<string, Record<string, unknown>>;
  readonly validators: CompiledValidators;
  readonly profileDigest: string;
}

/**
 * Compiled semantic validators and normalizers bound at profile compile
 * time. L1 implements them against the frozen operation profiles; L2/L6
 * consume them instead of reimplementing checks.
 */
export interface CompiledValidators {
  readonly validateBindingName: (value: unknown) => boolean;
  readonly validateCallerKey: (value: unknown) => boolean;
  readonly validateFileEntry: (entry: unknown) => boolean;
  readonly normalizeCommand: (command: unknown) => EffectiveArtifactCommand;
}

/** Compiler signature: L1 implements it against these frozen shapes. */
export type CompileArtifactsProfile = (
  input: ArtifactProviderProfile,
) => CompiledArtifactsProfile;

const isKnownToolName = (value: string): boolean =>
  (KNOWN_ARTIFACT_TOOL_NAMES as readonly string[]).includes(value);

/** Validate an explicit selection: reject unknown and duplicate entries. */
export function validateToolSelection(selection: ToolSelection): string[] {
  const errors: string[] = [];
  if (!Array.isArray(selection.tools)) return ['selection tools must be an array'];
  const seen = new Set<string>();
  for (const tool of selection.tools) {
    if (typeof tool !== 'string' || !isKnownToolName(tool)) {
      errors.push(`unknown capability: ${String(tool)}`);
      continue;
    }
    if (seen.has(tool)) errors.push(`duplicate capability: ${tool}`);
    seen.add(tool);
  }
  return errors;
}

/** Binding names are required strings of 1-128 UTF-16 code units, unnormalized. */
export function validateBindingName(value: unknown): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128;
}

/**
 * Caller idempotency keys: original string, trim() must be nonempty,
 * at most 256 UTF-16 code units. Whitespace around a nonempty value is
 * retained; no trimming or Unicode normalization is applied. Lone high
 * or low surrogates are rejected before UTF-8 conversion, derivation or
 * storage so distinct caller keys can never alias one durable identity
 * through replacement-character encoding.
 */
export function validateCallerIdempotencyKey(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > 256 || value.trim().length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff) return false;
    const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
    if (next < 0xdc00 || next > 0xdfff) return false;
    i++;
  }
  return true;
}

/** Radar publication files carry 1-32 entries within the decoded-byte budget. */
export function validatePublishFileCount(count: unknown): boolean {
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 32;
}

/** List bounds: integer limit 1-100, nonnegative integer offset. */
export function validateListBounds(limit: unknown, offset: unknown): boolean {
  return (
    typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 100 &&
    typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
  );
}
