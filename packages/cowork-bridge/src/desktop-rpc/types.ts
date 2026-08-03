/**
 * Native-only chat RPC contract for an embedded Cowork WebView.
 *
 * The renderer gets chat verbs, never an HTTP capability or an access token.
 */

export const DESKTOP_RPC_MAX_BODY_BYTES = 32_768;
export const DESKTOP_RPC_MAX_RESPONSE_BYTES = 1_048_576;
export const DESKTOP_RPC_MAX_HISTORY_BYTES = 2_097_152;

export type DesktopRpcVerb =
    | 'sessions.list'
    | 'sessions.create'
    | 'sessions.history'
    | 'messages.send'
    | 'messages.stop'
    | 'stream.subscribe';

export type DesktopRpcRequest = {
    id: string;
    type: 'desktop_rpc_request';
    verb: DesktopRpcVerb;
    payload: unknown;
};

export type DesktopRpcResponse =
    | { id: string; type: 'desktop_rpc_response'; ok: true; result: unknown }
    | {
        id: string;
        type: 'desktop_rpc_response';
        ok: false;
        error: { code: string; message: string };
    };

/** Events are the only way native SSE data crosses into the WebView. */
export type DesktopRpcEvent =
    | {
        type: 'desktop_rpc_event';
        event: 'stream.event';
        eventType: string;
        payload: unknown;
    }
    | {
        type: 'desktop_rpc_event';
        event: 'stream.closed';
    };

export type DesktopRpcMessage = DesktopRpcResponse | DesktopRpcEvent;

export type DesktopRpcMessageListener = (message: DesktopRpcMessage) => void;

/** The only messaging primitive required from a WebView2 binding. */
export interface DesktopRpcEndpoint {
    postMessage(message: DesktopRpcRequest): void;
    onMessage(listener: DesktopRpcMessageListener): () => void;
}

/** Transport returned to the WebView shell. It deliberately exposes no token API. */
export interface DesktopChatRpcClient {
    listSessions(input: { workspaceId?: string }): Promise<{ sessions: DesktopSession[] }>;
    createSession(input: { workspaceId?: string; sessionTitle?: string }): Promise<{ sessionId: string }>;
    fetchHistory(input: { workspaceId?: string; sessionId: string }): Promise<{ ndjson: string }>;
    sendMessage(input: DesktopSendMessageInput): Promise<DesktopRunHandle>;
    stopMessage(input: { workspaceId?: string; messageId: string }): Promise<void>;
    subscribe(input: { workspaceId?: string; streamIds?: string[] }): Promise<void>;
    onEvent(listener: (event: DesktopRpcEvent) => void): () => void;
}

export type DesktopSession = {
    id: string;
    title: string | null;
    createdAt: string;
    updatedAt: string | null;
};

/** Intentionally excludes tools/localToolDefinitions and every desktop capability. */
export type DesktopSendMessageInput = {
    workspaceId?: string;
    sessionId?: string;
    content: string;
    providerId?: string;
    model?: string;
};

export type DesktopRunHandle = {
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    streamId: string;
    jobId: string;
};

export class DesktopRpcError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
        this.name = 'DesktopRpcError';
    }
}
