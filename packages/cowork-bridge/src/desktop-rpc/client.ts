import {
    DesktopRpcError,
    type DesktopChatRpcClient,
    type DesktopRpcEndpoint,
    type DesktopRpcEvent,
    type DesktopRpcMessage,
    type DesktopRpcRequest,
    type DesktopRpcResponse,
    type DesktopRpcVerb,
    type DesktopRunHandle,
    type DesktopSendMessageInput,
    type DesktopSession,
} from './types.js';

/** Structural mirror of chat-ui RuntimePortLike; bridge keeps no runtime dependency on chat-ui. */
export type DesktopRuntimePortLike = {
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: {
        addListener(listener: (message: unknown) => void): void;
        removeListener(listener: (message: unknown) => void): void;
    };
    onDisconnect: {
        addListener(listener: () => void): void;
        removeListener(listener: () => void): void;
    };
};

const isResponse = (message: DesktopRpcMessage, id: string): message is DesktopRpcResponse =>
    message.type === 'desktop_rpc_response' && message.id === id;

/**
 * Creates the renderer-side chat client. It can send only typed verbs over the
 * native message channel; it has no way to add Authorization headers.
 */
export const createDesktopChatRpcClient = (endpoint: DesktopRpcEndpoint): DesktopChatRpcClient => {
    let sequence = 0;
    const eventListeners = new Set<(event: DesktopRpcEvent) => void>();
    endpoint.onMessage((message) => {
        if (message.type !== 'desktop_rpc_event') return;
        for (const listener of eventListeners) listener(message);
    });

    const request = <Result>(verb: DesktopRpcVerb, payload: unknown): Promise<Result> =>
        new Promise((resolve, reject) => {
            const id = `cowork-${++sequence}`;
            const remove = endpoint.onMessage((message) => {
                if (!isResponse(message, id)) return;
                remove();
                if (!message.ok) {
                    reject(new DesktopRpcError(message.error.code, message.error.message));
                    return;
                }
                resolve(message.result as Result);
            });
            try {
                endpoint.postMessage({ id, type: 'desktop_rpc_request', verb, payload });
            } catch (error) {
                remove();
                reject(error);
            }
        });

    return {
        listSessions: (input) => request<{ sessions: DesktopSession[] }>('sessions.list', input),
        createSession: (input) => request<{ sessionId: string }>('sessions.create', input),
        fetchHistory: (input) => request<{ ndjson: string }>('sessions.history', input),
        sendMessage: (input: DesktopSendMessageInput) => request<DesktopRunHandle>('messages.send', input),
        async stopMessage(input) {
            await request('messages.stop', input);
        },
        async subscribe(input) {
            await request('stream.subscribe', input);
        },
        onEvent(listener) {
            eventListeners.add(listener);
            return () => eventListeners.delete(listener);
        },
    };
};

/**
 * Adapts the narrow RPC event channel to chat-ui's existing RuntimePortLike
 * seam. StreamHub asks to start its proxy synchronously, then native events
 * are relayed as its existing sse_event/sse_closed protocol.
 */
export const createDesktopRpcRuntimePort = (client: DesktopChatRpcClient): DesktopRuntimePortLike => {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    let disconnected = false;
    const unsubscribe = client.onEvent((event) => {
        if (disconnected) return;
        if (event.event === 'stream.event') {
            for (const listener of messageListeners) {
                listener({ type: 'sse_event', eventType: event.eventType, payload: event.payload });
            }
            return;
        }
        for (const listener of messageListeners) listener({ type: 'sse_closed' });
    });

    return {
        postMessage(message) {
            if (disconnected || !isStreamStart(message)) return;
            void client.subscribe({
                workspaceId: message.payload.workspaceId,
                streamIds: message.payload.streamIds,
            }).catch(() => {
                for (const listener of messageListeners) listener({ type: 'sse_error' });
            });
        },
        disconnect() {
            if (disconnected) return;
            disconnected = true;
            unsubscribe();
            for (const listener of disconnectListeners) listener();
        },
        onMessage: {
            addListener(listener) {
                messageListeners.add(listener);
            },
            removeListener(listener) {
                messageListeners.delete(listener);
            },
        },
        onDisconnect: {
            addListener(listener) {
                disconnectListeners.add(listener);
            },
            removeListener(listener) {
                disconnectListeners.delete(listener);
            },
        },
    };
};

const isStreamStart = (message: unknown): message is {
    type: 'stream_proxy_start';
    payload: { workspaceId?: string; streamIds?: string[] };
} => {
    if (!message || typeof message !== 'object') return false;
    const value = message as { type?: unknown; payload?: unknown };
    if (value.type !== 'stream_proxy_start' || !value.payload || typeof value.payload !== 'object') return false;
    const payload = value.payload as { workspaceId?: unknown; streamIds?: unknown };
    return (
        (payload.workspaceId === undefined || typeof payload.workspaceId === 'string') &&
        (payload.streamIds === undefined ||
            (Array.isArray(payload.streamIds) && payload.streamIds.every((id) => typeof id === 'string')))
    );
};
