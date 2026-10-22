import type { CommonManifestBody, CommonObjectCommitment } from '../../../src/storage/common-contract.js';

export type { CommonManifestBody, CommonObjectCommitment };
export type ObjectRef = CommonObjectCommitment & { readonly scope: string; readonly version: string };
export interface EncodedManifest { bytes: Uint8Array; sha256: string }
export interface VerificationBudget { maxBytes: number; maxObjects: number }
export interface ObjectClient {
  create(ref: ObjectRef, bytes: Uint8Array): Promise<ObjectRef>;
  read(ref: ObjectRef, budget: VerificationBudget): Promise<Uint8Array>;
}
export interface ObjectFixture {
  clients: readonly [ObjectClient, ObjectClient];
  client(scope: string): ObjectClient;
  reopen(): ObjectFixture;
  encode(body: CommonManifestBody): EncodedManifest;
  verify(body: CommonManifestBody, digest: string, budget: VerificationBudget): Promise<void>;
  inspect(ref: ObjectRef): Uint8Array;
  fault(ref: ObjectRef, change: 'delete' | 'truncate' | 'corrupt' | 'scope' | 'version'): void;
  counters: { io: number; encodes: number; verifiedBytes: number };
}
export type ObjectFixtureFactory = () => ObjectFixture;
export const BUDGET: VerificationBudget = { maxBytes: 8192, maxObjects: 16 };
