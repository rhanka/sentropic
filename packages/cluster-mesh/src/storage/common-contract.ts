// L01a common-rule data contract (frozen expected vectors live in
// tests/storage/common-rule/vectors.ts). Data-only: no I/O, no clock, no
// crypto and no encoder. Production encoding equivalence is checked from
// L02, never claimed here.

import {
  errResult,
  isDecimalCounter,
  isHexDigest,
  isPositiveSafeInteger,
  isSafeInteger,
  okResult,
  validateStorageScope,
  validateWriterFence,
  type StorageScope,
  type ValidationResult,
  type WriterFence,
} from './contracts.js';

export const COMMON_CONTRACT_VERSION = '1' as const;
const COMMON_V1_MODULE_IDS = Object.freeze(['comments', 'engram-live'] as const);
const isCommonV1ModuleId = (value: unknown): boolean =>
  typeof value === 'string' && (COMMON_V1_MODULE_IDS as readonly string[]).includes(value);

export const KNOWN_COMMON_CONTRACT_VERSIONS: readonly string[] = ['1'];

export const isKnownCommonContractVersion = (value: unknown): value is string =>
  typeof value === 'string' && KNOWN_COMMON_CONTRACT_VERSIONS.includes(value);

export const COMMON_SURFACES = ['transactional', 'analytical', 'live-graph'] as const;
export type CommonSurface = (typeof COMMON_SURFACES)[number];

export const isCommonSurface = (value: unknown): value is CommonSurface =>
  typeof value === 'string' && (COMMON_SURFACES as readonly string[]).includes(value);

export const SOURCE_BOUNDARY_KINDS = ['journal-head', 'batch-snapshot', 'projection-generation'] as const;
export type SourceBoundaryKind = (typeof SOURCE_BOUNDARY_KINDS)[number];

export interface CommonSourceBoundary {
  readonly kind: SourceBoundaryKind;
  readonly ref: string;
}

export const validateCommonSourceBoundary = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('source boundary must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['kind'] !== 'string' || !(SOURCE_BOUNDARY_KINDS as readonly string[]).includes(candidate['kind'])) {
    return errResult('source boundary kind must be journal-head, batch-snapshot or projection-generation');
  }
  if (typeof candidate['ref'] !== 'string' || candidate['ref'].length === 0) {
    return errResult('source boundary ref must be a non-empty string');
  }
  return okResult();
};

export interface CommonObjectCommitment {
  readonly id: string;
  readonly locator: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export const validateCommonObjectCommitment = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('object commitment must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) return errResult('object id must be non-empty');
  if (typeof candidate['locator'] !== 'string' || candidate['locator'].length === 0) {
    return errResult('object locator must be non-empty');
  }
  if (!isSafeInteger(candidate['byteLength']) || candidate['byteLength'] < 0) {
    return errResult('object byteLength must be a safe integer >= 0');
  }
  if (!isHexDigest(candidate['sha256'])) return errResult('object sha256 must be 64 lowercase hex chars');
  return okResult();
};

export interface CommonUnitCommitment {
  readonly unitId: string;
  readonly roots: readonly string[];
}

export const validateCommonUnitCommitment = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('unit commitment must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['unitId'] !== 'string' || candidate['unitId'].length === 0) {
    return errResult('unit id must be non-empty');
  }
  if (!Array.isArray(candidate['roots']) || !candidate['roots'].every((entry) => typeof entry === 'string')) {
    return errResult('unit roots must be an array of strings');
  }
  return okResult();
};

export interface CommonManifestBody {
  readonly commonContract: string;
  readonly manifestVersion: string;
  readonly module: string;
  readonly scope: StorageScope;
  readonly surface: CommonSurface;
  readonly incarnation: string;
  readonly publicationId: string;
  readonly predecessorRoot: string | null;
  readonly sourceBoundary: CommonSourceBoundary;
  readonly schemaVersion: string;
  readonly descriptorVersion: string;
  readonly encodingVersion: string;
  readonly units: readonly CommonUnitCommitment[];
  readonly objects: readonly CommonObjectCommitment[];
  readonly terminal: { readonly count: string; readonly complete: boolean };
}

// The unknown-version refusal runs before any list is interpreted, so an
// unknown version never reaches an order interpreter or a version-specific
// canonicalization.
export const validateCommonManifestBody = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('manifest body must be an object');
  const candidate = value as Record<string, unknown>;
  if (!isKnownCommonContractVersion(candidate['commonContract'])) {
    return errResult('unknown common-contract version: refused before interpreting lists');
  }
  if (typeof candidate['manifestVersion'] !== 'string' || candidate['manifestVersion'].length === 0) {
    return errResult('manifest version must be non-empty');
  }
  if (!isCommonV1ModuleId(candidate['module'])) return errResult('module must be a known storage module');
  const scopeResult = validateStorageScope(candidate['scope']);
  if (!scopeResult.ok) return scopeResult;
  if (!isCommonSurface(candidate['surface'])) return errResult('surface must be a known common surface');
  if (typeof candidate['incarnation'] !== 'string' || candidate['incarnation'].length === 0) {
    return errResult('incarnation must be non-empty');
  }
  if (typeof candidate['publicationId'] !== 'string' || candidate['publicationId'].length === 0) {
    return errResult('publication id must be non-empty');
  }
  if (candidate['predecessorRoot'] !== null && typeof candidate['predecessorRoot'] !== 'string') {
    return errResult('predecessor root must be null or a string');
  }
  const boundaryResult = validateCommonSourceBoundary(candidate['sourceBoundary']);
  if (!boundaryResult.ok) return boundaryResult;
  for (const field of ['schemaVersion', 'descriptorVersion', 'encodingVersion'] as const) {
    const entry: unknown = candidate[field];
    if (typeof entry !== 'string' || entry.length === 0) {
      return errResult(`${field} must be non-empty`);
    }
  }
  if (!Array.isArray(candidate['units'])) return errResult('units must be an array');
  for (const unit of candidate['units']) {
    const unitResult = validateCommonUnitCommitment(unit);
    if (!unitResult.ok) return unitResult;
  }
  if (!Array.isArray(candidate['objects'])) return errResult('objects must be an array');
  for (const object of candidate['objects']) {
    const objectResult = validateCommonObjectCommitment(object);
    if (!objectResult.ok) return objectResult;
  }
  // The manifest digest is computed over the canonical body without its own
  // digest field, so the body carries no digest here: only the terminal
  // count/completeness commitment closes the inventory.
  if (typeof candidate['terminal'] !== 'object' || candidate['terminal'] === null) {
    return errResult('terminal must be an object');
  }
  const terminal = candidate['terminal'] as Record<string, unknown>;
  if (terminal['complete'] !== true) return errResult('terminal must be complete');
  if (!isDecimalCounter(terminal['count'])) return errResult('terminal count must be a decimal counter');
  const objects = candidate['objects'] as readonly unknown[];
  if (terminal['count'] !== String(objects.length)) return errResult('terminal count must equal the object count');
  return okResult();
};

export interface CommonPublicationCondition {
  readonly publicationId: string;
  readonly expectedPredecessor: string | null;
  readonly scope: StorageScope;
  readonly incarnation: string;
  readonly fence: WriterFence;
  readonly operationId: string;
}

export const validateCommonPublicationCondition = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('publication condition must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['publicationId'] !== 'string' || candidate['publicationId'].length === 0) {
    return errResult('publication id must be non-empty');
  }
  if (candidate['expectedPredecessor'] !== null && typeof candidate['expectedPredecessor'] !== 'string') {
    return errResult('expected predecessor must be null or a string');
  }
  const scopeResult = validateStorageScope(candidate['scope']);
  if (!scopeResult.ok) return scopeResult;
  if (typeof candidate['incarnation'] !== 'string' || candidate['incarnation'].length === 0) {
    return errResult('incarnation must be non-empty');
  }
  const fenceResult = validateWriterFence(candidate['fence']);
  if (!fenceResult.ok) return fenceResult;
  if (typeof candidate['operationId'] !== 'string' || candidate['operationId'].length === 0) {
    return errResult('operation id must be non-empty');
  }
  return okResult();
};

export interface CommonBoundedPage {
  readonly maxItems: number;
  readonly maxEncodedBytes: number;
  readonly continuation?: string;
}

export const validateCommonBoundedPage = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('bounded page must be an object');
  const candidate = value as Record<string, unknown>;
  if (!isPositiveSafeInteger(candidate['maxItems'])) return errResult('maxItems must be positive');
  if (!isPositiveSafeInteger(candidate['maxEncodedBytes'])) return errResult('maxEncodedBytes must be positive');
  if (candidate['continuation'] !== undefined && typeof candidate['continuation'] !== 'string') {
    return errResult('continuation must be an opaque string when present');
  }
  return okResult();
};

export const COMMON_RIGHTS = ['read', 'prepare', 'publish', 'maintain'] as const;
export type CommonRight = (typeof COMMON_RIGHTS)[number];

export interface CommonCapability {
  readonly principal: string;
  readonly rights: readonly CommonRight[];
  readonly scope: StorageScope;
  readonly policyRevision: string;
}

// Rights are explicit and never conferred: only listed rights are granted,
// and the empty set grants nothing.
export const validateCommonCapability = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('capability must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['principal'] !== 'string' || candidate['principal'].length === 0) {
    return errResult('principal must be non-empty');
  }
  if (!Array.isArray(candidate['rights']) || candidate['rights'].length === 0) {
    return errResult('rights must be a non-empty array');
  }
  const seen = new Set<string>();
  for (const right of candidate['rights']) {
    if (typeof right !== 'string' || !(COMMON_RIGHTS as readonly string[]).includes(right)) {
      return errResult('rights must only contain read, prepare, publish or maintain');
    }
    if (seen.has(right)) return errResult('rights must not repeat a right');
    seen.add(right);
  }
  const scopeResult = validateStorageScope(candidate['scope']);
  if (!scopeResult.ok) return scopeResult;
  if (typeof candidate['policyRevision'] !== 'string' || candidate['policyRevision'].length === 0) {
    return errResult('policy revision must be non-empty');
  }
  return okResult();
};

export const hasCommonRight = (capability: CommonCapability, right: CommonRight): boolean =>
  capability.rights.includes(right);
