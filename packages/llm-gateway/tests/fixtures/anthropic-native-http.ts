import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NativeMessagesUpstreamError, type NativeMessagesRequest, type NativeMessagesResult } from '@sentropic/llm-mesh';
import { parseNativeErrorDetail } from '../../src/native-errors.js';
import { buildNativeRequestHeaders } from '../../src/native-headers.js';

/** Loopback-only fake provider. Response progress is explicitly controlled, never timed. */
export const nativeHttpFixture = async (options: {
  json?: Record<string, unknown>; frames?: readonly Uint8Array[]; status?: number;
  headers?: Record<string, string>; pauseAfterFirst?: boolean;
} = {}) => {
  const requests: { path: string; headers: IncomingHttpHeaders; bytes: Uint8Array; body: unknown }[] = [];
  let resume!: () => void;
  const resumed = new Promise<void>(resolve => { resume = resolve; });
  let responseClosed!: () => void;
  const closed = new Promise<void>(resolve => { responseClosed = resolve; });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on('data', chunk => chunks.push(Buffer.from(chunk)));
      req.on('end', resolve); req.on('error', reject);
    });
    const bytes = Buffer.concat(chunks);
    requests.push({ path: req.url!, headers: req.headers, bytes, body: JSON.parse(bytes.toString('utf8')) });
    res.on('close', responseClosed);
    res.writeHead(options.status ?? 200, { 'content-type': options.frames ? 'text/event-stream' : 'application/json',
      'anthropic-organization-id': 'org-fixture', ...options.headers });
    if (options.frames) {
      res.write(options.frames[0]);
      if (options.pauseAfterFirst) await Promise.race([resumed, closed]);
      for (const frame of options.frames.slice(1)) if (!res.destroyed) res.write(frame);
      res.end();
    } else res.end(JSON.stringify(options.json ?? { model: 'claude-sonnet-5',
      usage: { input_tokens: 2, output_tokens: 3 }, safeguard_results: { future: ['雪'] } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const execute = async (request: NativeMessagesRequest): Promise<NativeMessagesResult> => {
    const response = await fetch(`${url}/v1/messages`, { method: 'POST', signal: request.signal,
      headers: { ...buildNativeRequestHeaders(request.headers.forwarded),
        'anthropic-version': request.headers.anthropicVersion, 'content-type': 'application/json',
        accept: request.stream ? 'text/event-stream' : 'application/json', 'x-api-key': 'SERVER-FIXTURE-KEY' },
      body: JSON.stringify(request.body) });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    if (!response.ok) {
      const validation = parseNativeErrorDetail(await response.text(), response.status, {
        requestSafeguards: Object.hasOwn(request.body, 'safeguards'),
        sentBetas: (request.headers.forwarded['anthropic-beta'] ?? '').split(',').map(beta => beta.trim()),
      });
      throw new NativeMessagesUpstreamError({ status: response.status,
        type: response.status === 400 ? 'invalid_request_error' : undefined, validation });
    }
    if (!request.stream) return { kind: 'json', status: 200, headers, body: await response.json() };
    const reader = response.body!.getReader();
    return { kind: 'stream', status: 200, headers, body: { async *[Symbol.asyncIterator]() {
      try { for (let next = await reader.read(); !next.done; next = await reader.read()) yield next.value; }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } } };
  };
  return { url, execute, requests, resume, closed,
    async close() { resume(); server.closeAllConnections(); await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())); } };
};
