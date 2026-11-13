import { CustodyRevoked, custodyRefused, type DataPlaneHop } from './data-plane';

/** Keep custody through response transformation and the consumer's last read, including backpressure. */
export async function custodyResponse(hop: DataPlaneHop, response: Response, signal: AbortSignal,
  consume: (response: Response) => Promise<Response> = async value => value) {
  let unguard = () => {};
  let onAbort = () => {};
  const revoked = new Promise<Response>(resolve => {
    onAbort = () => resolve(custodyRefused());
    unguard = hop.guard(onAbort); signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  let output: Response;
  try { output = await Promise.race([consume(response), revoked]); }
  catch { hop.dispose(); throw new CustodyRevoked(); }
  finally { unguard(); signal.removeEventListener('abort', onAbort); }
  if (!hop.valid() || signal.aborted || output.status === 403) { hop.dispose(); return custodyRefused(); }
  if (!output.body) { hop.dispose(); return output; }
  const reader = output.body.getReader();
  let stopped = false; let chunk: Uint8Array | undefined; let offset = 0; let detach = () => {};
  const cleanup = () => { detach(); signal.removeEventListener('abort', abort); hop.dispose(); };
  let fail = () => {};
  const abort = () => fail();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      fail = () => {
        if (stopped) return; stopped = true;
        controller.error(new CustodyRevoked()); void reader.cancel().catch(() => undefined); cleanup();
      };
      detach = hop.guard(fail);
      signal.addEventListener('abort', abort, { once: true });
      if (stopped) cleanup(); else if (signal.aborted) fail();
    },
    async pull(controller) {
      if (stopped) return;
      if (!hop.valid()) { fail(); return; }
      try {
        if (!chunk || offset === chunk.length) {
          const next = await reader.read();
          if (stopped) return;
          if (!hop.valid()) { fail(); return; }
          if (next.done) { stopped = true; controller.close(); cleanup(); return; }
          chunk = next.value; offset = 0;
        }
        const end = Math.min(offset + 16 * 1024, chunk.length);
        controller.enqueue(chunk.subarray(offset, end)); offset = end;
      } catch { fail(); }
    },
    cancel() { stopped = true; cleanup(); return reader.cancel(); },
  }, { highWaterMark: 0 });
  return new Response(stream, { status: output.status, headers: output.headers });
}
