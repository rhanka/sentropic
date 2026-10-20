import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Hermetic fetch-style service on an OS-assigned loopback port, with disconnect cancellation. */
export async function serve(handler: (request: Request) => Response | Promise<Response>, port = 0) {
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => controller.abort());
    try {
      let body = '';
      for await (const chunk of incoming) body += String(chunk);
      const request = new Request(`http://127.0.0.1:${(server.address() as AddressInfo).port}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers as Record<string, string>,
        ...(body ? { body } : {}), signal: controller.signal,
      });
      const response = await handler(request);
      // Fresh connections make listener restart tests independent of a stale pooled socket.
      outgoing.setHeader('connection', 'close');
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      const reader = response.body?.getReader();
      try {
        while (reader) {
          const part = await reader.read();
          if (part.done) break;
          outgoing.write(part.value);
        }
      } finally { reader?.releaseLock(); }
      outgoing.end();
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', resolve);
  });
  let closing: Promise<void> | undefined;
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => closing ??= new Promise<void>((resolve, reject) => {
      server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
