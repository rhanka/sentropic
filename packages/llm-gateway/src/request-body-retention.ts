import type { GatewayBodyByteLease } from './request-body-pool.js';

/** Request-scoped ownership: clear every registered holder before returning bytes. */
export class CheckedGatewayBody {
  private readonly holders = new Set<() => void>();
  private detached = false;
  private released = false;
  transferred = false;
  constructor(public body: unknown, readonly bytes: number, readonly lease: GatewayBodyByteLease) {}
  get retainedHolders() { return this.holders.size + (this.body === undefined ? 0 : 1); }
  trackDetach(clear: () => void): void {
    if (this.detached) clear();
    else this.holders.add(clear);
  }
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.body = undefined;
    for (const clear of this.holders) clear();
    this.holders.clear();
    this.lease.shrink(0);
  }
  transfer(): void { this.transferred = true; }
  release(): void {
    if (this.released) return;
    this.detach();
    this.released = true;
    this.lease.release();
  }
}

/** Terminal ownership works even when the downstream never starts the generator. */
export const retainGatewayStreamBody = <T>(
  source: AsyncGenerator<T, void, unknown>, owner: CheckedGatewayBody, signal?: AbortSignal,
): AsyncGenerator<T, void, unknown> => {
  owner.transfer();
  let stream: typeof source | undefined = source;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= Promise.resolve().then(async () => {
    signal?.removeEventListener('abort', abort);
    const current = stream;
    stream = undefined;
    try { await current?.return(undefined); }
    finally { owner.release(); }
  });
  const abort = () => { void close().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return {
    async next(value) {
      if (!stream) return { done: true, value: undefined };
      try {
        const result = await stream.next(value);
        if (result.done) await close();
        return result;
      } catch (error) {
        try { await close(); } catch { /* Preserve the original stream failure. */ }
        throw error;
      }
    },
    async return() { await close(); return { done: true, value: undefined }; },
    async throw(error) { try { await close(); } catch { /* Original failure wins. */ } throw error; },
    [Symbol.asyncIterator]() { return this; },
  };
};
