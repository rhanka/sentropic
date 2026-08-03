import type { StreamHubClient, StreamHubEvent } from '@sentropic/chat-ui/client/streamTypes';
import type { ChatCoreTransport } from '@sentropic/chat-ui/client/transport';
import { createWebHost, type ChatUiWebHost } from '@sentropic/chat-ui/hosts/createWebHost';

import {
    createHydrationGenerations,
    createNdjsonSplitter,
    parseSessionHistoryLine,
    type SessionHistoryLine,
} from '@sentropic/chat-ui/state/chatSessionHydration';
import { projectSessionList, type SessionListEntry } from '@sentropic/chat-ui/state/sessionList';
import type { DesktopChatRpcClient, DesktopRunHandle } from '@sentropic/cowork-bridge/desktop-rpc';

export type CoworkChatSnapshot = {
    sessionId: string | null;
    sessions: SessionListEntry[];
    history: SessionHistoryLine[];
    loading: boolean;
    error: string | null;
};

export type CoworkChatHost = {
    readonly webHost: ChatUiWebHost;
    getSnapshot(): CoworkChatSnapshot;
    subscribe(listener: (snapshot: CoworkChatSnapshot) => void): () => void;
    refreshSessions(): Promise<void>;
    selectSession(sessionId: string): Promise<void>;
    createSession(sessionTitle?: string): Promise<string>;
    send(content: string, input?: { providerId?: string; model?: string }): Promise<DesktopRunHandle>;
    stop(messageId: string): Promise<void>;
    disconnect(): void;
};

export type CoworkChatHostDeps = {
    rpc: DesktopChatRpcClient;
    apiBaseUrl: string;
    workspaceId?: string;
    /** Browser-facing StreamHub, configured with the desktop RuntimePort proxy. */
    streamClient: StreamHubClient;
};

const createResponse = (value: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });

/**
 * Framework-neutral controller for Cowork's embedded chat view. A selection
 * has one generation: changing it cancels stale hydration and removes only
 * that selection's StreamHub subscription.
 */
export const createCoworkChatHost = (deps: CoworkChatHostDeps): CoworkChatHost => {
    const generations = createHydrationGenerations();
    const listeners = new Set<(snapshot: CoworkChatSnapshot) => void>();
    let activeAbort: AbortController | null = null;
    let activeSubscriptionKey: string | null = null;
    let snapshot: CoworkChatSnapshot = {
        sessionId: null,
        sessions: [],
        history: [],
        loading: false,
        error: null,
    };

    const streamClient = deps.streamClient;

    const publish = (): void => {
        const next = { ...snapshot, sessions: [...snapshot.sessions], history: [...snapshot.history] };
        for (const listener of listeners) listener(next);
    };
    const setSnapshot = (next: Partial<CoworkChatSnapshot>): void => {
        snapshot = { ...snapshot, ...next };
        publish();
    };
    const removeActiveSubscription = (): void => {
        if (!activeSubscriptionKey) return;
        streamClient.delete(activeSubscriptionKey);
        activeSubscriptionKey = null;
    };
    const transport: ChatCoreTransport = {
        openStream() {
            throw new Error('Cowork uses the authenticated StreamHub RPC proxy.');
        },
        async postMessage(sessionId, body) {
            const content = typeof (body as { content?: unknown }).content === 'string'
                ? (body as { content: string }).content
                : '';
            const result = await send(content, { sessionId });
            return createResponse(result);
        },
        async fetchBootstrap() {
            throw new Error('Cowork hydrates chat history through the desktop RPC boundary.');
        },
        async fetchSessions() {
            const result = await deps.rpc.listSessions({ workspaceId: deps.workspaceId });
            return {
                sessions: result.sessions.map((session) => ({
                    ...session,
                    title: session.title ?? '',
                    updatedAt: session.updatedAt ?? session.createdAt,
                })),
            };
        },
        async fetchSessionHistory(sessionId) {
            const result = await deps.rpc.fetchHistory({ workspaceId: deps.workspaceId, sessionId });
            return new Response(result.ndjson, { headers: { 'Content-Type': 'application/x-ndjson' } });
        },
        async sendMessage(input) {
            return send(input.content, {
                sessionId: input.sessionId,
                providerId: input.providerId,
                model: input.model,
            });
        },
        async retryMessage() { throw new Error('Cowork retry is not available in the embedded shell.'); },
        async stopMessage(messageId) { await deps.rpc.stopMessage({ workspaceId: deps.workspaceId, messageId }); },
        async editMessage() { throw new Error('Cowork editing is not available in the embedded shell.'); },
        async setFeedback() { throw new Error('Cowork feedback is not available in the embedded shell.'); },
        async deleteSession() { throw new Error('Cowork deletion is not available in the embedded shell.'); },
        async pollJob() { return { status: 'pending' }; },
        async postLocalToolResult() { throw new Error('Cowork never advertises local desktop tools.'); },
        async postSteer() { throw new Error('Cowork steer is not available in the embedded shell.'); },
        async fetchModelCatalog() { return { providers: [], models: [] }; },
    };
    // No localTools adapter: published chat-ui therefore cannot advertise tools from this controller.
    const webHost = createWebHost({ transport, streamClient });

    const refreshSessions = async (): Promise<void> => {
        const result = await deps.rpc.listSessions({ workspaceId: deps.workspaceId });
        setSnapshot({ sessions: projectSessionList(result.sessions) });
    };

    const selectSession = async (sessionId: string): Promise<void> => {
        activeAbort?.abort();
        removeActiveSubscription();
        const generation = generations.begin();
        const abort = new AbortController();
        activeAbort = abort;
        setSnapshot({ sessionId, history: [], loading: true, error: null });
        try {
            const result = await deps.rpc.fetchHistory({ workspaceId: deps.workspaceId, sessionId });
            if (abort.signal.aborted || !generation.isCurrent()) return;
            const history = parseHistory(result.ndjson, generation.isCurrent);
            if (abort.signal.aborted || !generation.isCurrent()) return;
            const key = `cowork-chat:${sessionId}:${generation.generation}`;
            activeSubscriptionKey = key;
            streamClient.set(key, (event) => onStreamEvent(event, sessionId, generation.isCurrent));
            setSnapshot({ history, loading: false });
        } catch (error) {
            if (abort.signal.aborted || !generation.isCurrent()) return;
            setSnapshot({ loading: false, error: error instanceof Error ? error.message : 'Unable to load chat history.' });
        }
    };

    const createSession = async (sessionTitle?: string): Promise<string> => {
        const result = await deps.rpc.createSession({ workspaceId: deps.workspaceId, sessionTitle });
        await refreshSessions();
        await selectSession(result.sessionId);
        return result.sessionId;
    };

    const send = async (
        content: string,
        input?: { sessionId?: string; providerId?: string; model?: string },
    ): Promise<DesktopRunHandle> => {
        const result = await deps.rpc.sendMessage({
            workspaceId: deps.workspaceId,
            ...(input?.sessionId ?? snapshot.sessionId ? { sessionId: input?.sessionId ?? snapshot.sessionId ?? undefined } : {}),
            content,
            ...(input?.providerId ? { providerId: input.providerId } : {}),
            ...(input?.model ? { model: input.model } : {}),
        });
        if (result.sessionId !== snapshot.sessionId) await selectSession(result.sessionId);
        void refreshSessions().catch(() => {});
        return result;
    };

    return {
        webHost,
        getSnapshot: () => ({ ...snapshot, sessions: [...snapshot.sessions], history: [...snapshot.history] }),
        subscribe(listener) {
            listeners.add(listener);
            listener({ ...snapshot, sessions: [...snapshot.sessions], history: [...snapshot.history] });
            return () => listeners.delete(listener);
        },
        refreshSessions,
        selectSession,
        createSession,
        send,
        async stop(messageId) { await deps.rpc.stopMessage({ workspaceId: deps.workspaceId, messageId }); },
        disconnect() {
            activeAbort?.abort();
            activeAbort = null;
            generations.invalidate();
            removeActiveSubscription();
            setSnapshot({ loading: false });
        },
    };
};

const parseHistory = (ndjson: string, isCurrent: () => boolean): SessionHistoryLine[] => {
    const splitter = createNdjsonSplitter();
    const encoder = new TextEncoder();
    const lines = [...splitter.push(encoder.encode(ndjson)), splitter.flush()].filter((line): line is string => line !== null);
    const history: SessionHistoryLine[] = [];
    for (const line of lines) {
        if (!isCurrent()) return [];
        const parsed = parseSessionHistoryLine(line);
        if (parsed) history.push(parsed);
    }
    return history;
};

const onStreamEvent = (event: StreamHubEvent, sessionId: string, isCurrent: () => boolean): void => {
    if (!isCurrent()) return;
    // The published conversation component owns live rendering. This guard keeps
    // a stale selected session from observing events after a reselect.
    void event;
    void sessionId;
};
