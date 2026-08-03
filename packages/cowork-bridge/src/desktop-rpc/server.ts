import {
    DESKTOP_RPC_MAX_BODY_BYTES,
    DESKTOP_RPC_MAX_HISTORY_BYTES,
    DESKTOP_RPC_MAX_RESPONSE_BYTES,
    DesktopRpcError,
    type DesktopRpcEvent,
    type DesktopRpcRequest,
    type DesktopRpcResponse,
    type DesktopRunHandle,
    type DesktopSession,
} from './types.js';

type JsonRecord = Record<string, unknown>;

export interface DesktopRpcHttpResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
    body?: ReadableStream<Uint8Array> | null;
}

export type DesktopRpcFetch = (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<DesktopRpcHttpResponse>;

export type DesktopSseConnection = { close(): void };

export type DesktopSseConnector = (input: {
    url: string;
    headers: Record<string, string>;
    onEvent(eventType: string, payload: unknown): void;
    onClose(): void;
}) => Promise<DesktopSseConnection>;

export type DesktopRpcServerDeps = {
    apiBaseUrl: string;
    fetch: DesktopRpcFetch;
    getAccessToken: () => Promise<string | null>;
    connectSse?: DesktopSseConnector;
};

/**
 * Native-side allowlisted HTTP gateway. Only this class reads the bearer; the
 * result envelopes are deliberately reduced to the renderer's chat contract.
 */
export class DesktopRpcServer {
    private readonly apiBaseUrl: string;
    private readonly fetch: DesktopRpcFetch;
    private readonly getAccessToken: () => Promise<string | null>;
    private readonly connectSse: DesktopSseConnector;
    private activeSse: DesktopSseConnection | null = null;

    constructor(deps: DesktopRpcServerDeps) {
        this.apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
        this.fetch = deps.fetch;
        this.getAccessToken = deps.getAccessToken;
        this.connectSse = deps.connectSse ?? createFetchSseConnector(deps.fetch);
    }

    async handle(
        request: DesktopRpcRequest,
        emit?: (event: DesktopRpcEvent) => void,
    ): Promise<DesktopRpcResponse> {
        try {
            const result = await this.dispatch(validateRequest(request), emit);
            return { id: request.id, type: 'desktop_rpc_response', ok: true, result };
        } catch (error) {
            const rpcError = error instanceof DesktopRpcError
                ? error
                : new DesktopRpcError('REQUEST_FAILED', 'Native chat request failed.');
            return {
                id: typeof request?.id === 'string' ? request.id : '',
                type: 'desktop_rpc_response',
                ok: false,
                error: { code: rpcError.code, message: rpcError.message },
            };
        }
    }

    disconnect(): void {
        this.activeSse?.close();
        this.activeSse = null;
    }

    private async dispatch(request: ValidRequest, emit?: (event: DesktopRpcEvent) => void): Promise<unknown> {
        switch (request.verb) {
            case 'sessions.list':
                return this.listSessions(request.workspaceId);
            case 'sessions.create':
                return this.createSession(request.workspaceId, request.sessionTitle);
            case 'sessions.history':
                return this.fetchHistory(request.workspaceId, request.sessionId);
            case 'messages.send':
                return this.sendMessage(request);
            case 'messages.stop':
                return this.stopMessage(request.workspaceId, request.messageId);
            case 'stream.subscribe':
                if (!emit) throw new DesktopRpcError('STREAM_UNAVAILABLE', 'No native stream sink is attached.');
                return this.subscribe(request.workspaceId, request.streamIds, emit);
        }
    }

    private async listSessions(workspaceId?: string): Promise<{ sessions: DesktopSession[] }> {
        const response = await this.request('/chat/sessions', 'GET', workspaceId);
        const body = await readJson(response);
        const sessions = asRecord(body).sessions;
        if (!Array.isArray(sessions) || sessions.length > 200) {
            throw new DesktopRpcError('RESPONSE_INVALID', 'Session response is outside the desktop boundary.');
        }
        return { sessions: sessions.map(normalizeSession) };
    }

    private async createSession(workspaceId?: string, sessionTitle?: string): Promise<{ sessionId: string }> {
        const response = await this.request('/chat/sessions', 'POST', workspaceId, {
            ...(sessionTitle ? { sessionTitle } : {}),
        });
        const sessionId = requiredId(asRecord(await readJson(response)).sessionId, 'sessionId');
        return { sessionId };
    }

    private async fetchHistory(workspaceId: string | undefined, sessionId: string): Promise<{ ndjson: string }> {
        const response = await this.request(
            `/chat/sessions/${encodeURIComponent(sessionId)}/history?runtimeDetails=summary`,
            'GET',
            workspaceId,
            undefined,
            { Accept: 'application/x-ndjson' },
        );
        const ndjson = await readText(response, DESKTOP_RPC_MAX_HISTORY_BYTES);
        return { ndjson };
    }

    private async sendMessage(request: Extract<ValidRequest, { verb: 'messages.send' }>): Promise<DesktopRunHandle> {
        const response = await this.request('/chat/messages', 'POST', request.workspaceId, {
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
            content: request.content,
            ...(request.providerId ? { providerId: request.providerId } : {}),
            ...(request.model ? { model: request.model } : {}),
        });
        const body = asRecord(await readJson(response));
        return {
            sessionId: requiredId(body.sessionId, 'sessionId'),
            userMessageId: requiredId(body.userMessageId, 'userMessageId'),
            assistantMessageId: requiredId(body.assistantMessageId, 'assistantMessageId'),
            streamId: requiredId(body.streamId, 'streamId'),
            jobId: requiredId(body.jobId, 'jobId'),
        };
    }

    private async stopMessage(workspaceId: string | undefined, messageId: string): Promise<{ ok: true }> {
        await this.request(`/chat/messages/${encodeURIComponent(messageId)}/stop`, 'POST', workspaceId, {});
        return { ok: true };
    }

    private async subscribe(
        workspaceId: string | undefined,
        streamIds: string[] | undefined,
        emit: (event: DesktopRpcEvent) => void,
    ): Promise<{ subscribed: true }> {
        this.disconnect();
        const query = new URLSearchParams();
        if (workspaceId) query.set('workspace_id', workspaceId);
        for (const streamId of streamIds ?? []) query.append('streamIds', streamId);
        const token = await this.requireToken();
        this.activeSse = await this.connectSse({
            url: `${this.apiBaseUrl}/streams/sse${query.size ? `?${query.toString()}` : ''}`,
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            onEvent: (eventType, payload) => {
                if (!isSafeEvent(eventType, payload)) return;
                emit({ type: 'desktop_rpc_event', event: 'stream.event', eventType, payload });
            },
            onClose: () => {
                this.activeSse = null;
                emit({ type: 'desktop_rpc_event', event: 'stream.closed' });
            },
        });
        return { subscribed: true };
    }

    private async request(
        path: string,
        method: 'GET' | 'POST',
        workspaceId?: string,
        body?: JsonRecord,
        extraHeaders?: Record<string, string>,
    ): Promise<DesktopRpcHttpResponse> {
        const token = await this.requireToken();
        const separator = path.includes('?') ? '&' : '?';
        const url = workspaceId ? `${this.apiBaseUrl}${path}${separator}workspace_id=${encodeURIComponent(workspaceId)}` : `${this.apiBaseUrl}${path}`;
        const response = await this.fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new DesktopRpcError('UPSTREAM_REJECTED', `Chat service rejected the request (${response.status}).`);
        return response;
    }

    private async requireToken(): Promise<string> {
        const token = await this.getAccessToken();
        if (!token) throw new DesktopRpcError('AUTH_REQUIRED', 'Cowork needs to be enrolled before opening chat.');
        return token;
    }
}

type ValidRequest =
    | { verb: 'sessions.list'; workspaceId?: string }
    | { verb: 'sessions.create'; workspaceId?: string; sessionTitle?: string }
    | { verb: 'sessions.history'; workspaceId?: string; sessionId: string }
    | {
        verb: 'messages.send'; workspaceId?: string; sessionId?: string; content: string;
        providerId?: string; model?: string;
    }
    | { verb: 'messages.stop'; workspaceId?: string; messageId: string }
    | { verb: 'stream.subscribe'; workspaceId?: string; streamIds?: string[] };

const validateRequest = (request: DesktopRpcRequest): ValidRequest => {
    if (!request || typeof request !== 'object' || !validId(request.id)) {
        throw new DesktopRpcError('REQUEST_INVALID', 'Desktop RPC request id is invalid.');
    }
    if (request.type !== 'desktop_rpc_request') throw new DesktopRpcError('REQUEST_INVALID', 'Desktop RPC envelope is invalid.');
    const payload = boundedPayload(request.payload);
    switch (request.verb) {
        case 'sessions.list':
            allowOnly(payload, ['workspaceId']);
            return { verb: request.verb, workspaceId: optionalId(payload, 'workspaceId') };
        case 'sessions.create':
            allowOnly(payload, ['workspaceId', 'sessionTitle']);
            return { verb: request.verb, workspaceId: optionalId(payload, 'workspaceId'), sessionTitle: optionalText(payload, 'sessionTitle', 200) };
        case 'sessions.history':
            allowOnly(payload, ['workspaceId', 'sessionId']);
            return { verb: request.verb, workspaceId: optionalId(payload, 'workspaceId'), sessionId: requiredId(payload.sessionId, 'sessionId') };
        case 'messages.send':
            allowOnly(payload, ['workspaceId', 'sessionId', 'content', 'providerId', 'model']);
            return {
                verb: request.verb,
                workspaceId: optionalId(payload, 'workspaceId'),
                sessionId: optionalId(payload, 'sessionId'),
                content: requiredText(payload.content, 'content', 20_000),
                providerId: optionalText(payload, 'providerId', 200),
                model: optionalText(payload, 'model', 200),
            };
        case 'messages.stop':
            allowOnly(payload, ['workspaceId', 'messageId']);
            return { verb: request.verb, workspaceId: optionalId(payload, 'workspaceId'), messageId: requiredId(payload.messageId, 'messageId') };
        case 'stream.subscribe':
            allowOnly(payload, ['workspaceId', 'streamIds']);
            return {
                verb: request.verb,
                workspaceId: optionalId(payload, 'workspaceId'),
                streamIds: optionalIds(payload.streamIds),
            };
        default:
            throw new DesktopRpcError('VERB_DENIED', 'This desktop RPC verb is not allowed.');
    }
};

const boundedPayload = (value: unknown): JsonRecord => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DesktopRpcError('BODY_INVALID', 'Desktop RPC payload must be an object.');
    }
    const encoded = JSON.stringify(value);
    if (encoded.length > DESKTOP_RPC_MAX_BODY_BYTES) throw new DesktopRpcError('BODY_TOO_LARGE', 'Desktop RPC payload is too large.');
    return value as JsonRecord;
};

const allowOnly = (value: JsonRecord, allowed: string[]): void => {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new DesktopRpcError('BODY_DENIED', `Desktop RPC field ${key} is not allowed.`);
    }
};

const validId = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const requiredId = (value: unknown, name: string): string => {
    if (!validId(value)) throw new DesktopRpcError('RESPONSE_INVALID', `${name} is invalid.`);
    return value;
};
const optionalId = (value: JsonRecord, name: string): string | undefined => {
    if (value[name] === undefined) return undefined;
    if (!validId(value[name])) throw new DesktopRpcError('BODY_INVALID', `${name} is invalid.`);
    return value[name] as string;
};
const requiredText = (value: unknown, name: string, max: number): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new DesktopRpcError('BODY_INVALID', `${name} is invalid.`);
    return value;
};
const optionalText = (value: JsonRecord, name: string, max: number): string | undefined =>
    value[name] === undefined ? undefined : requiredText(value[name], name, max);
const optionalIds = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 200 || !value.every(validId)) {
        throw new DesktopRpcError('BODY_INVALID', 'streamIds is invalid.');
    }
    return [...value];
};

const asRecord = (value: unknown): JsonRecord =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const readJson = async (response: DesktopRpcHttpResponse): Promise<unknown> => {
    const value = await response.json();
    if (JSON.stringify(value).length > DESKTOP_RPC_MAX_RESPONSE_BYTES || hasSensitiveKey(value)) {
        throw new DesktopRpcError('RESPONSE_INVALID', 'Chat response is outside the desktop boundary.');
    }
    return value;
};
const readText = async (response: DesktopRpcHttpResponse, max: number): Promise<string> => {
    const text = await response.text();
    if (text.length > max) throw new DesktopRpcError('RESPONSE_TOO_LARGE', 'Chat history exceeds the desktop boundary.');
    return text;
};
const normalizeSession = (value: unknown): DesktopSession => {
    const row = asRecord(value);
    const createdAt = requiredText(row.createdAt, 'createdAt', 100);
    const updatedAt = row.updatedAt === null || row.updatedAt === undefined ? null : requiredText(row.updatedAt, 'updatedAt', 100);
    return {
        id: requiredId(row.id, 'id'),
        title: row.title === null || row.title === undefined ? null : requiredText(row.title, 'title', 500),
        createdAt,
        updatedAt,
    };
};
const hasSensitiveKey = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as JsonRecord).some(([key, nested]) =>
        /^(authorization|accessToken|refreshToken|bearer)$/i.test(key) || hasSensitiveKey(nested));
};
const isSafeEvent = (eventType: string, payload: unknown): boolean =>
    /^[A-Za-z0-9_.:-]{1,80}$/.test(eventType) && !hasSensitiveKey(payload);

/** Default native SSE reader. Tests inject a connector; WebView never opens this URL itself. */
export const createFetchSseConnector = (fetch: DesktopRpcFetch): DesktopSseConnector => async (input) => {
    const controller = new AbortController();
    let closed = false;
    const finish = () => {
        if (closed) return;
        closed = true;
        input.onClose();
    };
    void fetch(input.url, { method: 'GET', headers: input.headers, signal: controller.signal })
        .then(async (response) => {
            if (!response.ok || !response.body) return finish();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let eventType = 'message';
            let data = '';
            const consume = (line: string) => {
                if (line.startsWith('event:')) eventType = line.slice(6).trim() || 'message';
                else if (line.startsWith('data:')) data += line.slice(5).trim();
                else if (line === '') {
                    if (data) {
                        try { input.onEvent(eventType, JSON.parse(data)); } catch { /* ignore malformed SSE */ }
                    }
                    eventType = 'message';
                    data = '';
                }
            };
            while (!closed) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let next = buffer.indexOf('\n');
                while (next >= 0) {
                    consume(buffer.slice(0, next).replace(/\r$/, ''));
                    buffer = buffer.slice(next + 1);
                    next = buffer.indexOf('\n');
                }
            }
            finish();
        })
        .catch(() => finish());
    return { close: () => { controller.abort(); finish(); } };
};
