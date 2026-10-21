// @sentropic/cluster-mesh/engram-memory — public assembly module for the
// co-signed `engram-memory` module surface (contract memory-binding-v1).
// Importing this module opens no database, spawns no process, acquires no
// fence, registers no provider and performs no network access. The root
// package entry does not activate it.

export { MEMORY_MODULE_ID, MEMORY_CONTRACT_VERSION, MEMORY_CONTRACT_DIGEST } from './manifest.js';
export {
  MEMORY_REQUIRED_PROFILES,
  MEMORY_OPTIONAL_PROFILES,
  MEMORY_PINNED_PROFILES,
  MEMORY_QUERY_NAMES,
  MEMORY_BOUNDARIES,
  MEMORY_SCHEMA_VERSIONS,
  MEMORY_CHAIN_KINDS,
  MEMORY_RECORD_KINDS,
  MEMORY_AGGREGATE_KINDS,
  MEMORY_CODEC_MANIFEST,
  MEMORY_KEY_MANIFEST,
  MEMORY_POLICY_MANIFEST,
  MEMORY_KIND_MANIFEST,
  MEMORY_KEY_FORMATS,
  MEMORY_ASSET_MANIFEST,
  MEMORY_DESCRIPTOR,
  memoryContractManifest,
  memoryDescriptorDigest,
  checkMemoryContractDigest,
  type MemoryProfileClaim,
} from './manifest.js';
export {
  canonicalizeMemoryJcs,
  normalizeMemoryCanonicalJson,
  memoryRecordKey,
  memoryControlKey,
  memoryEnvelopeKey,
  memoryStateKey,
  memoryOutboxKey,
  memoryCaptureKey,
  memoryOutcomeKey,
  memoryStoreMetaKey,
  memoryLexicalKey,
  memoryLexicalTombstone,
  isMemoryLexicalTombstone,
  memoryJournalChain,
  memoryZeroHash,
  isCanonicalU64,
  compareU64,
  nextU64,
  maxU64,
  memoryUtf8,
  memoryJcs,
  MemoryCanonicalJsonError,
  type MemoryEncodedValue,
  type MemoryCanonicalJsonValue,
} from './codec.js';
export {
  MEMORY_SINGLE_EVENT_LIMITS,
  MEMORY_CAPTURE_COMPLETION_LIMITS,
  MEMORY_MAINTENANCE_LIMITS,
  MEMORY_IMPORT_LIMITS,
  MEMORY_STORAGE_LIMITS,
  requireMemoryStorageLimits,
} from './limits.js';
export {
  validateCaptureTransition,
  validateAdmissionTransition,
  isMemoryCaptureProof,
  isMemoryAdmissionOutcome,
  type MemoryCaptureProof,
  type MemoryAdmissionOutcome,
} from './validation.js';
export {
  classifyCommitReplay,
  validateCommitReplay,
  type MemoryCommitIdentity,
  type MemoryReplayDecision,
} from './replay-policy.js';
export {
  createMemoryPostgresRegistration,
  createMemoryPostgresStorage,
  resolveMemoryCurrentFromAggregates,
  validateMemoryEffects,
  type MemoryCurrentStateResolver,
  type MemoryPostgresRegistration,
  type MemoryStoredAggregate,
} from './postgres.js';
export {
  MEMORY_PG_QUERIES,
  memoryPgQuery,
  isMemoryQueryName,
  validateMemoryPageInput,
  validateMemoryRecordByIdInput,
  validateMemorySnapshotInput,
  type MemoryQueryName,
} from './postgres-queries.js';
export {
  createMemorySqliteRegistration,
  createMemorySqliteStorage,
  checkMemorySqliteDriver,
  MemoryHostDriverRequiredError,
  MEMORY_SQLITE_ENGINE_FLOOR,
  MEMORY_SQLITE_QUALIFICATION,
  type MemorySqliteDriverProvider,
  type MemorySqliteDriverIdentity,
  type MemorySqliteQualification,
  type MemorySqliteRegistration,
  type MemorySqliteStorageOptions,
} from './sqlite.js';
export {
  MEMORY_SQLITE_QUERIES,
  memorySqliteQuery,
  MEMORY_SQLITE_QUERY_NAMES,
} from './sqlite-queries.js';

/** Reserved trusted-service options for the memory module. No service is required in G1a. */
export interface MemoryServiceOptions {
  readonly services?: Record<string, never>;
}
