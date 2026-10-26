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
