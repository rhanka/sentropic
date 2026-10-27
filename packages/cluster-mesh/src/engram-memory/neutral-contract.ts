// C6 declaration design, independent of storage implementations and Engram imports.
// The byte hash of the final flattened declaration is assigned at packaging, not here.
export const MEMORY_NEUTRAL_CONTRACT = {
  name: 'engram-memory-neutral-contract',
  version: '1.0.0',
  declaration: 'contracts/engram-memory-neutral-contract-v1.d.ts',
  constructor: 'openModuleStorageCanonicalMemoryStoreV1',
  engramVersion: '0.21.1',
  contractVersion: 'memory-binding-v1',
  contractDigest: 'sha256:dff737ced37d801ef48bb4d7088fc4fbc92021d21fe2034ff33ea643b49bec28',
  genericContract: {
    name: 'l3a-generic-module-storage-port', version: 'v4.1',
    digest: 'c7111c9e7293ee270a0b4dde277f1cfc40fa3c863c3915c6f9ccdd6935c46294',
  },
} as const;

export const MEMORY_NEUTRAL_HANDLE_METHODS = [
  'transact', 'query', 'readAggregate', 'readCommitResult',
  'acquireFence', 'checkFence', 'releaseFence',
] as const;

export const MEMORY_NEUTRAL_TRANSACTION_METHODS = [
  'readAggregate', 'readRecords', 'readChain', 'findIdempotency', 'apply',
] as const;
export interface NeutralEncodedValue {
    readonly format: "utf8";
    readonly data: string;
}
export type NeutralChainExpectation = {
    readonly kind: "absent";
    readonly allocation: string;
} | {
    readonly kind: "head";
    readonly hash: string;
};
export interface NeutralRecordWrite {
    readonly kind: string;
    readonly key: string;
    readonly value: NeutralEncodedValue;
    readonly contentHash: string;
}
export interface NeutralChainAppend {
    readonly chain: string;
    readonly kind: string;
    readonly id: string;
    readonly hash: string;
    readonly value: NeutralEncodedValue;
    readonly expectation: NeutralChainExpectation;
}
export interface NeutralAggregateUpdate {
    readonly kind: string;
    readonly key: string;
    readonly value: NeutralEncodedValue;
    readonly version: string;
}
export interface NeutralIndexWrite {
    readonly index: string;
    readonly key: string;
    readonly value: NeutralEncodedValue;
}
/** Unused by the memory binding; carried for wire-shape fidelity with F §5.2. */
export interface NeutralRelationshipChange {
    readonly kind: string;
}
/** Unused by the memory binding; carried for wire-shape fidelity with F §5.2. */
export interface NeutralBarrierWrite {
    readonly kind: string;
}
/** Unused by the memory binding; carried for wire-shape fidelity with F §5.2. */
export interface NeutralAuthorizedPurgeIntent {
    readonly kind: string;
}
export interface NeutralGuard {
    readonly kind: "chain-head" | "chain-absent" | "aggregate-version";
    readonly chain?: string;
    readonly hash?: string;
    readonly allocation?: string;
    readonly aggregateKind?: string;
    readonly aggregateKey?: string;
    readonly version?: string;
}
export interface NeutralAtomicUnit {
    readonly guards: ReadonlyArray<NeutralGuard>;
    readonly records: ReadonlyArray<NeutralRecordWrite>;
    readonly appends: ReadonlyArray<NeutralChainAppend>;
    readonly updates: ReadonlyArray<NeutralAggregateUpdate>;
    readonly relationships: ReadonlyArray<NeutralRelationshipChange>;
    readonly barriers: ReadonlyArray<NeutralBarrierWrite>;
    readonly purgeIntents: ReadonlyArray<NeutralAuthorizedPurgeIntent>;
    readonly indexWrites: ReadonlyArray<NeutralIndexWrite>;
    readonly moduleResult?: NeutralEncodedValue;
}
export interface NeutralWorkLimits {
    readonly maxAppends: number;
    readonly maxRecords: number;
    readonly maxEncodedBytes: number;
}
export interface NeutralStorageScope {
    readonly tenantId: string;
    readonly workspaceId: string;
}
export type NeutralGrantLifetime = {
    readonly kind: "invocation";
    readonly invocationId: string;
} | {
    readonly kind: "lease";
    readonly expiresAt: string;
};
export interface NeutralScopeGrant {
    readonly token: string;
    readonly moduleId: string;
    readonly scope: NeutralStorageScope;
    readonly principalId: string;
    readonly operations: ReadonlyArray<string>;
    readonly issuer: string;
    readonly authorityRevision: string;
    readonly policyRevision: string;
    readonly lifetime: NeutralGrantLifetime;
}
export interface NeutralProfileClaim {
    readonly name: string;
    readonly version: string;
    readonly digest: string;
}
export interface NeutralModuleDescriptor {
    readonly contractVersion: string;
    readonly contractDigest: string;
    readonly schemaVersions: ReadonlyArray<string>;
    readonly requiredProfiles: ReadonlyArray<string>;
    readonly optionalProfiles: ReadonlyArray<string>;
    readonly chainKinds: ReadonlyArray<string>;
    readonly queryNames: ReadonlyArray<string>;
    readonly boundaries: ReadonlyArray<string>;
    readonly pageLimits: {
        readonly maxRecords: number;
        readonly maxEncodedBytes: number;
    };
}
export interface NeutralFenceProof {
    readonly fenceId: string;
    readonly epoch: string;
}
export interface NeutralWriterFence {
    readonly fenceId: string;
    readonly epoch: string;
}
export interface NeutralCommitOptions {
    readonly limits: NeutralWorkLimits;
    readonly idempotencyKey?: string;
    readonly grant: NeutralScopeGrant;
    /** Live acquisition identity: verified at entry, after waits, and at final commit validation. */
    readonly fence: NeutralWriterFence;
}
export interface NeutralCommitReceipt {
    readonly commitId: string;
    readonly journalCursor: string;
}
export interface NeutralAggregateRead {
    readonly kind: string;
    readonly key: string;
    readonly version: string;
    readonly value: NeutralEncodedValue;
}
export interface NeutralRecordRead {
    readonly kind: string;
    readonly key: string;
    readonly value: NeutralEncodedValue;
    readonly contentHash: string;
}
export interface NeutralChainRecord {
    readonly id: string;
    readonly hash: string;
    readonly value: NeutralEncodedValue;
}
export interface NeutralChainPage {
    readonly chain: string;
    readonly records: ReadonlyArray<NeutralChainRecord>;
}
export interface NeutralIdempotencySelector {
    readonly commitIdentity: string;
}
export interface NeutralIdempotencyEntry {
    readonly key: string;
    readonly intentHash: string;
    readonly moduleResult: NeutralEncodedValue;
}
export interface NeutralModuleTransaction {
    readAggregate(kind: string, key: string): Promise<NeutralAggregateRead | null>;
    readRecords(kind: string, keys: ReadonlyArray<string>): Promise<ReadonlyArray<NeutralRecordRead>>;
    readChain(input: {
        chain: string;
        afterAllocation?: string;
        limit: number;
    }): Promise<NeutralChainPage>;
    findIdempotency(selector: NeutralIdempotencySelector): Promise<NeutralIdempotencyEntry | null>;
    apply(unit: NeutralAtomicUnit): Promise<void>;
}
export interface NeutralMemoryHandle {
    readonly moduleId: string;
    readonly descriptor: NeutralModuleDescriptor;
    /** Closed backend class (G5 stays blocked: no Spanner member). */
    readonly backend: "memory" | "sqlite" | "postgres";
    readonly profiles: ReadonlyArray<NeutralProfileClaim>;
    transact<T>(options: NeutralCommitOptions, operation: (transaction: NeutralModuleTransaction) => Promise<T>): Promise<{
        readonly value: T;
        readonly receipt: NeutralCommitReceipt;
    }>;
    /** Registered named queries of §4.1 (JCS in, JCS out). */
    query(name: string, input: NeutralEncodedValue, grant: NeutralScopeGrant): Promise<NeutralEncodedValue>;
    /** Snapshot aggregate read outside a transaction (grant-checked). */
    readAggregate(kind: string, key: string, grant: NeutralScopeGrant): Promise<NeutralAggregateRead | null>;
    /**
     * Scoped, authority- and ownership-checked commit-result recovery (R-G4-7).
     * Null when absent. Optional: a port without it degrades post-restart
     * original-receipt replay to an explicit refusal (C4 open), never to a
     * recomputed substitute.
     */
    readCommitResult?(commitIdentity: string, grant: NeutralScopeGrant): Promise<NeutralEncodedValue | null>;
    /** Canonical-instance acquisition (R-G3-1): refuses a second live holder, never queues. */
    acquireFence(input: {
        scope: NeutralStorageScope;
        store_id: string;
        grant: NeutralScopeGrant;
    }): Promise<NeutralFenceProof>;
    /**
     * Freshness proof bound to the acquisition identity (binding §§9.3–9.6):
     * throws NeutralStorageError on loss, expiry, revocation, or epoch/fence mismatch.
     */
    checkFence(grant: NeutralScopeGrant, fence: NeutralWriterFence): Promise<void>;
    /** Acquisition-bound release: only the live holder clears the fence; a stale identity never clears a successor. */
    releaseFence(fence: NeutralWriterFence): Promise<void>;
}
/**
 * Grant-bound scoped surface returned by a binding `bind` call: the grant
 * is captured at bind time, so methods carry no per-call grant.
 */
export interface NeutralBoundScope {
    transact<T>(options: Omit<NeutralCommitOptions, "grant">, operation: (transaction: NeutralModuleTransaction) => Promise<T>): Promise<{
        readonly value: T;
        readonly receipt: NeutralCommitReceipt;
    }>;
    query(name: string, input: NeutralEncodedValue): Promise<NeutralEncodedValue>;
    readAggregate(kind: string, key: string): Promise<NeutralAggregateRead | null>;
    readCommitResult?(commitIdentity: string): Promise<NeutralEncodedValue | null>;
    acquireFence(input: {
        scope: NeutralStorageScope;
        store_id: string;
    }): Promise<NeutralFenceProof>;
    checkFence(fence: NeutralWriterFence): Promise<void>;
    releaseFence(fence: NeutralWriterFence): Promise<void>;
}
/**
 * Specified binding interface (binding §6.2, L3a §6.3): the composition
 * binds a grant to a scope and receives the scoped surface. The delivered
 * generic binding is synchronous while the Postgres binding is
 * asynchronous; the constructor awaits either shape and MUST NOT assume
 * one. A pre-bound flat NeutralMemoryHandle stays consumable as-is.
 */
export interface NeutralModuleStorageBinding {
    readonly moduleId: string;
    readonly descriptor: NeutralModuleDescriptor;
    /** Closed backend class (G5 stays blocked: no Spanner member). */
    readonly backend: "memory" | "sqlite" | "postgres";
    readonly profiles: ReadonlyArray<NeutralProfileClaim>;
    bind(grant: NeutralScopeGrant): NeutralBoundScope | Promise<NeutralBoundScope>;
}

/** Authoritative scope binding for one canonical store (binding §7.2). */
export interface MemoryScopeBindingV1 {
    /** The one L3a scope this store serves. */
    readonly scope: {
        readonly tenantId: string;
        readonly workspaceId: string;
    };
    /** Durable identity of this canonical store and its journal. */
    readonly store_id: string;
    /**
     * Host authority binding one opaque `scope_ref` to the tenant/workspace
     * pair it belongs to, or null when unknown. Composition-only: never
     * serialized into a memory DTO, a stored value, or a receipt.
     */
    readonly resolveScope: (scope_ref: string) => {
        readonly tenantId: string;
        readonly workspaceId: string;
    } | null;
}
/** Composition contract of the provisional constructor (amendment §1.2, binding §6.2). */
export interface ModuleStorageMemoryStoreOptionsV1 {
    /**
     * Host-provisioned neutral port for `moduleId: 'engram-memory'`: either a
     * pre-bound flat handle or a grant binding consumed synchronously or
     * asynchronously (binding §6.2, L3a §6.3). Engram never constructs a backend.
     */
    readonly handle: NeutralMemoryHandle | NeutralModuleStorageBinding;
    /** Authoritative scope binding for this store (binding §7). */
    readonly scope_binding: MemoryScopeBindingV1;
    /** Host-issued grant: module `engram-memory`, the bound scope, exactly `['read', 'write']`. */
    readonly grant: NeutralScopeGrant;
    /** Engram clock: the single time source for `committed_at` sampling and receipts. */
    readonly clock: { now(): string };
    /** Acquisition deadline for construction. */
    readonly deadline_at: string;
    /** Optional composition work limits: may raise a qualified bound, never weaken a refusal. */
    readonly work_limits?: MemoryWorkLimitsV1;
}
/** Composition work limits: upper bounds only (binding §4.3). */
export interface MemoryWorkLimitsV1 {
    readonly maxRecords?: number;
    readonly maxEncodedBytes?: number;
    /**
     * Maintenance expiry batch bounds (binding §4.3): expiry work observed by
     * a read commits in units of at most this many appends/records. Absent
     * means the descriptor batch defaults below. The declared ceiling is never
     * derived from observed work sizes.
     */
    readonly maintenance_max_appends?: number;
    readonly maintenance_max_records?: number;
}

// Installed 0.21.1 consumes structural error codes, never a shared Error class.
// Only fence failures latch the canonical instance; other errors permit retry/revalidation.
export const MEMORY_NEUTRAL_ERROR_MAPPING = {
  'fence-lost': { code: 'FENCE_LOST', terminal: true },
  'fence-conflict': { code: 'FENCE_LOST', terminal: true },
  unauthorized: { code: 'UNAUTHORIZED', terminal: false },
  'authorization-expired': { code: 'AUTHORIZATION_EXPIRED', terminal: false },
  'authorization-revoked': { code: 'AUTHORIZATION_REVOKED', terminal: false },
  'capability-unavailable': { code: 'CAPABILITY_UNAVAILABLE', terminal: false },
  'cas-conflict': { code: 'STORE_UNAVAILABLE', terminal: false },
  'digest-conflict': { code: 'DIGEST_CONFLICT', terminal: false },
  'limit-exceeded': { code: 'CAPABILITY_UNAVAILABLE', terminal: false },
  'store-unavailable': { code: 'STORE_UNAVAILABLE', terminal: false },
  'not-found': { code: 'NOT_FOUND', terminal: false },
  'invalid-schema': { code: 'INVALID_SCHEMA', terminal: false },
} as const;

export type NeutralStorageErrorCode = keyof typeof MEMORY_NEUTRAL_ERROR_MAPPING;
export interface NeutralStorageFailure { readonly code: NeutralStorageErrorCode }
