import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';

export const NATIVE_FIRST_RESPONSE_TIMEOUT_MS = 55_000;

/** Bounded lifecycle metadata only; caller cancellation remains active after readiness. */
export const nativeReadiness = (caller: AbortSignal) => {
  const controller = new AbortController();
  const signal = AbortSignal.any([caller, controller.signal]);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new NativeMessagesUpstreamError({ status: 504, code: 'timeout' }));
  }, NATIVE_FIRST_RESPONSE_TIMEOUT_MS);
  const ready = () => clearTimeout(timer);
  const failure = (error: unknown) => timedOut
    ? new NativeMessagesUpstreamError({ status: 504, code: 'timeout' }) : error;
  const race = <T>(task: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(failure(signal.reason)); };
    if (signal.aborted) { void task.catch(() => undefined); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(failure(error)); });
  });
  return { signal, ready, failure, race,
    close() { ready(); controller.abort(); },
  };
};
export type NativeReadiness = ReturnType<typeof nativeReadiness>;
