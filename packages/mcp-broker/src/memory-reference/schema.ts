import type { MemoryMutationPreimageV1, MemoryMutationPolicyVersionsV1, MemoryConfirmationContinuationV1 } from '@sentropic/mcp-platform/memory';
export type WorkflowInput = {
  preimage: MemoryMutationPreimageV1; digest: string; policyVersions: MemoryMutationPolicyVersionsV1;
  resolved: Readonly<Record<string, unknown>>; audit: { auditId: string; correlationId: string };
};
export type CanonicalProof = {
  status: 'committed'; operationDigest: string; replayRef: string; result: unknown;
};
export type WorkflowRecord = {
  key: string; input: WorkflowInput; state: 'reserved' | 'executing' | 'unknown' | 'committed';
  fence: number; owner?: string; leaseUntil?: number;
  confirmation?: MemoryConfirmationContinuationV1; canonical?: CanonicalProof;
};
// No TTL deletion: reservations and canonical proof pointers prevent duplicate effects.
export const SCHEMA_V1 = `
CREATE TABLE workflow (key TEXT PRIMARY KEY, record TEXT NOT NULL CHECK(json_valid(record)));
CREATE TABLE policy (kind TEXT NOT NULL, version TEXT NOT NULL, value TEXT NOT NULL CHECK(json_valid(value)), PRIMARY KEY(kind, version));
PRAGMA user_version=1;
`;
