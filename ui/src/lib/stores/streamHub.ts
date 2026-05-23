import { API_BASE_URL } from '$lib/config';
import { getApiBaseUrl } from '$lib/core/api-client';
import { isAuthenticated } from '$lib/stores/session';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';
import { createStreamHub } from '@sentropic/chat-ui/client/streamHub';
import type {
  RuntimePortLike,
  StreamHubEvent,
} from '@sentropic/chat-ui/client/streamTypes';

export type { StreamHubEvent };

function getStoreValue<T>(store: { subscribe: (run: (v: T) => void) => () => void }): T {
  let value!: T;
  const unsub = store.subscribe((v: T) => {
    value = v;
  });
  unsub();
  return value;
}

const isExtensionHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const runtime = (globalThis as typeof globalThis & {
    chrome?: { runtime?: { id?: string } };
  }).chrome?.runtime;
  return Boolean(runtime?.id);
};

const isVsCodeWebviewRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const runtime = (
    globalThis as typeof globalThis & {
      __TOPAI_VSCODE_RUNTIME__?: Record<string, unknown>;
    }
  ).__TOPAI_VSCODE_RUNTIME__;
  return Boolean(runtime && typeof runtime === 'object');
};

const createExtensionStreamPort = (): RuntimePortLike | null => {
  if (typeof window === 'undefined') return null;
  const runtime = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        connect?: (options: { name: string }) => RuntimePortLike;
      };
    };
  }).chrome?.runtime;
  if (!runtime?.connect) return null;
  try {
    return runtime.connect({ name: 'topai-stream-proxy' });
  } catch {
    return null;
  }
};

export const streamHub = createStreamHub({
  getBaseUrl: () => getApiBaseUrl() ?? API_BASE_URL,
  getAuthState: () => getStoreValue(isAuthenticated),
  getWorkspaceId: () => getScopedWorkspaceIdForUser() ?? null,
  getUrlBaseOrigin: () =>
    typeof window !== 'undefined' ? window.location.origin : undefined,
  shouldUseExtensionProxy: () => isExtensionHost() || isVsCodeWebviewRuntime(),
  extensionPortFactory: createExtensionStreamPort,
  eventTarget: typeof window !== 'undefined' ? window : undefined,
});
