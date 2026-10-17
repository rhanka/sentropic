import { isStorageModuleId, type StorageModuleId, type StorageScope, type WorkLimits } from '../contracts.js';
import type { KernelOptions } from '../kernel.js';
import type { ModuleDescriptor } from '../descriptor.js';
import { StorageInvalidCommandError } from '../errors.js';
import type { PgHostHistory } from './migrations.js';
import type { ScopeGrant } from '../authority.js';

export type SqlValue = string | number | boolean | bigint | Uint8Array | null | readonly SqlValue[];
export interface SqlStatement { readonly text: string; readonly values: readonly SqlValue[]; }
export interface SqlResult { readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly rowCount?: number | null; }
export interface PgSession { execute(statement: SqlStatement): Promise<SqlResult>; }
export interface PgTransactionOptions { readonly isolation: 'serializable'; readonly readOnly: boolean; readonly deadlineMs: number; }
export interface InjectedPgDriver {
  transaction<T>(options: PgTransactionOptions, operation: (session: PgSession) => Promise<T>): Promise<T>;
}
export interface PgLayout {
  readonly dataSchema: string; readonly projectionSchemas: Readonly<Partial<Record<StorageModuleId, string>>>; readonly outboxSchema: string;
}
export interface PgBudgets {
  readonly lockWaitMs: number; readonly statementMs: number; readonly idleMs: number; readonly flushMs: number; readonly attempts: number;
}
export interface PgStreamIdentity { readonly moduleId: StorageModuleId; readonly scope: StorageScope; readonly incarnation: string; readonly stream: string; }
export interface PgJournalDraft { readonly eventId: string; readonly seq: string; readonly commitId: string; readonly rootVersion: string; readonly operationKey?: string; }
export interface PgOutboxBinding {
  // The host writes through this exact transaction session. Hidden staged
  // units publish one sealed segment, never a history-sized append loop.
  append(session: PgSession, stream: PgStreamIdentity, event: PgJournalDraft): Promise<void>;
}
export interface PgQueryContext {
  readonly layout: PgLayout; readonly currentRoot: string | null; readonly grant: ScopeGrant<unknown>;
  readonly session: PgSession; readonly stream: PgStreamIdentity; readonly root: string | null;
  readonly cursor: unknown; readonly limit: number; readonly maxEncodedBytes: number;
}
export interface PgQueryPage { readonly records: readonly unknown[]; readonly nextCursor: unknown; }
export type PgRegisteredQuery = (input: unknown, context: PgQueryContext) => Promise<PgQueryPage>;
export interface PostgresStorageOptions extends Omit<KernelOptions, 'backend' | 'coordinator' | 'predicates'> {
  readonly moduleId: StorageModuleId; readonly driver: InjectedPgDriver; readonly layout: PgLayout;
  readonly ids?: { next(kind: string): string }; readonly domainClock?: { now(): string };
  readonly outbox?: PgOutboxBinding; readonly budgets?: Partial<PgBudgets>; readonly limits?: WorkLimits;
  readonly descriptor?: ModuleDescriptor; readonly queries?: Readonly<Record<string, PgRegisteredQuery>>;
  readonly history: PgHostHistory;
  readonly pgPredicates?: Readonly<Record<string, (dependency: string, context: Pick<PgQueryContext, 'session' | 'stream' | 'root'>) => Promise<boolean>>>;
}
export const quotePgIdentifier = (value: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) throw new StorageInvalidCommandError('invalid Postgres layout identifier');
  return `"${value}"`;
};
export const validatePgLayout = (layout: PgLayout): PgLayout => {
  if (!layout || !layout.projectionSchemas || typeof layout.projectionSchemas !== 'object') throw new StorageInvalidCommandError('invalid Postgres layout');
  quotePgIdentifier(layout.dataSchema); quotePgIdentifier(layout.outboxSchema);
  for (const [moduleId, schema] of Object.entries(layout.projectionSchemas)) {
    if (!isStorageModuleId(moduleId)) throw new StorageInvalidCommandError('unknown projection module');
    quotePgIdentifier(schema);
  }
  return Object.freeze({ ...layout, projectionSchemas: Object.freeze({ ...layout.projectionSchemas }) });
};
