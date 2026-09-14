import { nativeIdempotencyKey } from './canonical-json.js';
import { sameFence } from './drain-fence-operation.js';
import type { PreparedPut } from './local-model.js';
import { LocalMessagingState } from './local-state.js';
import { validateNativeBatch } from './native-batch-validation.js';
import type {
  NativeDrainCoordinatorPort,
  NativeDrainImportResult,
} from './native-drain-contracts.js';
import { mutateNativeImport } from './native-import-mutation.js';
import { PutOperation } from './put-operation.js';
import type { PutMessageResult } from './message-contracts.js';
import { sameCursor, validContext } from './validation.js';

type NativeImportFailure = Extract<NativeDrainImportResult, { ok: false }>['reason'];
type PutFailure = Extract<PutMessageResult, { ok: false }>['reason'];

export class NativeImportOperation {
  constructor(
    private readonly state: LocalMessagingState,
    private readonly puts: PutOperation,
  ) {}

  async importBatch(
    input: Parameters<NativeDrainCoordinatorPort['importBatch']>[0],
  ): Promise<NativeDrainImportResult> {
    if (!validContext(input.context)) return { ok: false, reason: 'forbidden' };
    const fenceFailure = await this.state.mutex.run(() => this.inspectFence(input));
    if (fenceFailure) return { ok: false, reason: fenceFailure };
    if (!validateNativeBatch(input)) return { ok: false, reason: 'invalid_batch' };
    const prepared: PreparedPut[] = [];
    for (const record of input.batch.records) {
      const result = await this.puts.prepare({
        context: input.context,
        destination: record.destination,
        idempotencyKey: nativeIdempotencyKey({
          sourceId: input.batch.sourceId,
          sourceEpoch: input.batch.sourceEpoch,
          nativeMessageId: record.nativeMessageId,
        }),
        payload: record.payload,
        ...(record.actuation === undefined ? {} : { actuation: record.actuation }),
        ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
        ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
      });
      if (!result.ok) return { ok: false, reason: this.mapFailure(result.reason) };
      prepared.push(result.prepared);
    }
    return this.state.mutex.run(() => mutateNativeImport({ ...input, state: this.state, prepared }));
  }

  private inspectFence(
    input: Parameters<NativeDrainCoordinatorPort['importBatch']>[0],
  ): NativeImportFailure | null {
    const drain = this.state.drains.get(input.fence.sourceId);
    if (!drain?.fence || !sameFence(drain.fence, input.fence)) return 'fenced';
    const nowMs = this.state.nowMs();
    if (nowMs === null) return 'unavailable';
    if (Date.parse(drain.fence.expiresAt) <= nowMs) return 'lease_expired';
    if (!sameCursor(drain.cursor, input.expectedCursor)) return 'cursor_conflict';
    if (drain.sourceEpoch && drain.sourceEpoch !== input.batch.sourceEpoch) {
      return 'source_epoch_changed';
    }
    return null;
  }

  private mapFailure(
    reason: PutFailure,
  ): 'invalid_batch' | 'forbidden' | 'capacity_exhausted' | 'unavailable' {
    if (reason === 'forbidden') return 'forbidden';
    if (reason === 'capacity_exhausted') return 'capacity_exhausted';
    if (reason === 'unavailable') return 'unavailable';
    return 'invalid_batch';
  }
}
