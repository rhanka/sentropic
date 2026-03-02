import '../src/app.css';

import ChatWidget from '$lib/components/ChatWidget.svelte';
import { initApiClient } from '$lib/core/api-client';
import { createExtensionContextProvider } from '$lib/core/context-provider';
import { createExtensionNavigation, initNavigation } from '$lib/core/navigation-adapter';
import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
import { initializeSession } from '$lib/stores/session';
import { init as initI18n, register } from 'svelte-i18n';
import { mount as mountSvelte } from 'svelte';
import {
  createVsCodeBridge,
  createWindowVsCodeBridgeTransport,
  type VsCodeBridge,
} from './vscode-bridge';

import en from '../src/locales/en.json';
import fr from '../src/locales/fr.json';

type TopAiRuntimeConfig = {
  profile: 'uat' | 'prod';
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  sessionToken?: string;
  codexSignInUrl?: string;
  updatedAt?: number;
};

type PersistedRuntimeConfig = {
  profile?: 'uat' | 'prod';
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  updatedAt?: number;
};

declare global {
  interface Window {
    __TOPAI_VSCODE_RUNTIME__?: TopAiRuntimeConfig;
  }
}

const RUNTIME_CONFIG_STORAGE_KEY = 'topai.vscode.runtime.config';
const DEFAULT_RUNTIME_CONFIG: Required<TopAiRuntimeConfig> = {
  profile: 'uat',
  apiBaseUrl: 'http://localhost:8705/api/v1',
  appBaseUrl: 'http://localhost:5173',
  wsBaseUrl: '',
  sessionToken: '',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
  updatedAt: Date.now(),
};

type RuntimeState = {
  config: Required<TopAiRuntimeConfig>;
  bridge: VsCodeBridge | null;
};

type ExtensionMessage = {
  type?: unknown;
  payload?: unknown;
};

const root = document.getElementById('topai-vscode-root');
if (!root) {
  throw new Error('Missing #topai-vscode-root container.');
}

register('en', () => Promise.resolve(en));
register('fr', () => Promise.resolve(fr));

const browserLocale = (navigator.language || 'fr').split('-')[0].toLowerCase();
initI18n({
  fallbackLocale: 'fr',
  initialLocale: browserLocale === 'en' ? 'en' : 'fr',
});

const normalizeRuntimeConfig = (
  raw?: Partial<TopAiRuntimeConfig> | null,
): Required<TopAiRuntimeConfig> => {
  const profile = raw?.profile === 'prod' ? 'prod' : 'uat';
  const apiBaseUrl = raw?.apiBaseUrl?.trim() || DEFAULT_RUNTIME_CONFIG.apiBaseUrl;
  const appBaseUrl = raw?.appBaseUrl?.trim() || DEFAULT_RUNTIME_CONFIG.appBaseUrl;
  const wsBaseUrl = raw?.wsBaseUrl?.trim() || '';
  const sessionToken = raw?.sessionToken?.trim() || '';
  const codexSignInUrl =
    raw?.codexSignInUrl?.trim() || DEFAULT_RUNTIME_CONFIG.codexSignInUrl;

  return {
    profile,
    apiBaseUrl,
    appBaseUrl,
    wsBaseUrl,
    sessionToken,
    codexSignInUrl,
    updatedAt:
      typeof raw?.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
};

const loadPersistedRuntimeConfig = (): PersistedRuntimeConfig => {
  try {
    const raw = localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = (JSON.parse(raw) as PersistedRuntimeConfig) ?? {};
    return {
      profile: parsed.profile === 'prod' ? 'prod' : parsed.profile === 'uat' ? 'uat' : undefined,
      apiBaseUrl: typeof parsed.apiBaseUrl === 'string' ? parsed.apiBaseUrl : undefined,
      appBaseUrl: typeof parsed.appBaseUrl === 'string' ? parsed.appBaseUrl : undefined,
      wsBaseUrl: typeof parsed.wsBaseUrl === 'string' ? parsed.wsBaseUrl : undefined,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    };
  } catch {
    return {};
  }
};

const persistRuntimeConfig = (config: Required<TopAiRuntimeConfig>): void => {
  const persisted: PersistedRuntimeConfig = {
    profile: config.profile,
    apiBaseUrl: config.apiBaseUrl,
    appBaseUrl: config.appBaseUrl,
    wsBaseUrl: config.wsBaseUrl,
    updatedAt: config.updatedAt,
  };
  localStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(persisted));
};

const createBridge = (): VsCodeBridge | null => {
  try {
    const transport = createWindowVsCodeBridgeTransport();
    return createVsCodeBridge(transport);
  } catch {
    return null;
  }
};

const applyApiRuntimeConfig = (
  config: Required<TopAiRuntimeConfig>,
): void => {
  initApiClient({
    baseUrl: config.apiBaseUrl,
    isBrowser: true,
    authToken: config.sessionToken || undefined,
  });
  initNavigation(createExtensionNavigation(config.apiBaseUrl));
};

const fetchSessionUser = async (
  config: Required<TopAiRuntimeConfig>,
): Promise<
  | {
      ok: true;
      user: { id: string; email: string | null; displayName: string | null; role: string };
    }
  | {
      ok: false;
      error: string;
      status?: number;
    }
> => {
  const endpoint = `${config.apiBaseUrl.replace(/\/$/, '')}/auth/session`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: {
        ...(config.sessionToken
          ? { Authorization: `Bearer ${config.sessionToken}` }
          : {}),
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      };
    }
    const payload = (await response.json()) as {
      userId?: string;
      email?: string | null;
      displayName?: string | null;
      role?: string;
    };
    if (!payload?.userId) {
      return {
        ok: false,
        error: 'Invalid auth/session payload.',
      };
    }
    return {
      ok: true,
      user: {
        id: payload.userId,
        email: payload.email ?? null,
        displayName: payload.displayName ?? null,
        role: payload.role ?? 'editor',
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const normalizeConfigSetPayload = (
  payload: unknown,
  current: Required<TopAiRuntimeConfig>,
): Required<TopAiRuntimeConfig> => {
  const raw =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};

  return normalizeRuntimeConfig({
    profile: raw.profile === 'prod' ? 'prod' : raw.profile === 'uat' ? 'uat' : current.profile,
    apiBaseUrl:
      typeof raw.apiBaseUrl === 'string' ? raw.apiBaseUrl : current.apiBaseUrl,
    appBaseUrl:
      typeof raw.appBaseUrl === 'string' ? raw.appBaseUrl : current.appBaseUrl,
    wsBaseUrl:
      typeof raw.wsBaseUrl === 'string' ? raw.wsBaseUrl : current.wsBaseUrl,
    sessionToken:
      typeof raw.sessionToken === 'string'
        ? raw.sessionToken
        : current.sessionToken,
    codexSignInUrl: current.codexSignInUrl,
    updatedAt: Date.now(),
  });
};

const installExtensionRuntimeShim = (state: RuntimeState): void => {
  const ext = globalThis as typeof globalThis & {
    chrome?: {
      runtime?: {
        id?: string;
        sendMessage?: (message: ExtensionMessage) => Promise<unknown>;
      };
    };
  };
  const existing = ext.chrome ?? {};

  const sendMessage = async (message: ExtensionMessage): Promise<unknown> => {
    const type = typeof message?.type === 'string' ? message.type : '';
    const loginUrl = `${state.config.appBaseUrl.replace(/\/$/, '')}/auth/login`;

    if (type === 'extension_config_get') {
      return {
        ok: true,
        config: {
          profile: state.config.profile,
          apiBaseUrl: state.config.apiBaseUrl,
          appBaseUrl: state.config.appBaseUrl,
          wsBaseUrl: state.config.wsBaseUrl,
          sessionToken: state.config.sessionToken,
          updatedAt: state.config.updatedAt,
        },
      };
    }

    if (type === 'extension_config_set') {
      const nextConfig = normalizeConfigSetPayload(message.payload, state.config);

      if (state.bridge) {
        const synced = await state.bridge.request<Partial<TopAiRuntimeConfig>>(
          'runtime.config.set',
          {
            apiBaseUrl: nextConfig.apiBaseUrl,
            appBaseUrl: nextConfig.appBaseUrl,
            wsBaseUrl: nextConfig.wsBaseUrl,
            sessionToken: nextConfig.sessionToken,
          },
        );
        state.config = normalizeRuntimeConfig({
          ...state.config,
          ...nextConfig,
          ...(synced ?? {}),
          updatedAt: Date.now(),
        });
      } else {
        state.config = nextConfig;
      }

      persistRuntimeConfig(state.config);
      applyApiRuntimeConfig(state.config);
      return {
        ok: true,
        config: {
          profile: state.config.profile,
          apiBaseUrl: state.config.apiBaseUrl,
          appBaseUrl: state.config.appBaseUrl,
          wsBaseUrl: state.config.wsBaseUrl,
          sessionToken: state.config.sessionToken,
          updatedAt: state.config.updatedAt,
        },
      };
    }

    if (type === 'extension_config_test') {
      const payload =
        message.payload && typeof message.payload === 'object'
          ? (message.payload as Record<string, unknown>)
          : {};
      const apiBaseUrl =
        typeof payload.apiBaseUrl === 'string' && payload.apiBaseUrl.trim().length > 0
          ? payload.apiBaseUrl.trim()
          : state.config.apiBaseUrl;

      if (state.bridge) {
        const result = await state.bridge.request<{
          ok: boolean;
          status?: number;
          statusText?: string;
          error?: string;
        }>('runtime.config.test', { apiBaseUrl });
        return result;
      }

      const healthUrl = `${apiBaseUrl.replace(/\/$/, '')}/health`;
      try {
        const response = await fetch(healthUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            ...(state.config.sessionToken
              ? { Authorization: `Bearer ${state.config.sessionToken}` }
              : {}),
          },
        });
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          error: response.ok
            ? undefined
            : `HTTP ${response.status}: ${response.statusText}`,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (type === 'extension_auth_status') {
      const session = await fetchSessionUser(state.config);
      if (!session.ok) {
        return {
          ok: true,
          status: {
            connected: false,
            reason:
              session.status === 401 || session.status === 403
                ? 'not_connected'
                : session.error,
            user: null,
          },
        };
      }
      return {
        ok: true,
        status: {
          connected: true,
          reason: 'connected',
          user: session.user,
        },
      };
    }

    if (type === 'extension_auth_connect') {
      const session = await fetchSessionUser(state.config);
      if (!session.ok) {
        return {
          ok: false,
          code: 'APP_SESSION_REQUIRED',
          error: session.error,
          loginUrl,
        };
      }
      return {
        ok: true,
        user: session.user,
      };
    }

    if (type === 'extension_auth_logout') {
      return { ok: true };
    }

    if (type === 'extension_auth_open_login') {
      return {
        ok: false,
        code: 'UNSUPPORTED',
        error: 'Provider login is managed from admin web app settings.',
      };
    }

    return {
      ok: false,
      error: `Unsupported runtime message: ${type}`,
    };
  };

  ext.chrome = {
    ...existing,
    runtime: {
      ...(existing.runtime ?? {}),
      id: 'topai.vscode.runtime',
      sendMessage,
    },
  };
};

const bootstrapRuntimeState = async (): Promise<RuntimeState> => {
  const bridge = createBridge();
  const hostRuntime = window.__TOPAI_VSCODE_RUNTIME__ ?? {};
  let hostConfig: Partial<TopAiRuntimeConfig> = hostRuntime;
  if (bridge) {
    try {
      const config = await bridge.request<Partial<TopAiRuntimeConfig>>(
        'runtime.config.get',
      );
      hostConfig = {
        ...hostConfig,
        ...(config ?? {}),
      };
    } catch {
      // Keep host injected fallback config.
    }
  }

  const persisted = loadPersistedRuntimeConfig();
  const config = normalizeRuntimeConfig({
    ...hostConfig,
    ...persisted,
    sessionToken:
      hostConfig.sessionToken?.trim() ||
      DEFAULT_RUNTIME_CONFIG.sessionToken,
    codexSignInUrl:
      hostConfig.codexSignInUrl?.trim() ||
      DEFAULT_RUNTIME_CONFIG.codexSignInUrl,
  });
  persistRuntimeConfig(config);
  applyApiRuntimeConfig(config);

  return {
    config,
    bridge,
  };
};

const contextProvider = createExtensionContextProvider({
  route: { id: '/vscode' },
  params: {},
  url: new URL('https://top-ai-ideas.local/vscode'),
});

const initialState: ChatWidgetHandoffState = {
  activeTab: 'chat',
  chatSessionId: null,
  draft: '',
  commentThreadId: null,
  commentSectionKey: null,
  displayMode: 'docked',
  isOpen: true,
  updatedAt: Date.now(),
  source: 'sidepanel',
};

const boot = async (): Promise<void> => {
  const runtimeState = await bootstrapRuntimeState();
  installExtensionRuntimeShim(runtimeState);
  await initializeSession();

  mountSvelte(ChatWidget, {
    target: root,
    props: {
      contextProvider,
      hostMode: 'sidepanel',
      initialState,
    },
  });
};

void boot();
