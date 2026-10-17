import type { CapacityDescriptor } from '@sentropic/comments';
import type { ScopeGrant } from '../storage/authority.js';
import type { CommitOptions, CommitReceipt, IdempotencyEntry } from '../storage/atomic.js';
import type { KernelTransaction, RecordPage } from '../storage/scope-runtime.js';
import type { RootPurgeJob } from '../storage/staged-state.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../storage/staged-state.js';
import type { StagedCommitRoot } from '../storage/staged-units.js';
import type { WorkLimits, WriterFence } from '../storage/contracts.js';
export interface CommentsStorage {
  readonly moduleId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>): Promise<{ readonly value: T; readonly receipt: CommitReceipt }>;
  readHead(chainId: string): Promise<string | null>;
  readRecord(key: string): Promise<{ readonly bytes: { readonly format: 'utf8' | 'base64'; readonly data: string }; readonly contentHash: string } | null>;
  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<RecordPage>;
  indexGet(key: string): Promise<IdempotencyEntry | null>;
  invoke?(name: string, input: unknown): Promise<unknown>;
  completePurge?(intentId: string): Promise<RootPurgeJob>;
  sealStep?(input: { readonly unit: AuthenticatedStagedHandle; readonly root: StagedCommitRoot; readonly fence: WriterFence; readonly limits: WorkLimits }): Promise<{ readonly work: { readonly items: number; readonly appends: number; readonly bytes: number }; readonly seal?: AuthenticatedStagedSeal }>;
  commitStaged?(input: { readonly seal: AuthenticatedStagedSeal; readonly fence: WriterFence }): Promise<CommitReceipt>;
}
export interface CommentsStorageBinding { readonly moduleId: string; bind(grant: ScopeGrant<unknown>): Promise<CommentsStorage>; }
export interface CommentsModuleOptions { readonly storage: CommentsStorageBinding; readonly capacity: CapacityDescriptor; }
