import type { DataPlaneTransport, CustodySubject } from './data-plane';
import { custodyRefused } from './data-plane';
import { custodyResponse } from './data-plane-body';

/** Buffer within both custody and size bounds; no bytes escape after expiry/revocation. */
export async function dataPlaneFetch(transport: DataPlaneTransport, subject: CustodySubject, path: string,
  options: { method: string; headers: Record<string, string>; body?: Buffer; signal: AbortSignal; maxBytes: number;
    consume?: (response: Response) => Promise<Response> }) {
  const hop = await transport.prepare(subject, options.signal).catch(() => undefined);
  if (!hop) return custodyRefused();
  let transferred = false;
  try {
    const response = await new Promise<Response>(resolve => {
      let settled = false; let unguard = () => {};
      const finish = (response: Response) => {
        if (settled) return;
        settled = true; unguard(); options.signal.removeEventListener('abort', abort);
        outgoing.destroy(); resolve(response);
      };
      const abort = () => finish(hop.valid() ? new Response(null, { status: 502 }) : custodyRefused());
      const outgoing = hop.open(path, { method: options.method, headers: options.headers });
      outgoing.once('error', abort);
      outgoing.once('response', incoming => {
        if (incoming.statusCode === 403) { finish(custodyRefused()); return; }
        if (!incoming.statusCode || incoming.statusCode < 200 || incoming.statusCode > 599) {
          finish(new Response(null, { status: 502 })); return;
        }
        const chunks: Buffer[] = []; let length = 0;
        incoming.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > options.maxBytes) finish(new Response(null, { status: 502 })); else chunks.push(chunk);
        });
        incoming.once('error', abort);
        incoming.once('close', () => { if (!incoming.complete) abort(); });
        incoming.once('end', () => {
          if (!hop.valid()) { finish(custodyRefused()); return; }
          const status = incoming.statusCode ?? 502;
          finish(new Response(options.method === 'HEAD' || [204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
            status, headers: { 'content-type': String(incoming.headers['content-type'] ?? 'application/octet-stream'),
              'cache-control': 'private, no-store' },
          }));
        });
      });
      unguard = hop.guard(() => finish(custodyRefused()));
      options.signal.addEventListener('abort', abort, { once: true });
      if (settled) unguard();
      else if (options.signal.aborted) abort();
      else outgoing.end(options.body);
    });
    if (response.status === 403) return response;
    // Never expose an upstream error document without the live isolation/refusal policy.
    const safe = response.status === 200 ? response : new Response(null, { status: 502 });
    if (response.status !== 200 && !options.consume) return safe;
    const output = await custodyResponse(hop, safe, options.signal, options.consume);
    transferred = true; return output;
  } catch { return hop.valid() ? new Response(null, { status: 502 }) : custodyRefused(); }
  finally { if (!transferred) hop.dispose(); }
}
