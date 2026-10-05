import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';

// Fetch headers/producer EOF do not establish outbound completion. Node's
// transport notification does; weak keys never retain the internal request.
const context = new AsyncLocalStorage<() => void>();
const pending = new WeakMap<object, () => void>();
channel('undici:request:create').subscribe(message => {
  const done = context.getStore();
  if (done) pending.set((message as { request: object }).request, done);
});
const terminal = (message: unknown) => {
  const request = (message as { request: object }).request;
  const done = pending.get(request);
  pending.delete(request);
  done?.();
};
channel('undici:request:bodySent').subscribe(terminal);
channel('undici:request:error').subscribe(terminal);

export const confirmedNativeFetch = async (url: string, init: RequestInit, onResponseStarted?: () => void): Promise<Response> => {
  let done!: () => void;
  const uploaded = new Promise<void>(resolve => { done = resolve; });
  const response = await context.run(done, () => fetch(url, init));
  try {
    if (response.status === 200) onResponseStarted?.();
    await uploaded;
    init.signal?.throwIfAborted();
    return response;
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
};
