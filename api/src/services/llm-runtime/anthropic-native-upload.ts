import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { NativeMessagesUpstreamError } from '@sentropic/llm-mesh';

// Fetch headers/producer EOF do not establish outbound completion. Node's
// transport notification does; weak keys never retain the internal request.
const context = new AsyncLocalStorage<(failed: boolean) => void>();
const pending = new WeakMap<object, (failed: boolean) => void>();
channel('undici:request:create').subscribe(message => {
  const done = context.getStore();
  if (done) pending.set((message as { request: object }).request, done);
});
const terminal = (failed: boolean) => (message: unknown) => {
  const request = (message as { request: object }).request;
  const done = pending.get(request);
  pending.delete(request);
  done?.(failed);
};
channel('undici:request:bodySent').subscribe(terminal(false));
channel('undici:request:error').subscribe(terminal(true));

export const confirmedNativeFetch = async (url: string, init: RequestInit, onResponseStarted?: () => void): Promise<Response> => {
  let done!: (failed: boolean) => void;
  const uploaded = new Promise<boolean>(resolve => { done = resolve; });
  const response = await context.run(done, () => fetch(url, init));
  try {
    if (response.status === 200) onResponseStarted?.();
    const failed = await uploaded;
    init.signal?.throwIfAborted();
    if (failed) throw new NativeMessagesUpstreamError({ status: 503, code: 'native_protocol_error' });
    return response;
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
};
