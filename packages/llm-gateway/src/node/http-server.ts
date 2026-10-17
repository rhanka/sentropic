import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';

/** Stream the gateway's Fetch router with cancellation and backpressure. */
export const createNodeGatewayServer = (
  fetch: (request: Request) => Response | Promise<Response>,
  origin: () => string,
): Server => createServer(async (req, res) => {
  const abort = new AbortController();
  const disconnect = () => { if (!res.writableEnded) abort.abort(); };
  res.once('close', disconnect);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  abort.signal.addEventListener('abort', cancel, { once: true });
  try {
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new Error('invalid request target');
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    const request = new Request(new URL(req.url, origin()), {
      method: req.method, headers, signal: abort.signal,
      ...(!['GET', 'HEAD'].includes(req.method ?? 'GET')
        ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    });
    const response = await fetch(request);
    if (abort.signal.aborted) { await response.body?.cancel(); return; }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    reader = response.body?.getReader();
    while (reader && !abort.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!res.write(chunk.value)) await once(res, 'drain', { signal: abort.signal });
    }
    if (!abort.signal.aborted) res.end();
  } catch {
    if (res.headersSent) res.destroy();
    else if (!abort.signal.aborted) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"gateway host failure"}');
    }
  } finally {
    res.removeListener('close', disconnect);
    abort.signal.removeEventListener('abort', cancel);
    reader?.releaseLock();
  }
});

export const listenNodeServer = async (server: Server, listen: { host: string; port: number }): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listen.port, listen.host, () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('invalid gateway listener');
  return `http://${listen.host.includes(':') ? `[${listen.host}]` : listen.host}:${address.port}`;
};

export const closeNodeServer = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => { if (error) reject(error); else resolve(); });
  server.closeIdleConnections();
});
