import type { AtomicUnit, IdempotencyEntry } from '../atomic.js';
import type { EncodedValue } from '../contracts.js';
import type { PurgePolicy, RootPurgeJob } from '../staged-state.js';
import type { PgProjectionContext } from './protocol.js';
import type { StagedBeginInput, StagedUnitStatus, FragmentReceipt } from '../staged-units.js';
import type { AuthenticatedStagedHandle } from '../staged-state.js';
import type { RootStageInput } from '../staged-operations.js';
import type { ReadPage } from '../readers.js';
// Only installed module code receives this SPI. Scoped callers select named
// operations, never SQL, a callback, or an enforcement/bypass parameter.
export interface PgInstalledContext extends PgProjectionContext {
  readonly committedRoot: string | null; readonly rootVersion: string;
  readonly policy: PurgePolicy;
  available(target: string): Promise<boolean>;
  head(chain: string): Promise<{ readonly hash: string; readonly sequence: number; readonly bytes: string } | null>;
  headMetadata(chain: string): Promise<{ readonly head: string; readonly count: number } | null>;
  aggregate(key: string): Promise<{ readonly version: number; readonly value: EncodedValue } | null>;
  index(key: string): Promise<IdempotencyEntry | null>;
  apply(unit: AtomicUnit): Promise<void>;
  revalidate(check: () => Promise<void>): void;
  replayed(): void;
  beginStaged(input: StagedBeginInput): Promise<AuthenticatedStagedHandle>;
  stageFragment(input: RootStageInput): Promise<FragmentReceipt>;
  inspectStaged(operationKey: string): Promise<StagedUnitStatus>;
  readPage(chain: string, limit: number, cursor: unknown, maxEncodedBytes: number): Promise<ReadPage>;
}
export interface PgInstalledOperation { readonly operation: 'read' | 'write' | 'maintain'; execute(input: unknown, context: PgInstalledContext): Promise<unknown>; }
export type PgPurgeFinalizer = (job: RootPurgeJob, context: PgInstalledContext) => Promise<void>;
