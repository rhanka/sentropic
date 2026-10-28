/**
 * BR14a Lot 9 - @sentropic/chat-ui stream hub factory tests.
 *
 * These tests define the package-owned stream hub core without app
 * stores, app config, browser globals, Chrome globals, or VSCode globals.
 */
import { describe, expect, it, vi } from 'vitest';

import { createStreamHub } from '../src/client/streamHub.js';
import type { RuntimePortLike, StreamHubEvent } from '../src/client/streamTypes.js';

class FakeEventSource {
  readonly url: string;
  readonly withCredentials: boolean;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  readyState = 1;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(options?.withCredentials);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, payload: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(payload) }));
    }
  }
}

const buildHub = (overrides?: {
  auth?: boolean;
  workspaceId?: string | null;
  eventSources?: FakeEventSource[];
  extensionPortFactory?: () => RuntimePortLike | null;
}) => {
  const eventSources = overrides?.eventSources ?? [];
  return createStreamHub({
    getBaseUrl: () => 'https://api.example.com/api/v1',
    getAuthState: () => overrides?.auth ?? true,
    getWorkspaceId: () => overrides?.workspaceId ?? null,
    eventSourceFactory: (url, options) => {
      const source = new FakeEventSource(url, options);
      eventSources.push(source);
      return source as unknown as EventSource;
    },
    extensionPortFactory: overrides?.extensionPortFactory,
    reconnectDelayMs: 0,
  });
};

describe('createStreamHub', () => {
  it('opens EventSource with workspace scope after the first subscriber is added', async () => {
    const eventSources: FakeEventSource[] = [];
    const hub = buildHub({ workspaceId: 'ws-123', eventSources });

    hub.set('all', vi.fn());
    await Promise.resolve();

    expect(eventSources).toHaveLength(1);
    expect(eventSources[0].url).toBe(
      'https://api.example.com/api/v1/streams/sse?workspace_id=ws-123',
    );
    expect(eventSources[0].withCredentials).toBe(true);
  });

  it('replays cached job updates to late job subscribers', async () => {
    const eventSources: FakeEventSource[] = [];
    const hub = buildHub({ eventSources });
    const first = vi.fn();
    hub.set('first', first);
    await Promise.resolve();

    eventSources[0].emit('job_update', {
      jobId: 'job-1',
      data: { status: 'processing' },
    });

    const late = vi.fn();
    hub.setJobUpdates('late', late);

    expect(late).toHaveBeenCalledWith({
      type: 'job_update',
      jobId: 'job-1',
      data: { status: 'processing' },
    });
  });

  it('replays aggregated text and tool deltas to late stream subscribers', async () => {
    const eventSources: FakeEventSource[] = [];
    const hub = buildHub({ eventSources });
    hub.set('all', vi.fn());
    await Promise.resolve();

    eventSources[0].emit('content_delta', {
      streamId: 'stream-1',
      sequence: 1,
      data: { delta: 'Hello ' },
    });
    eventSources[0].emit('content_delta', {
      streamId: 'stream-1',
      sequence: 2,
      data: { delta: 'world' },
    });
    eventSources[0].emit('tool_call_delta', {
      streamId: 'stream-1',
      sequence: 3,
      data: { tool_call_id: 'tool-1', delta: '{"a":' },
    });
    eventSources[0].emit('tool_call_delta', {
      streamId: 'stream-1',
      sequence: 4,
      data: { tool_call_id: 'tool-1', delta: '1}' },
    });

    const late = vi.fn();
    hub.setStream('late', 'stream-1', late);
    const replayed = late.mock.calls.map((call) => call[0] as StreamHubEvent);

    expect(replayed).toEqual([
      {
        type: 'content_delta',
        streamId: 'stream-1',
        sequence: 2,
        data: { delta: 'Hello world' },
      },
      {
        type: 'tool_call_delta',
        streamId: 'stream-1',
        sequence: 4,
        data: { tool_call_id: 'tool-1', delta: '{"a":1}' },
      },
    ]);
  });

  it('uses the injected extension port factory instead of browser globals', async () => {
    const addMessageListener = vi.fn();
    const addDisconnectListener = vi.fn();
    const removeMessageListener = vi.fn();
    const removeDisconnectListener = vi.fn();
    const postMessage = vi.fn();
    const disconnect = vi.fn();
    const port: RuntimePortLike = {
      postMessage,
      disconnect,
      onMessage: {
        addListener: addMessageListener,
        removeListener: removeMessageListener,
      },
      onDisconnect: {
        addListener: addDisconnectListener,
        removeListener: removeDisconnectListener,
      },
    };
    const hub = buildHub({
      workspaceId: 'ws-ext',
      extensionPortFactory: () => port,
    });

    hub.setStream('stream', 'stream-ext-1', vi.fn());
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'stream_proxy_start',
      payload: {
        baseUrl: 'https://api.example.com/api/v1',
        workspaceId: 'ws-ext',
        streamIds: ['stream-ext-1'],
      },
    });
    expect(addMessageListener).toHaveBeenCalledOnce();
    expect(addDisconnectListener).toHaveBeenCalledOnce();
  });

  it('closes the EventSource when auth is false or all subscribers are removed', async () => {
    const eventSources: FakeEventSource[] = [];
    const unauthenticatedHub = buildHub({ auth: false, eventSources });
    unauthenticatedHub.set('all', vi.fn());
    await Promise.resolve();
    expect(eventSources).toHaveLength(0);

    const authenticatedHub = buildHub({ auth: true, eventSources });
    authenticatedHub.set('all', vi.fn());
    await Promise.resolve();
    expect(eventSources).toHaveLength(1);
    authenticatedHub.delete('all');
    await Promise.resolve();
    expect(eventSources[0].readyState).toBe(2);
  });
});
