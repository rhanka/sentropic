import { describe, expect, it, vi } from 'vitest';
import {
    createDesktopRpcRuntimePort,
    DesktopRpcServer,
    installLocalWebView2Shell,
    type DesktopChatRpcClient,
    type DesktopRpcEvent,
    type DesktopRpcFetch,
    type DesktopSseConnector,
} from '../src/desktop-rpc/index.js';

const response = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    body: null,
});

const request = (verb: Parameters<DesktopRpcServer['handle']>[0]['verb'], payload: unknown) => ({
    id: 'cowork-1',
    type: 'desktop_rpc_request' as const,
    verb,
    payload,
});

describe('DesktopRpcServer', () => {
    it('should allow only chat verbs and keep the native bearer out of renderer responses', async () => {
        const fetch = vi.fn<DesktopRpcFetch>().mockResolvedValue(response({
            sessions: [{ id: 'session-1', title: 'Private', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: null }],
        }));
        const server = new DesktopRpcServer({
            apiBaseUrl: 'https://api.test/api/v1',
            fetch,
            getAccessToken: async () => 'native-bearer-only',
        });

        const denied = await server.handle(request('messages.send', {
            content: 'hello',
            localToolDefinitions: [{ name: 'screen_capture' }],
        }));
        expect(denied).toMatchObject({ ok: false, error: { code: 'BODY_DENIED' } });
        expect(fetch).not.toHaveBeenCalled();

        const allowed = await server.handle(request('sessions.list', { workspaceId: 'workspace-1' }));
        expect(allowed).toEqual(expect.objectContaining({
            ok: true,
            result: { sessions: [expect.objectContaining({ id: 'session-1' })] },
        }));
        expect(fetch).toHaveBeenCalledWith(
            'https://api.test/api/v1/chat/sessions?workspace_id=workspace-1',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer native-bearer-only' }) }),
        );
        expect(JSON.stringify(allowed)).not.toContain('native-bearer-only');
    });

    it('should bound native responses before returning them to the webview', async () => {
        const server = new DesktopRpcServer({
            apiBaseUrl: 'https://api.test/api/v1',
            fetch: vi.fn<DesktopRpcFetch>().mockResolvedValue(response({ refreshToken: 'must-not-cross' })),
            getAccessToken: async () => 'native-bearer-only',
        });

        const result = await server.handle(request('sessions.list', {}));
        expect(result).toMatchObject({ ok: false, error: { code: 'RESPONSE_INVALID' } });
        expect(JSON.stringify(result)).not.toContain('must-not-cross');
    });

    it('should proxy named authenticated SSE events without exposing its URL or bearer to the renderer', async () => {
        let opened: Parameters<DesktopSseConnector>[0] | undefined;
        const server = new DesktopRpcServer({
            apiBaseUrl: 'https://api.test/api/v1',
            fetch: vi.fn<DesktopRpcFetch>(),
            getAccessToken: async () => 'native-bearer-only',
            connectSse: async (input) => {
                opened = input;
                return { close: vi.fn() };
            },
        });
        const events: DesktopRpcEvent[] = [];

        const result = await server.handle(
            request('stream.subscribe', { workspaceId: 'workspace-1', streamIds: ['stream-1'] }),
            (event) => events.push(event),
        );
        opened?.onEvent('content_delta', { streamId: 'stream-1', sequence: 1, data: 'Hi' });
        opened?.onEvent('content_delta', { accessToken: 'must-not-cross' });

        expect(result).toMatchObject({ ok: true, result: { subscribed: true } });
        expect(opened).toMatchObject({
            url: 'https://api.test/api/v1/streams/sse?workspace_id=workspace-1&streamIds=stream-1',
            headers: { Authorization: 'Bearer native-bearer-only', Accept: 'text/event-stream' },
        });
        expect(events).toEqual([expect.objectContaining({ event: 'stream.event', eventType: 'content_delta' })]);
        expect(JSON.stringify(events)).not.toContain('native-bearer-only');
        expect(JSON.stringify(events)).not.toContain('must-not-cross');
    });
});

describe('createDesktopRpcRuntimePort', () => {
    it('should relay StreamHub protocol events and omit the WebView supplied base URL', async () => {
        const listeners = new Set<(event: DesktopRpcEvent) => void>();
        const client: DesktopChatRpcClient = {
            listSessions: vi.fn(), createSession: vi.fn(), fetchHistory: vi.fn(), sendMessage: vi.fn(), stopMessage: vi.fn(),
            subscribe: vi.fn().mockResolvedValue(undefined),
            onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        };
        const port = createDesktopRpcRuntimePort(client);
        const messages: unknown[] = [];
        port.onMessage.addListener((message) => messages.push(message));

        port.postMessage({
            type: 'stream_proxy_start',
            payload: { baseUrl: 'https://attacker.test', workspaceId: 'workspace-1', streamIds: ['stream-1'] },
        });
        await Promise.resolve();
        for (const listener of listeners) {
            listener({ type: 'desktop_rpc_event', event: 'stream.event', eventType: 'done', payload: { streamId: 'stream-1' } });
            listener({ type: 'desktop_rpc_event', event: 'stream.closed' });
        }

        expect(client.subscribe).toHaveBeenCalledWith({ workspaceId: 'workspace-1', streamIds: ['stream-1'] });
        expect(messages).toEqual([
            { type: 'sse_event', eventType: 'done', payload: { streamId: 'stream-1' } },
            { type: 'sse_closed' },
        ]);
    });
});

describe('installLocalWebView2Shell', () => {
    it('should allow only packaged local navigation and deny new windows, downloads, and remote resources', () => {
        let navigation: ((event: { uri: string; cancel: boolean }) => void) | undefined;
        let newWindow: ((event: { cancel: boolean }) => void) | undefined;
        let download: ((event: { cancel: boolean }) => void) | undefined;
        let resource: ((event: { uri: string; cancel: boolean }) => void) | undefined;
        const navigated: string[] = [];
        const webview = {
            setVirtualHostNameToFolderMapping: vi.fn(),
            navigate: (url: string) => navigated.push(url),
            postWebMessageAsJson: vi.fn(),
            addWebMessageReceived: vi.fn(() => () => {}),
            addNavigationStarting: vi.fn((listener) => { navigation = listener; return () => {}; }),
            addNewWindowRequested: vi.fn((listener) => { newWindow = listener; return () => {}; }),
            addDownloadStarting: vi.fn((listener) => { download = listener; return () => {}; }),
            addWebResourceRequested: vi.fn((listener) => { resource = listener; return () => {}; }),
        };
        const server = new DesktopRpcServer({
            apiBaseUrl: 'https://api.test/api/v1', fetch: vi.fn<DesktopRpcFetch>(), getAccessToken: async () => null,
        });
        installLocalWebView2Shell({ webview, rpcServer: server, assetDirectory: 'C:/cowork/shell' });
        const remoteNavigation = { uri: 'https://attacker.test/app.js', cancel: false };
        const localNavigation = { uri: 'https://cowork.local/index.html', cancel: false };
        const remoteResource = { uri: 'https://attacker.test/app.js', cancel: false };
        const newWindowEvent = { cancel: false };
        const downloadEvent = { cancel: false };

        navigation?.(remoteNavigation);
        navigation?.(localNavigation);
        resource?.(remoteResource);
        newWindow?.(newWindowEvent);
        download?.(downloadEvent);

        expect(webview.setVirtualHostNameToFolderMapping).toHaveBeenCalledWith('cowork.local', 'C:/cowork/shell', 'denyCors');
        expect(navigated).toEqual(['https://cowork.local/index.html']);
        expect(remoteNavigation.cancel).toBe(true);
        expect(localNavigation.cancel).toBe(false);
        expect(remoteResource.cancel).toBe(true);
        expect(newWindowEvent.cancel).toBe(true);
        expect(downloadEvent.cancel).toBe(true);
    });
});
