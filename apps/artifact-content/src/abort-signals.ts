/** Node 24 is pinned by api/Dockerfile; TS 5.4's DOM declaration omits this native method. */
export function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const native = AbortSignal as typeof AbortSignal & { any(sources: AbortSignal[]): AbortSignal };
  return native.any([...signals]);
}
