import type { CapacityDescriptor } from '@sentropic/comments';
import type { ScopeGrant } from '../storage/authority.js';
import type { CommitOptions, CommitReceipt, IdempotencyEntry } from '../storage/atomic.js';
import type { KernelTransaction, RecordPage } from '../storage/scope-runtime.js';
export interface CommentsStorage {
  readonly moduleId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>): Promise<{ readonly value: T; readonly receipt: CommitReceipt }>;
  readHead(chainId: string): Promise<string | null>;
  readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<RecordPage>;
  indexGet(key: string): Promise<IdempotencyEntry | null>;
}
export interface CommentsStorageBinding { readonly moduleId: string; bind(grant: ScopeGrant<unknown>): Promise<CommentsStorage>; }
export interface CommentsModuleOptions { readonly storage: CommentsStorageBinding; readonly capacity: CapacityDescriptor; }
