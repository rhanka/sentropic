// L01a common-rule data contract (frozen expected vectors live in
// tests/storage/common-rule/vectors.ts). Data-only: no I/O, no clock, no
// crypto and no encoder. Production encoding equivalence is checked from
// L02, never claimed here.

import {
  errResult,
  isHexDigest,
  isSafeInteger,
  isStorageModuleId,
  okResult,
  validateStorageScope,
  type StorageScope,
  type ValidationResult,
} from './contracts.js';

export const COMMON_CONTRACT_VERSION = '1' as const;
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
