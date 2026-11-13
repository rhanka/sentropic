/** Compose cancellation without relying on AbortSignal.any's newer DOM type declaration. */
export function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const subscriptions = new Map<AbortSignal, () => void>();
  const abort = (signal: AbortSignal) => {
    controller.abort(signal.reason);
    for (const [source, listener] of subscriptions) source.removeEventListener('abort', listener);
    subscriptions.clear();
  };
  for (const signal of signals) {
    if (signal.aborted) { abort(signal); break; }
    const listener = () => abort(signal);
    subscriptions.set(signal, listener); signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}
