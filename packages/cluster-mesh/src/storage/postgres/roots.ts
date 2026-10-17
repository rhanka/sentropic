import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { StorageScope } from '../contracts.js';
import type { CommitReceipt } from '../atomic.js';
import { StorageCasConflictError, StorageInvalidCommandError } from '../errors.js';
import { decodePgBytes, decodePgCounter, decodePgJson, decodePgText, decodePgUtf8 } from './codec.js';
import { PostgresStorageError } from './errors.js';
import { quotePgIdentifier, validatePgLayout, type PgSession, type PostgresStorageOptions } from './protocol.js';

export interface PgRoot { readonly root: string | null; readonly version: string; readonly sequence: string; }
export const pgMapKey = (kind: string, id: string): string => JSON.stringify([kind, id]);
export const pgScopeKey = (module: string, scope: StorageScope): string => JSON.stringify([module, scope.tenantId, scope.workspaceId]);
export const pgJsonBytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');
export class PgRoots {
  readonly #preparation = new AsyncLocalStorage<string>();
  readonly schema: string;
  readonly options: PostgresStorageOptions;
  constructor(options: PostgresStorageOptions, readonly incarnation: string) {
    this.options = { ...options, layout: validatePgLayout(options.layout) };
    this.schema = quotePgIdentifier(this.options.layout.dataSchema);
  }
  key(scope: StorageScope): string { return pgScopeKey(this.options.moduleId, scope); }
  preparing<T>(unitId: string, operation: () => Promise<T>): Promise<T> { return this.#preparation.run(unitId, operation); }
  preparationUnit(): string | undefined { return this.#preparation.getStore(); }
  async capture(session: PgSession, scope: StorageScope, lock = false): Promise<PgRoot> {
    const key = this.key(scope);
    if (lock) await session.execute({ text: `INSERT INTO ${this.schema}.scopes(key,module,tenant,workspace,incarnation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO NOTHING`, values: [key, this.options.moduleId, scope.tenantId, scope.workspaceId, this.incarnation] });
    const result = await session.execute({ text: `SELECT root::text,version::text,sequence::text,incarnation FROM ${this.schema}.scopes WHERE key=$1${lock ? ' FOR UPDATE' : ''}`, values: [key] });
    const row = result.rows[0];
    if (!row) return { root: null, version: '0', sequence: '0' };
    if (decodePgText(row.incarnation) !== this.incarnation) throw new PostgresStorageError('corruption');
    return { root: row.root === null ? null : decodePgCounter(row.root), version: decodePgCounter(row.version), sequence: decodePgCounter(row.sequence) };
  }
  async get<T>(session: PgSession, root: string | null, kind: string, id: string): Promise<T | null> {
    const result = await session.execute({ text: `SELECT ${this.schema}.map_get($1::bigint,$2) AS value`, values: [root, pgMapKey(kind, id)] });
    const value = result.rows[0]?.value;
    if (value === null) return null;
    return decodePgJson(decodePgUtf8(value)) as T;
  }
  async put(session: PgSession, root: string | null, kind: string, id: string, value: unknown): Promise<string> {
    const result = await session.execute({ text: `SELECT ${this.schema}.map_put($1::bigint,$2,$3) AS root`, values: [root, pgMapKey(kind, id), value === null ? null : pgJsonBytes(value)] });
    return decodePgCounter(result.rows[0]?.root);
  }
  async page(session: PgSession, root: string | null, position: string, limit: number): Promise<readonly { key: string; value: unknown }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024) throw new StorageInvalidCommandError('invalid map page');
    const result = await session.execute({ text: `SELECT * FROM ${this.schema}.map_page($1::bigint,$2::bigint,$3::integer)`, values: [root, position, limit] });
    return result.rows.map((row) => ({ key: decodePgText(row.key), value: row.value === null ? null : decodePgJson(decodePgUtf8(row.value)) }));
  }
  async payload(session: PgSession, scope: StorageScope, target: string, bytes: Uint8Array, hash: string): Promise<string> {
    const id = randomUUID();
    await session.execute({ text: `INSERT INTO ${this.schema}.payloads(id,scope_key,target,bytes,hash,prepared_unit) VALUES($1,$2,$3,$4,$5,$6)`, values: [id, this.key(scope), target, Buffer.from(bytes), hash, this.#preparation.getStore() ?? null] });
    return id;
  }
  async readPayload(session: PgSession, scope: StorageScope, id: string): Promise<Buffer> {
    const result = await session.execute({ text: `SELECT bytes,erased FROM ${this.schema}.payloads WHERE id=$1 AND scope_key=$2`, values: [id, this.key(scope)] });
    const row = result.rows[0];
    if (!row || row.erased === true || row.bytes === null) throw new PostgresStorageError('unavailable');
    return decodePgBytes(row.bytes);
  }
  async publish(session: PgSession, scope: StorageScope, base: PgRoot, root: string | null, receipt: CommitReceipt, operationKey?: string, sealedSegment = false): Promise<void> {
    const next = (BigInt(base.version) + 1n).toString();
    const sequence = (BigInt(base.sequence) + 1n).toString();
    const changed = await session.execute({ text: `UPDATE ${this.schema}.scopes SET root=$1::bigint,version=version+1,sequence=sequence+1 WHERE key=$2 AND version=$3::bigint AND incarnation=$4 RETURNING version::text`, values: [root, this.key(scope), base.version, this.incarnation] });
    if (changed.rows.length !== 1) throw new StorageCasConflictError('scope root changed during preparation');
    const event = { eventId: `event:${receipt.commitId}`, seq: sequence, commitId: receipt.commitId, rootVersion: next, ...(operationKey === undefined ? {} : { operationKey }), ...(sealedSegment && operationKey ? { segment: { operationKey, from: sequence, to: sequence } } : {}) };
    if (this.options.outbox) {
      await this.options.outbox.append(session, { moduleId: this.options.moduleId, scope, incarnation: this.incarnation, stream: this.incarnation }, event);
    } else {
      await session.execute({ text: `INSERT INTO ${this.schema}.journal(scope_key,sequence,event_id,event) VALUES($1,$2::bigint,$3,$4::jsonb)`, values: [this.key(scope), sequence, event.eventId, JSON.stringify(event)] });
    }
  }
}
