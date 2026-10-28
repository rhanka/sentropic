// engram-memory fenced neutral-handle factory (E10a): builds the neutral handle
// Engram consumes from installed bytes only, through injected host ports.
import { MEMORY_DESCRIPTOR, MEMORY_PINNED_PROFILES } from './manifest.js';
import { MemoryHostDriverRequiredError } from './sqlite.js';
import { StorageDeniedError, StorageInvalidCommandError, StorageUnavailableError } from '../storage/errors.js';
import type { EncodedValue, StorageScope, WriterFence } from '../storage/contracts.js';
import type { ScopeGrant } from '../storage/authority.js';
import type { MemoryHostBinding } from './binding.js';
import {
  createMemoryNeutralTransaction, memoryNeutralFailure, neutralQueryResult,
  requireMemoryUtf8, withMemoryCaptureReceipt, type MemoryKernelTransactionPort,
} from './wire-adaptation.js';
import type {
  NeutralAtomicUnit, NeutralCommitReceipt, NeutralMemoryHandle, NeutralScopeGrant, NeutralWriterFence,
} from './neutral-contract.js';

export interface MemoryNeutralBoundPort {
  transact<T>(options: unknown, operation: (tx: MemoryKernelTransactionPort) => Promise<T>):
    Promise<{ readonly value: T; readonly receipt: unknown }>;
  readAggregate(key: string): Promise<{ readonly version: number;
    readonly value: EncodedValue } | null>;
  readCommitResult(identity: string, fence: NeutralWriterFence): Promise<EncodedValue | null>;
  query(name: string, input: unknown, request: { readonly limit: number }):
    Promise<{ readonly records: readonly unknown[] }>;
}
export interface MemoryNeutralKernelPort {
  bind(grant: ScopeGrant<unknown>): Promise<MemoryNeutralBoundPort>;
  readonly ownership: {
    readonly handle: { readonly instanceId: string; readonly storageEpoch: string };
    verify(session: MemoryNeutralHostSession): Promise<void>; release(): Promise<void>;
  } | null;
  provisionFence(grant: ScopeGrant<unknown>, fence: WriterFence): Promise<void>;
}
export interface MemoryNeutralHostSession {
  execute(statement: { readonly text: string; readonly values: readonly unknown[] }):
    Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[] }>;
}
export interface MemoryNeutralHostDriver {
  transaction<T>(options: { readonly isolation: 'serializable'; readonly readOnly: boolean;
    readonly deadlineMs: number }, operation: (session: MemoryNeutralHostSession) => Promise<T>): Promise<T>;
}
export interface CreateMemoryNeutralHandleInput {
  readonly kernel: MemoryNeutralKernelPort; readonly binding: MemoryHostBinding;
  readonly driver: MemoryNeutralHostDriver; readonly schemaName: string; readonly scope?: StorageScope;
}
export interface MemoryNeutralHandleAssembly {
  readonly handle: NeutralMemoryHandle;
  readonly getFence: () => NeutralWriterFence | undefined; readonly units: NeutralAtomicUnit[];
}
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// R-G3-1 (neutral-contract.ts): refuse a second live holder, never queue.
// A reservation also excludes concurrent acquisitions before the first await.
const liveFences = new WeakMap<MemoryNeutralKernelPort, NeutralWriterFence | symbol>();

export const createMemoryNeutralHandle = (input: CreateMemoryNeutralHandleInput): MemoryNeutralHandleAssembly => {
  if (typeof input?.kernel !== 'object' || input.kernel === null
    || typeof input.kernel.bind !== 'function' || !input.kernel.ownership) {
    throw new StorageUnavailableError('memory neutral handle requires the opened kernel');
  }
  if (typeof input?.driver !== 'object' || input.driver === null || typeof input.driver.transaction !== 'function') {
    throw new MemoryHostDriverRequiredError('memory neutral handle requires the injected host driver');
  }
  if (typeof input?.binding !== 'object' || input.binding === null || !input.binding.memoryGrant) {
    throw new StorageDeniedError('memory neutral handle requires the assembled host binding');
  }
  if (typeof input?.schemaName !== 'string' || !SCHEMA_NAME.test(input.schemaName)) {
    throw new StorageInvalidCommandError('memory neutral handle requires a valid host schema name');
  }
  const { kernel, binding, driver, schemaName } = input;
  const scope: StorageScope = input.scope ?? binding.memoryGrant.scope;
  const units: NeutralAtomicUnit[] = [];
  let fence: NeutralWriterFence | undefined;
  let acquired = false;
  const castGrant = (grant: NeutralScopeGrant): ScopeGrant<unknown> => {
    if (grant.moduleId !== 'engram-memory' || grant.scope.tenantId !== scope.tenantId
      || grant.scope.workspaceId !== scope.workspaceId) {
      throw Object.assign(new Error('grant differs from the bound memory scope'), { code: 'unauthorized' });
    }
    return grant as ScopeGrant<unknown>;
  };
  const guarded = async <T,>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { return memoryNeutralFailure(error); }
  };
  const handle: NeutralMemoryHandle = {
    moduleId: 'engram-memory', backend: 'postgres' as const, descriptor: MEMORY_DESCRIPTOR,
    profiles: MEMORY_PINNED_PROFILES.filter((claim) =>
      (MEMORY_DESCRIPTOR.requiredProfiles as readonly string[]).includes(claim.name)),
    acquireFence: (acquire) => {
      const pending = Symbol('acquiring');
      return guarded(async () => {
        if (acquired || liveFences.has(kernel)) {
          throw Object.assign(new Error('a live canonical holder already owns this kernel'), { code: 'fence-conflict' });
        }
        liveFences.set(kernel, pending);
        if (JSON.stringify(acquire.scope) !== JSON.stringify(scope)) {
          throw Object.assign(new Error('foreign acquisition scope'), { code: 'unauthorized' });
        }
        await kernel.bind(castGrant(acquire.grant));
        await driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 5000 }, async (session) => {
          await kernel.ownership!.verify(session);
          await session.execute({ text: `CREATE TABLE IF NOT EXISTS "${schemaName}".host_memory_identity`
            + '(scope text PRIMARY KEY,store_id text UNIQUE NOT NULL)', values: [] });
          await session.execute({ text: `INSERT INTO "${schemaName}".host_memory_identity(scope,store_id)`
            + ' VALUES($1,$2) ON CONFLICT DO NOTHING', values: [JSON.stringify(scope), acquire.store_id] });
          const rows = await session.execute({ text: `SELECT scope,store_id FROM "${schemaName}".host_memory_identity`
            + ' WHERE scope=$1 OR store_id=$2', values: [JSON.stringify(scope), acquire.store_id] });
          if (rows.rows.length !== 1 || rows.rows[0]!['scope'] !== JSON.stringify(scope)
            || rows.rows[0]!['store_id'] !== acquire.store_id) {
            throw Object.assign(new Error('store_id and scope must be bijective'), { code: 'fence-conflict' });
          }
          await kernel.ownership!.verify(session);
        });
        fence = { fenceId: kernel.ownership!.handle.instanceId, epoch: kernel.ownership!.handle.storageEpoch };
        await kernel.provisionFence(binding.memoryGrant, fence);
        liveFences.set(kernel, fence);
        acquired = true;
        return fence;
      }).catch((error) => {
        if (liveFences.get(kernel) === pending) { liveFences.delete(kernel); fence = undefined; }
        throw error;
      });
    },
    checkFence: (grant, supplied) => guarded(async () => {
      await kernel.bind(castGrant(grant));
      if (!fence || supplied.fenceId !== fence.fenceId || supplied.epoch !== fence.epoch) {
        throw Object.assign(new Error('canonical fence differs'), { code: 'fence-lost' });
      }
      // Binding §§9.3–9.6 requires a fresh ownership proof on loss/expiry.
      await driver.transaction({ isolation: 'serializable', readOnly: true, deadlineMs: 5000 },
        (session) => kernel.ownership!.verify(session));
    }),
    releaseFence: (supplied) => guarded(async () => {
      if (fence?.fenceId === supplied.fenceId && fence?.epoch === supplied.epoch) {
        await kernel.ownership!.release(); acquired = false; fence = undefined;
        liveFences.delete(kernel);
      }
    }),
    transact: (options, operation) => guarded(async () => {
      const bound = await kernel.bind(castGrant(options.grant));
      const result = await bound.transact(options, (tx) =>
        operation(createMemoryNeutralTransaction(tx, { units, identity: options.idempotencyKey })));
      return { value: result.value, receipt: result.receipt as NeutralCommitReceipt };
    }),
    readAggregate: (kind, key, grant) => guarded(async () => {
      const bound = await kernel.bind(castGrant(grant));
      const row = await bound.readAggregate(key);
      if (!row) return null;
      const value = await withMemoryCaptureReceipt(key, row.value, async (controlKey) => {
        const control = await bound.readAggregate(controlKey);
        return control?.value ?? null;
      });
      return { kind, key, version: String(row.version), value };
    }),
    readCommitResult: (identity, grant) => guarded(async () => {
      if (!fence) throw Object.assign(new Error('canonical fence is absent'), { code: 'fence-lost' });
      const result = await (await kernel.bind(castGrant(grant))).readCommitResult(identity, fence);
      return result === null ? null : requireMemoryUtf8(result);
    }),
    query: (name, encoded, grant) => guarded(async () => {
      const queryInput = JSON.parse(encoded.data) as { limit?: number; max_candidates?: number };
      const bound = await kernel.bind(castGrant(grant));
      const page = await bound.query(name, queryInput, { limit: queryInput.limit ?? queryInput.max_candidates ?? 2000 });
      return neutralQueryResult(name, page.records);
    }),
  };
  Object.freeze(handle);
  return Object.freeze({ handle, getFence: () => fence, units });
};
