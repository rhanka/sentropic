/**
 * BR14a Lot 2 — @sentropic/chat-ui transport contract tests.
 *
 * Verifies the interface shape of `createDefaultTransport` without
 * touching the network: `fetch` and `EventSource` are replaced by
 * lightweight stubs for the lifetime of each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultTransport,
  type ChatCoreTransport,
} from '../src/client/transport.js';

class FakeEventSource {
  readonly url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close(): void {}
}

const originalFetch = globalThis.fetch;
const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;

beforeEach(() => {
  (globalThis as { EventSource?: unknown }).EventSource =
    FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = vi.fn(async () =>
    new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  vi.restoreAllMocks();
});

describe('createDefaultTransport', () => {
  it('returns an object implementing the ChatCoreTransport contract', () => {
    const transport: ChatCoreTransport = createDefaultTransport('https://api.example.com/api/v1');
    expect(typeof transport.openStream).toBe('function');
    expect(typeof transport.postMessage).toBe('function');
    expect(typeof transport.fetchBootstrap).toBe('function');
  });

  it('openStream accepts an optional fromSeq and forwards it as a query parameter', () => {
    const transport = createDefaultTransport('https://api.example.com/api/v1/');
    const source = transport.openStream('session-1', 42) as unknown as FakeEventSource;
    expect(source.url).toContain('/chat/sessions/session-1/stream');
    expect(source.url).toContain('fromSeq=42');
  });

  it('openStream omits the fromSeq query parameter when not provided', () => {
    const transport = createDefaultTransport('https://api.example.com/api/v1');
    const source = transport.openStream('session-1') as unknown as FakeEventSource;
    expect(source.url).toContain('/chat/sessions/session-1/stream');
    expect(source.url).not.toContain('fromSeq=');
  });

  it('openStream is relative-safe when baseUrl is empty (no URL() throw)', () => {
    const transport = createDefaultTransport('');
    expect(() => transport.openStream('session-1', 7)).not.toThrow();
    const source = transport.openStream('session-1', 7) as unknown as FakeEventSource;
    expect(source.url).toBe('/chat/sessions/session-1/stream?fromSeq=7');
  });

  it('openStream supports a relative baseUrl prefix', () => {
    const transport = createDefaultTransport('/api/v1');
    const source = transport.openStream('s2') as unknown as FakeEventSource;
    expect(source.url).toBe('/api/v1/chat/sessions/s2/stream');
  });

  it('postMessage returns a Promise that resolves to a Response', async () => {
    const transport = createDefaultTransport('https://api.example.com/api/v1');
    const result = transport.postMessage('session-1', { content: 'hello' });
    expect(result).toBeInstanceOf(Promise);
    const response = await result;
    expect(response).toBeInstanceOf(Response);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('fetchBootstrap returns a Promise resolving to parsed JSON', async () => {
    const transport = createDefaultTransport('https://api.example.com/api/v1');
    const result = transport.fetchBootstrap('session-1');
    expect(result).toBeInstanceOf(Promise);
    const payload = await result;
    expect(payload).toEqual({ ok: true });
  });

  it('forwards optional headers on POST requests', async () => {
    const transport = createDefaultTransport('https://api.example.com/api/v1', {
      'x-trace-id': 'abc-123',
    });
    await transport.postMessage('session-1', { content: 'hi' });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-trace-id': 'abc-123',
    });
  });
});
