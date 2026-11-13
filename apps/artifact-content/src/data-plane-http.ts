import type { DataPlaneTransport, CustodySubject } from './data-plane';
import { custodyRefused } from './data-plane';

/** Buffer within both custody and size bounds; no bytes escape after expiry/revocation. */
export async function dataPlaneFetch(transport: DataPlaneTransport, subject: CustodySubject, path: string,
  options: { method: string; headers: Record<string, string>; body?: Buffer; signal: AbortSignal; maxBytes: number }) {
  const hop = await transport.prepare(subject, options.signal).catch(() => undefined);
  if (!hop) return custodyRefused();
  try {
    return await new Promise<Response>(resolve => {
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
            status, headers: { 'content-type': String(incoming.headers['content-type'] ?? 'application/octet-stream') },
          }));
        });
      });
      unguard = hop.guard(() => finish(custodyRefused()));
      options.signal.addEventListener('abort', abort, { once: true });
      if (settled) unguard();
      else if (options.signal.aborted) abort();
      else outgoing.end(options.body);
    });
  } catch { return hop.valid() ? new Response(null, { status: 502 }) : custodyRefused(); }
  finally { hop.dispose(); }
}
