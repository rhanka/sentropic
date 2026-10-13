import type { NativeMessagesResult } from '@sentropic/llm-mesh';

/** Lease bookkeeping uses response state only; it never folds/finalizes usage. */
export const withNativeAccountLease = async (result: NativeMessagesResult, signal: AbortSignal,
  finish: (success: boolean) => Promise<void>): Promise<NativeMessagesResult> => {
  if (result.kind === 'json') { await finish(true); return result; }
  const raw = result.body[Symbol.asyncIterator]();
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (success: boolean) => {
    if (closed) return closing ?? Promise.resolve();
    closed = true;
    signal.removeEventListener('abort', abort);
    closing = (async () => {
      try { await raw.return?.(); } catch { /* Reader cleanup cannot replace the wire outcome. */ }
      finally { await finish(success); }
    })();
    return closing;
  };
  const abort = () => { void close(false).catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { ...result, body: { [Symbol.asyncIterator]: () => ({
    async next() {
      if (closed) return { done: true as const, value: undefined };
      try {
        const chunk = await raw.next();
        if (chunk.done) await close(true);
        return chunk;
      } catch (error) { await close(false); throw error; }
    },
    async return() { await close(false); return { done: true as const, value: undefined }; },
  }) } };
};
