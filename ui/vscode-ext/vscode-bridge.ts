export const TOPAI_WEBVIEW_SOURCE = 'topai-vscode-webview';
export const TOPAI_HOST_SOURCE = 'topai-vscode-host';

export type VsCodeBridgeRequestEnvelope = {
  source: typeof TOPAI_WEBVIEW_SOURCE;
  type: 'request';
  command: string;
  requestId: string;
  payload?: unknown;
};

export type VsCodeBridgeEventEnvelope = {
  source: typeof TOPAI_WEBVIEW_SOURCE;
  type: 'event';
  command: string;
  payload?: unknown;
};

export type VsCodeBridgeOutgoingEnvelope =
  | VsCodeBridgeRequestEnvelope
  | VsCodeBridgeEventEnvelope;

export type VsCodeBridgeIncomingEnvelope = {
  source: typeof TOPAI_HOST_SOURCE;
  type: 'response' | 'event';
  command: string;
  requestId?: string;
  ok?: boolean;
  payload?: unknown;
  error?: string;
};

export interface VsCodeBridgeTransport {
  postMessage(message: VsCodeBridgeOutgoingEnvelope): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface VsCodeBridge {
  request<T = unknown>(
    command: string,
    payload?: unknown,
    options?: { timeoutMs?: number }
  ): Promise<T>;
  notify(command: string, payload?: unknown): void;
  onEvent(command: string, handler: (payload: unknown) => void): () => void;
  dispose(): void;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type VsCodeApiLike = {
  postMessage(message: unknown): void;
};

const isHostEnvelope = (value: unknown): value is VsCodeBridgeIncomingEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.source !== TOPAI_HOST_SOURCE) return false;
  if (typeof envelope.command !== 'string') return false;
  return envelope.type === 'response' || envelope.type === 'event';
};

const createRequestIdFactory = () => {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `req_${Date.now()}_${sequence}`;
  };
};

const resolveAcquireApi = (
  acquire?: () => VsCodeApiLike
): (() => VsCodeApiLike) => {
  if (acquire) return acquire;
  const globalAcquire = (globalThis as typeof globalThis & {
    acquireVsCodeApi?: () => VsCodeApiLike;
  }).acquireVsCodeApi;
  if (typeof globalAcquire !== 'function') {
    throw new Error('acquireVsCodeApi is unavailable in this runtime.');
  }
  return globalAcquire;
};

export function createWindowVsCodeBridgeTransport(options?: {
  acquireApi?: () => VsCodeApiLike;
}): VsCodeBridgeTransport {
  if (typeof window === 'undefined') {
    throw new Error('Window transport requires browser runtime.');
  }
  const api = resolveAcquireApi(options?.acquireApi)();
  if (!api || typeof api.postMessage !== 'function') {
    throw new Error('Invalid VSCode API bridge (missing postMessage).');
  }

  return {
    postMessage(message: VsCodeBridgeOutgoingEnvelope): void {
      api.postMessage(message);
    },
    subscribe(listener: (message: unknown) => void): () => void {
      const handler = (event: MessageEvent<unknown>) => {
        listener(event.data);
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
      };
    },
  };
}

export function createVsCodeBridge(
  transport: VsCodeBridgeTransport,
  options?: { defaultTimeoutMs?: number }
): VsCodeBridge {
  const requestIdFactory = createRequestIdFactory();
  const pending = new Map<string, PendingRequest>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  const defaultTimeoutMs = Math.max(1, options?.defaultTimeoutMs ?? 10_000);

  const unsubscribe = transport.subscribe((rawMessage: unknown) => {
    if (!isHostEnvelope(rawMessage)) return;

    if (rawMessage.type === 'response') {
      const requestId = typeof rawMessage.requestId === 'string' ? rawMessage.requestId : '';
      if (!requestId || !pending.has(requestId)) return;

      const request = pending.get(requestId) as PendingRequest;
      clearTimeout(request.timeoutId);
      pending.delete(requestId);

      if (rawMessage.ok === false) {
        request.reject(new Error(rawMessage.error ?? `Host request failed: ${rawMessage.command}`));
        return;
      }

      request.resolve(rawMessage.payload);
      return;
    }

    const handlers = eventHandlers.get(rawMessage.command);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      handler(rawMessage.payload);
    }
  });

  return {
    request<T>(
      command: string,
      payload?: unknown,
      requestOptions?: { timeoutMs?: number }
    ): Promise<T> {
      const requestId = requestIdFactory();
      const timeoutMs = Math.max(1, requestOptions?.timeoutMs ?? defaultTimeoutMs);

      return new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Bridge request timed out (${command}).`));
        }, timeoutMs);

        pending.set(requestId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeoutId,
        });

        transport.postMessage({
          source: TOPAI_WEBVIEW_SOURCE,
          type: 'request',
          command,
          requestId,
          payload,
        });
      });
    },

    notify(command: string, payload?: unknown): void {
      transport.postMessage({
        source: TOPAI_WEBVIEW_SOURCE,
        type: 'event',
        command,
        payload,
      });
    },

    onEvent(command: string, handler: (payload: unknown) => void): () => void {
      const handlers = eventHandlers.get(command) ?? new Set<(payload: unknown) => void>();
      handlers.add(handler);
      eventHandlers.set(command, handlers);

      return () => {
        const currentHandlers = eventHandlers.get(command);
        if (!currentHandlers) return;
        currentHandlers.delete(handler);
        if (currentHandlers.size === 0) {
          eventHandlers.delete(command);
        }
      };
    },

    dispose(): void {
      unsubscribe();
      for (const [requestId, request] of pending.entries()) {
        clearTimeout(request.timeoutId);
        request.reject(new Error(`Bridge disposed before response (${requestId}).`));
      }
      pending.clear();
      eventHandlers.clear();
    },
  };
}
