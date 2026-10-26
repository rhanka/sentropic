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
