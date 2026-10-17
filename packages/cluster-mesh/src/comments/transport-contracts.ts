import type { CanonicalBatchImportRequest, CanonicalBatchImportResponse, CanonicalBatchExportRequest, CanonicalChainRecord, CanonicalReadSelection, CanonicalStoreScope, CommandCapability, ResourceRef } from '@sentropic/comments';
import type { CommitReceipt } from '../storage/atomic.js';
import type { WorkLimits, WriterFence } from '../storage/contracts.js';
export const COMMENTS_TRANSPORT_VERSION = 'comments-transport-v1' as const;
export const COMMENTS_TRANSPORT_LIMITS = Object.freeze({ manifestBytes: 65536, payloadBytes: 524288, requestItems: 50, batchManifestBytes: 262144, requestBytes: 1048576, defaultPage: 50, maxPage: 100, pageBytes: 1048576 });
export interface CommentsUnitRoot { readonly unitId: string; readonly records: string; readonly payloadDigest: string; }
export interface CommentsFragmentManifest {
  readonly scope: CanonicalStoreScope;
  readonly operationId: string;
  readonly bindingDigest: string;
  readonly unitId: string | null;
  readonly ordinal: string;
  readonly predecessorHash: string | null;
  readonly terminal: { readonly fragmentCount: string; readonly unitRoots: readonly CommentsUnitRoot[] } | null;
}
export interface CommentsFragment {
  readonly version: typeof COMMENTS_TRANSPORT_VERSION;
  readonly manifest: CommentsFragmentManifest;
  readonly payload: readonly CanonicalChainRecord[];
  readonly digest: string;
}
export interface CommentsImportBinding {
  readonly version: typeof COMMENTS_TRANSPORT_VERSION;
  readonly operationId: string;
  readonly request: CanonicalBatchImportRequest;
  readonly unitIds: readonly string[];
  readonly sourceBoundary: string;
  readonly targets: readonly ResourceRef[];
  readonly capabilities: readonly CommandCapability[];
}
export interface CommentsPrepareImportRequest { readonly binding: CommentsImportBinding; readonly fragment: CommentsFragment; readonly fence: WriterFence; }
export interface CommentsPreparedReference { readonly operationId: string; readonly bindingDigest: string; readonly rootReference: string; }
export interface CommentsFragmentAcknowledgement {
  readonly operationId: string; readonly ordinal: string; readonly fragmentDigest: string;
  readonly prepared: CommentsPreparedReference | null;
}
export interface CommentsCompleteReceipt {
  readonly version: typeof COMMENTS_TRANSPORT_VERSION;
  readonly operationId: string; readonly bindingDigest: string; readonly mappingVersion: string;
  readonly canonical: CanonicalBatchImportResponse;
  readonly units: readonly CommentsUnitRoot[];
  readonly kernel: CommitReceipt;
}
export interface CommentsCommitImportRequest { readonly request: CanonicalBatchImportRequest; readonly prepared: CommentsPreparedReference; readonly fence: WriterFence; readonly limits: WorkLimits; }
export interface CommentsExportSelection { readonly scope: CanonicalStoreScope; readonly exportId: string; readonly selections: readonly CanonicalReadSelection[]; readonly operationKeys?: readonly string[]; }
export interface CommentsExportBoundary {
  readonly version: typeof COMMENTS_TRANSPORT_VERSION; readonly boundaryDigest: string;
  readonly unitRoot: CommentsUnitRoot; readonly request: CanonicalBatchExportRequest;
}
export type CommentsExportPreparation = { readonly state: 'preparing'; readonly continuation: string; readonly work: { readonly records: number; readonly bytes: number } }
  | { readonly state: 'prepared'; readonly boundary: CommentsExportBoundary };
export interface CommentsExportFragmentPage { readonly fragments: readonly CommentsFragment[]; readonly nextCursor: string | null; }
export class CommentsTransportError extends Error {
  constructor(readonly condition: 'invalid-request' | 'conflict' | 'capacity-exceeded' | 'incomplete' | 'denied' | 'unavailable', message: string) { super(message); this.name = 'CommentsTransportError'; }
  get code() { return this.condition === 'invalid-request' ? 'invalid-command' as const : this.condition === 'conflict' ? 'idempotency-conflict' as const : this.condition === 'incomplete' ? 'unavailable' as const : this.condition; }
}
