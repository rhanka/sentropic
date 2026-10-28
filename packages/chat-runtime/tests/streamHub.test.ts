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
