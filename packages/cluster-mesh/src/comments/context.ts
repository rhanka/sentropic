import { AsyncLocalStorage } from 'node:async_hooks';
import { CanonicalCommandError } from '@sentropic/comments';
import type { CanonicalStoreScope } from '@sentropic/comments';
import type { ScopeGrant } from '../storage/authority.js';
import type { KernelTransaction } from '../storage/scope-runtime.js';
import type { CommentsStorage, CommentsStorageBinding } from './storage-contracts.js';
import { sameScope } from './storage-schema.js';
import { CommentsTransportError } from './transport-contracts.js';
export interface CommentsRequest { readonly grant: ScopeGrant<unknown>; readonly storage: CommentsStorage; closed: boolean; }
interface CommentsTransaction { readonly request: CommentsRequest; readonly port: KernelTransaction; failed?: unknown; closed: boolean; }
const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
export const commentsError = (error: unknown): unknown => {
  if (error instanceof CanonicalCommandError || error instanceof CommentsTransportError) return error;
  const code = (error as { code?: string })?.code;
  if (code === 'denied' || code === 'cas-conflict' || code === 'idempotency-conflict' || code === 'invalid-command') return new CanonicalCommandError(code, 'Comments storage operation refused');
  return error;
};
export class StoredGenesisReplay {
  constructor(readonly value: unknown) {}
}
export class CommentsContext {
  readonly #requests = new AsyncLocalStorage<CommentsRequest>();
  readonly #transactions = new AsyncLocalStorage<CommentsTransaction>();
  constructor(readonly binding: CommentsStorageBinding) {}
  current(scope?: CanonicalStoreScope): CommentsRequest {
    const request = this.#requests.getStore();
    if (!request || request.closed || (scope && !sameScope(scope, request.grant.scope))) throw new CanonicalCommandError('denied', 'A live matching comments context is required');
    return request;
  }
  transaction(): KernelTransaction | null {
    const current = this.#transactions.getStore();
    if (!current) return null;
    if (current.closed || current.request !== this.current()) throw new CanonicalCommandError('denied', 'Comments transaction context differs or is closed');
    return current.port;
  }
  async enter<T>(supplied: ScopeGrant<unknown>, operation: () => Promise<T>): Promise<T> {
    const grant = JSON.parse(JSON.stringify(supplied)) as ScopeGrant<unknown>; freeze(grant);
    if (grant.moduleId !== 'comments' || this.binding.moduleId !== 'comments') throw new CanonicalCommandError('denied', 'Comments module binding mismatch');
    const storage = await this.binding.bind(grant).catch((error: unknown) => { throw commentsError(error); });
    const request: CommentsRequest = { grant, storage, closed: false };
    try { return await this.#requests.run(request, operation); }
    catch (error) { throw commentsError(error); }
    finally { request.closed = true; }
  }
  async invoke<T>(scope: CanonicalStoreScope, operation: (request: CommentsRequest, tx: KernelTransaction | null) => Promise<T>): Promise<T> {
    try {
      const request = this.current(scope); const tx = this.transaction();
      await this.binding.bind(request.grant);
      const result = await operation(request, tx);
      this.current(scope); return result;
    } catch (error) {
      const mapped = commentsError(error); const current = this.#transactions.getStore();
      if (current && !current.closed) current.failed = mapped;
      throw mapped;
    }
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const request = this.current(); const previous = this.#transactions.getStore();
    if (previous) {
      this.transaction();
      try { return await operation(); } catch (error) { previous.failed = error; throw error; }
    }
    return (await request.storage.transact({}, async (port) => {
      const transaction: CommentsTransaction = { request, port, closed: false };
      try {
        const result = await this.#transactions.run(transaction, operation);
        this.current(); if (transaction.failed) throw transaction.failed;
        return result;
      } finally { transaction.closed = true; }
    })).value;
  }
  async mutate<T>(operation: (port: KernelTransaction, standalone: boolean) => Promise<T>): Promise<T> {
    const existing = this.transaction();
    if (existing) return operation(existing, false);
    try { return await this.run(() => operation(this.transaction()!, true)); }
    catch (error) { if (error instanceof StoredGenesisReplay) return error.value as T; throw error; }
  }
}
