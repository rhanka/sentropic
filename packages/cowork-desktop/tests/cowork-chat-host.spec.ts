import { describe, expect, it, vi } from 'vitest';
import type { StreamHubClient } from '@sentropic/chat-ui/client/streamTypes';
import {
    createDesktopRpcRuntimePort,
    type DesktopChatRpcClient,
    type DesktopRpcEvent,
} from '@sentropic/cowork-bridge/desktop-rpc';
import { createCoworkChatHost } from '../src/shell/cowork-chat-host.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const history = (sessionId: string): string => `${JSON.stringify({ type: 'session_meta', sessionId })}\n`;

describe('CoworkChatHost', () => {
    it('should cancel stale hydration and remove only the old subscription on session switch', async () => {
        const first = deferred<{ ndjson: string }>();
        const second = deferred<{ ndjson: string }>();
        const third = deferred<{ ndjson: string }>();
        const subscriptions = new Map<string, unknown>();
        const streamClient = {
            reset: vi.fn(), clearCaches: vi.fn(), setJobUpdates: vi.fn(), setStream: vi.fn(),
            set: vi.fn((key: string, handler: unknown) => subscriptions.set(key, handler)),
            delete: vi.fn((key: string) => subscriptions.delete(key)),
        } as unknown as StreamHubClient;
        const rpc: DesktopChatRpcClient = {
            listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
            createSession: vi.fn(), sendMessage: vi.fn(), stopMessage: vi.fn(), subscribe: vi.fn(), onEvent: vi.fn(() => () => {}),
            fetchHistory: vi.fn(({ sessionId }) => ({ one: first, two: second, three: third }[sessionId]!.promise)),
        };
        const host = createCoworkChatHost({ rpc, apiBaseUrl: 'https://api.test/api/v1', streamClient });

        const loadingOne = host.selectSession('one');
        const loadingTwo = host.selectSession('two');
        second.resolve({ ndjson: history('two') });
        await loadingTwo;
        first.resolve({ ndjson: history('one') });
        await loadingOne;

        expect(host.getSnapshot()).toMatchObject({ sessionId: 'two', history: [{ type: 'session_meta', sessionId: 'two' }] });
        const oldKey = Array.from(subscriptions.keys())[0]!;
        const loadingThree = host.selectSession('three');
        expect(streamClient.delete).toHaveBeenCalledWith(oldKey);
        third.resolve({ ndjson: history('three') });
        await loadingThree;
        expect(host.getSnapshot().sessionId).toBe('three');
    });

    it('should accept a reconnect start through a fresh native RuntimePort after the SSE proxy closes', async () => {
        const listeners = new Set<(event: DesktopRpcEvent) => void>();
        const rpc: DesktopChatRpcClient = {
            listSessions: vi.fn(), createSession: vi.fn(), fetchHistory: vi.fn(), sendMessage: vi.fn(), stopMessage: vi.fn(),
            subscribe: vi.fn().mockResolvedValue(undefined),
            onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        };
        const firstPort = createDesktopRpcRuntimePort(rpc);
        firstPort.postMessage({
            type: 'stream_proxy_start',
            payload: { baseUrl: 'https://webview.invalid', workspaceId: 'workspace-1', streamIds: ['stream-1'] },
        });
        await Promise.resolve();
        for (const listener of listeners) listener({ type: 'desktop_rpc_event', event: 'stream.closed' });
        firstPort.disconnect();
        const reconnectPort = createDesktopRpcRuntimePort(rpc);
        reconnectPort.postMessage({
            type: 'stream_proxy_start',
            payload: { baseUrl: 'https://webview.invalid', workspaceId: 'workspace-1', streamIds: ['stream-1'] },
        });
        await Promise.resolve();

        expect(rpc.subscribe).toHaveBeenCalledTimes(2);
        expect(rpc.subscribe).toHaveBeenNthCalledWith(2, { workspaceId: 'workspace-1', streamIds: ['stream-1'] });
    });

    it('should surface malformed NDJSON only on the active session', async () => {
        const streamClient = {
            reset: vi.fn(), clearCaches: vi.fn(), setJobUpdates: vi.fn(), setStream: vi.fn(), set: vi.fn(), delete: vi.fn(),
        } as unknown as StreamHubClient;
        const rpc: DesktopChatRpcClient = {
            listSessions: vi.fn(), createSession: vi.fn(), sendMessage: vi.fn(), stopMessage: vi.fn(), subscribe: vi.fn(), onEvent: vi.fn(() => () => {}),
            fetchHistory: vi.fn().mockResolvedValue({ ndjson: '{not-json}\n' }),
        };
        const host = createCoworkChatHost({ rpc, apiBaseUrl: 'https://api.test/api/v1', streamClient });

        await host.selectSession('broken-session');

        expect(host.getSnapshot()).toMatchObject({ sessionId: 'broken-session', loading: false });
        expect(host.getSnapshot().error).toMatch(/JSON/i);
    });

    it('should select the durable session id returned when a new message creates a session', async () => {
        const streamClient = {
            reset: vi.fn(), clearCaches: vi.fn(), setJobUpdates: vi.fn(), setStream: vi.fn(), set: vi.fn(), delete: vi.fn(),
        } as unknown as StreamHubClient;
        const rpc: DesktopChatRpcClient = {
            listSessions: vi.fn().mockResolvedValue({ sessions: [] }), createSession: vi.fn(), stopMessage: vi.fn(), subscribe: vi.fn(), onEvent: vi.fn(() => () => {}),
            fetchHistory: vi.fn().mockResolvedValue({ ndjson: history('durable-session') }),
            sendMessage: vi.fn().mockResolvedValue({
                sessionId: 'durable-session', userMessageId: 'message-1', assistantMessageId: 'message-2', streamId: 'stream-1', jobId: 'job-1',
            }),
        };
        const host = createCoworkChatHost({ rpc, apiBaseUrl: 'https://api.test/api/v1', streamClient });

        await host.send('Start a new conversation');

        expect(host.getSnapshot().sessionId).toBe('durable-session');
        expect(rpc.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Start a new conversation' }));
        expect(rpc.fetchHistory).toHaveBeenCalledWith({ workspaceId: undefined, sessionId: 'durable-session' });
    });
});
