import { ensure } from './seat-admission.ts';

export class PaidQueue {
  tail: Promise<unknown> = Promise.resolve(); seen = new Set<string>();
  async run<T>(id: string, waitMs: number, signal: AbortSignal | undefined, send: () => Promise<T>): Promise<T> {
    ensure(!this.seen.has(id), 'duplicate-request');
    ensure(Number.isFinite(waitMs) && waitMs > 0 && waitMs <= 60000, 'broker-queue-deadline');
    this.seen.add(id); const deadline = Date.now() + waitMs;
    const previous = this.tail; let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const refused = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('broker-queue-timeout')), waitMs);
      onAbort = () => reject(new Error('broker-queue-cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const work = previous.catch(() => {}).then(async () => {
      ensure(!signal?.aborted && Date.now() < deadline, 'broker-queue-timeout-or-cancelled');
      clearTimeout(timer!); signal?.removeEventListener('abort', onAbort!);
      return send();
    });
    // The internal tail remains attached to the real send, never the wait timeout.
    this.tail = work.catch(() => {});
    return Promise.race([work, refused]).finally(() => {
      clearTimeout(timer!); signal?.removeEventListener('abort', onAbort!);
    });
  }
}
export type PaidDebit = { id: string; reserved: number; inputBound: number; outputBound: number;
  settled: boolean; actual?: number };
export type TerminalUsage = { trusted: boolean; complete: boolean; id: string; input: number; output: number };
export const settleUsage = (debit: PaidDebit, usage: TerminalUsage | undefined,
  price: { input: number; output: number }) => {
  ensure(!debit.settled, 'already-settled');
  if (!usage?.trusted || !usage.complete) return { actual: undefined, held: debit.reserved, released: 0 };
  ensure(usage.id === debit.id && Number.isSafeInteger(usage.input) && usage.input > 0
    && Number.isSafeInteger(usage.output) && usage.output >= 0
    && usage.input <= debit.inputBound && usage.output <= debit.outputBound, 'usage-contract');
  const actual = Math.ceil(usage.input * price.input + usage.output * price.output);
  ensure(Number.isSafeInteger(actual) && actual >= 0 && actual <= debit.reserved, 'usage-contract');
  debit.actual = actual; debit.settled = true;
  return { actual, held: 0, released: debit.reserved - actual };
};
