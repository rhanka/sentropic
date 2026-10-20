import type { BackendScopeState } from './backend.js';
import { StorageCapacityExceededError, StorageDeniedError, StorageInvalidCommandError, UnsupportedProfileError } from './errors.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { opaqueId, ownedCopy, type StagedCore } from './staged-core.js';
import { stagedLimits } from './staged-operations.js';

export interface RootQueryPage { readonly records: readonly unknown[]; readonly nextCursor: unknown; readonly outcome?: 'page' | 'incomplete'; }
export interface RootQueryView {
  readHead(key: string): string | null;
  readRecord(key: string): unknown;
  readAggregate(key: string): unknown;
  relationships(relation: string, from: string, after: number, limit: number): RootQueryPage;
}
export interface RootQueryContext { readonly view: RootQueryView; readonly cursor: unknown; readonly limit: number; readonly maxEncodedBytes: number; }
export type RegisteredRootQuery = (input: unknown, context: RootQueryContext) => RootQueryPage;
export interface RootQueryRequest { readonly limit: number; readonly maxEncodedBytes: number; readonly cursor?: unknown; }
interface QueryCursor { readonly root: BackendScopeState; readonly ownerId: string; readonly query: string; readonly input: string; readonly position: unknown; }
const cursors = (core: StagedCore, bound: ScopedRuntime) => core.backend.controlState(bound.scope, 'root-query-cursors-v1', () => new Map<string, QueryCursor>());

export const queryRoot = (core: StagedCore, bound: ScopedRuntime, query: string, input: unknown, request: RootQueryRequest) => {
  bound.requireOperation('read');
  const registered = core.options.queries;
  if (!registered || !Object.hasOwn(registered, query) || !core.options.descriptor?.queryNames.includes(query)) throw new UnsupportedProfileError(`query:${query}`);
  const maximum = stagedLimits(core);
  const declared = core.options.descriptor.pageLimits;
  if (!Number.isSafeInteger(request.limit) || request.limit <= 0 || request.limit > Math.min(maximum.maxRecords, declared.maxRecords) ||
    !Number.isSafeInteger(request.maxEncodedBytes) || request.maxEncodedBytes <= 0 || request.maxEncodedBytes > Math.min(maximum.maxEncodedBytes, declared.maxEncodedBytes)) {
    throw new StorageInvalidCommandError('registered query exceeds declared page limits');
  }
  const identity = JSON.stringify(input);
  if (identity === undefined || Buffer.byteLength(identity, 'utf8') > maximum.maxEncodedBytes) throw new StorageInvalidCommandError('query input exceeds declared limits');
  const prior = request.cursor === undefined || request.cursor === null ? undefined : cursors(core, bound).get(String(request.cursor));
  if (request.cursor !== undefined && request.cursor !== null && (!prior || prior.query !== query || prior.input !== identity || prior.ownerId !== bound.grant.principalId)) throw new StorageInvalidCommandError('query continuation binding mismatch');
  const root = prior?.root ?? core.current(bound.scope);
  const current = core.current(bound.scope);
  const touched = new Set<string>();
  const check = (key: string) => { if (!core.accessible(current, key)) throw new StorageDeniedError('query subject is inaccessible'); touched.add(key); };
  const view: RootQueryView = Object.freeze({
    readHead: (key: string) => { check(key); return root.chains.get(key)?.head ?? null; },
    readRecord: (key: string) => { check(key); return ownedCopy(root.records.get(key) ?? null); },
    readAggregate: (key: string) => { check(key); return ownedCopy(root.aggregates.get(key) ?? null); },
    relationships: (relation: string, from: string, after: number, limit: number): RootQueryPage => {
      check(from);
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > request.limit) throw new StorageInvalidCommandError('invalid relationship window');
      const projections = core.data(root).projections;
      const total = projections.relationshipCount(relation, from);
      if (after > total) throw new StorageInvalidCommandError('relationship continuation exceeds captured root');
      const records: string[] = [];
      const end = Math.min(total, after + limit);
      for (let index = after; index < end; index += 1) {
        const target = projections.relationshipAt(relation, from, index)!;
        if (core.accessible(current, target)) { records.push(target); touched.add(target); }
      }
      return { records, nextCursor: end < total ? end : null };
    },
  });
  // The fixed reserve covers the opaque cursor and response framing; query
  // implementations receive the remaining payload budget and are checked.
  const result = registered[query](ownedCopy(input), { view, cursor: prior?.position ?? null, limit: request.limit, maxEncodedBytes: Math.max(0, request.maxEncodedBytes - 160) });
  if (!result || !Array.isArray(result.records) || result.records.length > request.limit) throw new StorageInvalidCommandError('registered query violated its result contract');
  bound.requireOperation('read');
  const latest = core.current(bound.scope);
  if ([...touched].some((key) => !core.accessible(latest, key))) throw new StorageDeniedError('query coverage changed before delivery');
  const position = result.nextCursor ?? null;
  const nextCursor = position === null ? null : opaqueId('query-cursor');
  const outcome = result.records.length === 0 && nextCursor !== null ? 'incomplete' as const : result.outcome ?? 'page' as const;
  const page = { outcome, records: ownedCopy(result.records), nextCursor };
  if ((page.records.length > 0 || nextCursor !== null) && Buffer.byteLength(JSON.stringify(page), 'utf8') > request.maxEncodedBytes) throw new StorageCapacityExceededError('query response exceeds its byte budget');
  if (nextCursor) cursors(core, bound).set(nextCursor, { root, ownerId: bound.grant.principalId, query, input: identity, position: ownedCopy(position) });
  return page;
};
