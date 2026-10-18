import { describe, expect, it } from 'vitest';
import { createNodeGatewayServer, listenNodeServer, closeNodeServer } from '../src/node/http-server.js';
import { resolveGatewayStateDir } from '../src/node/state-directory.js';
describe('published Node HTTP bridge', () => {
  it('confines the application-state path to an opaque owner scope', () => {
    expect(resolveGatewayStateDir({ ownerScopeRef: 'owner-a', platformDir: '/state' })).toBe('/state/sentropic/llm-gateway/owner-a');
    expect(() => resolveGatewayStateDir({ ownerScopeRef: '../other' })).toThrow();
    expect(() => resolveGatewayStateDir({ ownerScopeRef: 'owner-a', platformDir: 'relative' })).toThrow();
  });
  it('preserves request bytes, status and streamed response bytes', async () => {
    const server = createNodeGatewayServer(async (req) => new Response(await req.text(), { status: 201, headers: { 'content-type': 'text/plain' } }), () => endpoint);
    const endpoint = await listenNodeServer(server, { host: '127.0.0.1', port: 0 });
    try {
      const response = await fetch(`${endpoint}/infer`, { method: 'POST', body: 'synthetic-body' });
      expect(response.status).toBe(201); expect(await response.text()).toBe('synthetic-body');
    } finally { await closeNodeServer(server); }
  });
  it('forwards client cancellation to the Fetch request without a terminal frame', async () => {
    let observed!: () => void;
    const cancelled = new Promise<void>((resolve) => { observed = resolve; });
    const server = createNodeGatewayServer((req) => {
      req.signal.addEventListener('abort', observed, { once: true });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
    }, () => endpoint);
    const endpoint = await listenNodeServer(server, { host: '127.0.0.1', port: 0 });
    try {
      const controller = new AbortController();
      const response = await fetch(`${endpoint}/stream`, { signal: controller.signal });
      expect((await response.body!.getReader().read()).done).toBe(false);
      controller.abort(); await cancelled;
    } finally { await closeNodeServer(server); }
  });
});
