import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { normalizeProviderError } from '../src/errors.js';

const listenOnLoopback = async (): Promise<{
  url: string;
  close: () => Promise<void>;
}> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"type":"content_delta","data":{"text":"partial"}}\n\n');
    setImmediate(() => response.socket?.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/stream`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
};

describe('normalizeProviderError', () => {
  it('should normalize a top-level undici socket error as a retryable network error', () => {
    const socketError = Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' });

    expect(normalizeProviderError('openai', socketError)).toMatchObject({
      message: 'socket closed',
      code: 'UND_ERR_SOCKET',
      retryable: true,
      retryReason: 'network',
      cause: socketError,
    });
  });

  it.each(['UND_ERR_SOCKET', 'und_err_socket', 'UnD_ErR_SoCkEt'])(
    'should normalize exact nested %s codes as retryable network errors',
    (socketCode) => {
      const nested = Object.assign(new Error('private socket detail'), {
        code: socketCode,
        privateField: 'must not be promoted',
      });
      const outer = new TypeError('fetch failed', {
        cause: { cause: nested },
      });

      const normalized = normalizeProviderError('openai', outer);

      expect(normalized).toMatchObject({
        providerId: 'openai',
        message: 'fetch failed',
        retryable: true,
        retryReason: 'network',
        cause: outer,
      });
      expect(normalized.code).toBeUndefined();
      expect(normalized).not.toHaveProperty('privateField');
    },
  );

  it('should not normalize an unknown nested cause code', () => {
    const outer = new TypeError('fetch failed', {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT', retryable: true },
    });

    expect(normalizeProviderError('openai', outer)).toMatchObject({
      message: 'fetch failed',
      retryable: false,
    });
  });

  it('should stop safely when the nested cause graph contains a cycle', () => {
    const cyclic: Record<string, unknown> = { code: 'UNKNOWN_SOCKET_ERROR' };
    cyclic.cause = cyclic;

    expect(normalizeProviderError('openai', { message: 'fetch failed', cause: cyclic })).toMatchObject({
      message: 'fetch failed',
      retryable: false,
    });
  });

  it('should normalize an abrupt local HTTP stream close as a retryable network error', async () => {
    const endpoint = await listenOnLoopback();
    let thrown: unknown;

    try {
      const response = await fetch(endpoint.url);
      await response.text();
    } catch (error) {
      thrown = error;
    } finally {
      await endpoint.close();
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ cause: { code: 'UND_ERR_SOCKET' } });
    expect(normalizeProviderError('openai', thrown)).toMatchObject({
      retryable: true,
      retryReason: 'network',
    });
  });
});
