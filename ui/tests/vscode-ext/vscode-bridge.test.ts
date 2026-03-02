import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOPAI_HOST_SOURCE,
  TOPAI_WEBVIEW_SOURCE,
  createVsCodeBridge,
  type VsCodeBridge,
  type VsCodeBridgeTransport,
} from '../../vscode-ext/vscode-bridge';

describe('vscode bridge', () => {
  let bridge: VsCodeBridge;
  let sentMessages: unknown[];
  let listener: ((message: unknown) => void) | null;

  beforeEach(() => {
    sentMessages = [];
    listener = null;

    const transport: VsCodeBridgeTransport = {
      postMessage(message) {
        sentMessages.push(message);
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = null;
        };
      },
    };

    bridge = createVsCodeBridge(transport, { defaultTimeoutMs: 50 });
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('sends request envelopes and resolves matching responses', async () => {
    const promise = bridge.request<{ ok: boolean }>('tools.execute', {
      tool: 'tab_read',
    });

    const request = sentMessages[0] as {
      source: string;
      type: string;
      command: string;
      requestId: string;
    };

    expect(request.source).toBe(TOPAI_WEBVIEW_SOURCE);
    expect(request.type).toBe('request');
    expect(request.command).toBe('tools.execute');
    expect(typeof request.requestId).toBe('string');

    listener?.({
      source: TOPAI_HOST_SOURCE,
      type: 'response',
      command: 'tools.execute',
      requestId: request.requestId,
      ok: true,
      payload: { ok: true },
    });

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('rejects when host responds with an explicit error', async () => {
    const promise = bridge.request('auth.codex.signIn');

    const request = sentMessages[0] as { requestId: string };

    listener?.({
      source: TOPAI_HOST_SOURCE,
      type: 'response',
      command: 'auth.codex.signIn',
      requestId: request.requestId,
      ok: false,
      error: 'denied',
    });

    await expect(promise).rejects.toThrow('denied');
  });

  it('dispatches host events to command-scoped listeners', () => {
    const onCheckpoint = vi.fn();
    const stop = bridge.onEvent('checkpoint.created', onCheckpoint);

    listener?.({
      source: TOPAI_HOST_SOURCE,
      type: 'event',
      command: 'checkpoint.created',
      payload: { id: 'cp_1' },
    });

    expect(onCheckpoint).toHaveBeenCalledWith({ id: 'cp_1' });

    stop();

    listener?.({
      source: TOPAI_HOST_SOURCE,
      type: 'event',
      command: 'checkpoint.created',
      payload: { id: 'cp_2' },
    });

    expect(onCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('times out requests that do not receive a host response', async () => {
    vi.useFakeTimers();

    const promise = bridge.request('slow-command', undefined, { timeoutMs: 20 });
    const rejection = expect(promise).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(21);
    await rejection;
  });
});
