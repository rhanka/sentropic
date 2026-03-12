import { describe, expect, it, vi } from 'vitest';

import {
  buildSseProxyUrl,
  runVsCodeSseProxy,
  type VsCodeSseProxyMessage,
} from '../../vscode-ext/stream-proxy';

const encoder = new TextEncoder();

const createSseResponse = (chunks: string[]): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

describe('vscode stream proxy', () => {
  it('builds stream proxy URL with workspace and stream filters', () => {
    const url = buildSseProxyUrl({
      baseUrl: 'http://localhost:8787/api/v1/',
      workspaceId: 'ws_1',
      streamIds: ['stream_a', 'stream_b'],
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/v1/streams/sse');
    expect(parsed.searchParams.get('workspace_id')).toBe('ws_1');
    expect(parsed.searchParams.getAll('streamIds')).toEqual([
      'stream_a',
      'stream_b',
    ]);
  });

  it('forwards chunked SSE events without waiting for stream completion', async () => {
    const messages: VsCodeSseProxyMessage[] = [];
    const fetchImpl = vi.fn(async () =>
      createSseResponse([
        'event: status\ndata: {"streamId":"m_1","sequence":1,"data":{"state":"processing"}}\n\n',
        'event: content_delta\ndata: {"streamId":"m_1","sequence":2,',
        '"data":{"delta":"hel"}}\n\n',
        'event: content_delta\ndata: {"streamId":"m_1","sequence":3,"data":{"delta":"lo"}}\n\n',
      ]),
    );

    const abortController = new AbortController();
    await runVsCodeSseProxy(
      {
        baseUrl: 'http://localhost:8787/api/v1',
        workspaceId: 'ws_1',
        streamIds: ['m_1'],
        authToken: 'token_1',
      },
      {
        signal: abortController.signal,
        fetchImpl,
        emit: (message) => {
          messages.push(message);
        },
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestInit = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(requestInit.headers);
    expect(headers.get('authorization')).toBe('Bearer token_1');
    expect(messages).toEqual([
      {
        type: 'sse_event',
        eventType: 'status',
        payload: {
          streamId: 'm_1',
          sequence: 1,
          data: { state: 'processing' },
        },
      },
      {
        type: 'sse_event',
        eventType: 'content_delta',
        payload: {
          streamId: 'm_1',
          sequence: 2,
          data: { delta: 'hel' },
        },
      },
      {
        type: 'sse_event',
        eventType: 'content_delta',
        payload: {
          streamId: 'm_1',
          sequence: 3,
          data: { delta: 'lo' },
        },
      },
    ]);
  });
});
