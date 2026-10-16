import type { NativeMessagesRequest, NativeUsageSnapshot, NativeUsageTermination } from '@sentropic/llm-mesh';
import { NativeUsageObserver, nativeSnapshotUsage } from './native-usage.js';

export const NATIVE_FINALIZE_TIMEOUT_MS = 1_000;
export type NativeFinalizeResult = { readonly kind: 'completed' | 'absent' }
  | { readonly kind: 'observation_unavailable'; readonly reason: 'hook_error' | 'hook_timeout' };

/** Catch the hook immediately; expiry never cancels/retries an issued observation. */
export const finalizeNativeObservation = (
  hook: NativeMessagesRequest['finalize'], snapshot: NativeUsageSnapshot,
): Promise<NativeFinalizeResult> => {
  if (!hook) return Promise.resolve({ kind: 'absent' });
  return new Promise(resolve => {
    let finished = false;
    const done = (result: NativeFinalizeResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => done({ kind: 'observation_unavailable', reason: 'hook_timeout' }),
      NATIVE_FINALIZE_TIMEOUT_MS);
    Promise.resolve().then(() => hook(snapshot)).then(
      () => done({ kind: 'completed' }),
      () => done({ kind: 'observation_unavailable', reason: 'hook_error' }),
    );
  });
};

/** Synchronous terminal ownership; financial and cleanup paths never await observation. */
export const nativeLifecycle = (
  observer: NativeUsageObserver, hook: NativeMessagesRequest['finalize'],
  identity: { readonly requestId: string; readonly attemptRef: string },
) => {
  let snapshot: NativeUsageSnapshot | undefined;
  let observation: Promise<NativeFinalizeResult> | undefined;
  const finish = (termination: NativeUsageTermination) => {
    if (!snapshot) {
      snapshot = observer.snapshot(termination);
      observation = finalizeNativeObservation(hook, snapshot);
      void observation.then(result => {
        if (result.kind === 'observation_unavailable') {
          console.warn('Native observation unavailable', { ...identity, reason: result.reason });
        }
      });
    }
    return snapshot;
  };
  return { finish, usage: (termination: NativeUsageTermination) => nativeSnapshotUsage(finish(termination)),
    get snapshot() { return snapshot; }, get observation() { return observation; } };
};
