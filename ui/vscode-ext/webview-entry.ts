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
import {
  resolveCodeAgentPromptProfile,
  type CodeAgentPromptSource,
} from '../src/lib/vscode/code-agent-profile';

import en from '../src/locales/en.json';
import fr from '../src/locales/fr.json';

type TopAiRuntimeConfig = {
  profile: 'uat' | 'prod';
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  sessionToken?: string;
  codexSignInUrl?: string;
  codeAgentPromptDefault?: string;
  codeAgentPromptGlobal?: string;
  codeAgentPromptWorkspace?: string;
  codeAgentPromptEffective?: string;
  codeAgentPromptSource?: CodeAgentPromptSource;
  instructionIncludePatterns?: string[];
  workspaceScopeKey?: string;
  workspaceScopeLabel?: string;
  projectFingerprint?: string;
  workspaceScopeWorkspaceId?: string;
  workspaceScopeLastWorkspaceId?: string;
  codeWorkspaces?: Array<{
    id: string;
    name: string;
    role: 'viewer' | 'commenter' | 'editor' | 'admin';
  }>;
  updatedAt?: number;
};

type PersistedRuntimeConfig = {
  profile?: 'uat' | 'prod';
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  codeAgentPromptDefault?: string;
  codeAgentPromptGlobal?: string;
  codeAgentPromptWorkspace?: string;
  codeAgentPromptEffective?: string;
  codeAgentPromptSource?: CodeAgentPromptSource;
  instructionIncludePatterns?: string[];
  workspaceScopeKey?: string;
  workspaceScopeLabel?: string;
  projectFingerprint?: string;
  workspaceScopeWorkspaceId?: string;
  workspaceScopeLastWorkspaceId?: string;
  codeWorkspaces?: Array<{
    id: string;
    name: string;
    role: 'viewer' | 'commenter' | 'editor' | 'admin';
  }>;
  updatedAt?: number;
};

declare global {
  interface Window {
    __TOPAI_VSCODE_RUNTIME__?: TopAiRuntimeConfig;
  }
}

const RUNTIME_CONFIG_STORAGE_KEY = 'topai.vscode.runtime.config';
const WORKSPACE_SCOPE_STORAGE_KEY = 'workspaceScopeId';
const buildEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;
const resolveDefault = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};
const DEFAULT_RUNTIME_CONFIG: Required<TopAiRuntimeConfig> = {
  profile: 'uat',
  apiBaseUrl: resolveDefault(buildEnv?.VITE_EXTENSION_API_BASE_URL, 'http://localhost:8787/api/v1'),
  appBaseUrl: resolveDefault(buildEnv?.VITE_EXTENSION_APP_BASE_URL, 'http://localhost:5173'),
  wsBaseUrl: '',
  sessionToken: '',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
  codeAgentPromptDefault: '',
  codeAgentPromptGlobal: '',
  codeAgentPromptWorkspace: '',
  codeAgentPromptEffective: '',
  codeAgentPromptSource: 'default',
  instructionIncludePatterns: [],
  workspaceScopeKey: '',
  workspaceScopeLabel: '',
  projectFingerprint: '',
  workspaceScopeWorkspaceId: '',
  workspaceScopeLastWorkspaceId: '',
  codeWorkspaces: [],
  updatedAt: Date.now(),
};

type RuntimeState = {
  config: Required<TopAiRuntimeConfig>;
  bridge: VsCodeBridge | null;
};

type RuntimeHttpRequestResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
};

type ExtensionMessage = {
  type?: unknown;
  payload?: unknown;
  toolCallId?: unknown;
  name?: unknown;
  args?: unknown;
};

type RuntimePortListener<T> = (message: T) => void;

type RuntimePortEvents<T> = {
  addListener: (listener: RuntimePortListener<T>) => void;
  removeListener: (listener: RuntimePortListener<T>) => void;
};

type RuntimePortLike = {
  postMessage: (message: unknown) => void;
  disconnect: () => void;
  onMessage: RuntimePortEvents<any>;
  onDisconnect: RuntimePortEvents<void>;
};

type CodeWorkspaceSummary = {
  id: string;
  name: string;
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
};

const isCodeWorkspaceSummary = (entry: unknown): entry is CodeWorkspaceSummary => {
  if (!entry || typeof entry !== 'object') return false;
  const row = entry as { id?: unknown; name?: unknown; role?: unknown };
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    (row.role === 'viewer' ||
      row.role === 'commenter' ||
      row.role === 'editor' ||
      row.role === 'admin')
  );
};

const normalizeCodeWorkspaces = (value: unknown): CodeWorkspaceSummary[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is CodeWorkspaceSummary => isCodeWorkspaceSummary(entry))
        .map((entry) => ({
          id: entry.id.trim(),
          name: entry.name.trim(),
          role: entry.role,
        }))
    : [];

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
  const codeAgentPromptDefault =
    raw?.codeAgentPromptDefault?.trim() ||
    DEFAULT_RUNTIME_CONFIG.codeAgentPromptDefault;
  const codeAgentPromptGlobal = raw?.codeAgentPromptGlobal ?? '';
  const codeAgentPromptWorkspace = raw?.codeAgentPromptWorkspace ?? '';
  const promptProfile = resolveCodeAgentPromptProfile({
    workspaceOverride: codeAgentPromptWorkspace,
    serverOverride: codeAgentPromptGlobal,
    defaultPrompt: codeAgentPromptDefault,
  });
  const codeAgentPromptEffective =
    typeof raw?.codeAgentPromptEffective === 'string' &&
    raw.codeAgentPromptEffective.trim().length > 0
      ? raw.codeAgentPromptEffective
      : promptProfile.effectivePrompt;
  const codeAgentPromptSource =
    raw?.codeAgentPromptSource === 'workspace' ||
    raw?.codeAgentPromptSource === 'server' ||
    raw?.codeAgentPromptSource === 'default'
      ? raw.codeAgentPromptSource
      : promptProfile.source;
  const instructionIncludePatterns = Array.isArray(raw?.instructionIncludePatterns)
    ? raw.instructionIncludePatterns
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : DEFAULT_RUNTIME_CONFIG.instructionIncludePatterns;
  const workspaceScopeKey = raw?.workspaceScopeKey?.trim() || '';
  const workspaceScopeLabel = raw?.workspaceScopeLabel?.trim() || '';
  const projectFingerprint = raw?.projectFingerprint?.trim() || '';
  const workspaceScopeWorkspaceId = raw?.workspaceScopeWorkspaceId?.trim() || '';
  const workspaceScopeLastWorkspaceId =
    raw?.workspaceScopeLastWorkspaceId?.trim() || '';
  const codeWorkspaces = normalizeCodeWorkspaces(raw?.codeWorkspaces);

  return {
    profile,
    apiBaseUrl,
    appBaseUrl,
    wsBaseUrl,
    sessionToken,
    codexSignInUrl,
    codeAgentPromptDefault,
    codeAgentPromptGlobal,
    codeAgentPromptWorkspace,
    codeAgentPromptEffective,
    codeAgentPromptSource,
    instructionIncludePatterns,
    workspaceScopeKey,
    workspaceScopeLabel,
    projectFingerprint,
    workspaceScopeWorkspaceId,
    workspaceScopeLastWorkspaceId,
    codeWorkspaces,
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
      codeAgentPromptDefault:
        typeof parsed.codeAgentPromptDefault === 'string'
          ? parsed.codeAgentPromptDefault
          : undefined,
      codeAgentPromptGlobal:
        typeof parsed.codeAgentPromptGlobal === 'string'
          ? parsed.codeAgentPromptGlobal
          : undefined,
      codeAgentPromptWorkspace:
        typeof parsed.codeAgentPromptWorkspace === 'string'
          ? parsed.codeAgentPromptWorkspace
          : undefined,
      codeAgentPromptEffective:
        typeof parsed.codeAgentPromptEffective === 'string'
          ? parsed.codeAgentPromptEffective
          : undefined,
      codeAgentPromptSource:
        parsed.codeAgentPromptSource === 'workspace' ||
        parsed.codeAgentPromptSource === 'server' ||
        parsed.codeAgentPromptSource === 'default'
          ? parsed.codeAgentPromptSource
          : undefined,
      instructionIncludePatterns: Array.isArray(parsed.instructionIncludePatterns)
        ? parsed.instructionIncludePatterns.filter(
            (entry): entry is string =>
              typeof entry === 'string' && entry.trim().length > 0,
          )
        : undefined,
      workspaceScopeKey:
        typeof parsed.workspaceScopeKey === 'string'
          ? parsed.workspaceScopeKey
          : undefined,
      workspaceScopeLabel:
        typeof parsed.workspaceScopeLabel === 'string'
          ? parsed.workspaceScopeLabel
          : undefined,
      projectFingerprint:
        typeof parsed.projectFingerprint === 'string'
          ? parsed.projectFingerprint
          : undefined,
      workspaceScopeWorkspaceId:
        typeof parsed.workspaceScopeWorkspaceId === 'string'
          ? parsed.workspaceScopeWorkspaceId
          : undefined,
      workspaceScopeLastWorkspaceId:
        typeof parsed.workspaceScopeLastWorkspaceId === 'string'
          ? parsed.workspaceScopeLastWorkspaceId
          : undefined,
      codeWorkspaces: Array.isArray(parsed.codeWorkspaces)
        ? normalizeCodeWorkspaces(parsed.codeWorkspaces)
        : undefined,
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
    codeAgentPromptDefault: config.codeAgentPromptDefault,
    codeAgentPromptGlobal: config.codeAgentPromptGlobal,
    codeAgentPromptWorkspace: config.codeAgentPromptWorkspace,
    codeAgentPromptEffective: config.codeAgentPromptEffective,
    codeAgentPromptSource: config.codeAgentPromptSource,
    instructionIncludePatterns: config.instructionIncludePatterns,
    workspaceScopeKey: config.workspaceScopeKey,
    workspaceScopeLabel: config.workspaceScopeLabel,
    projectFingerprint: config.projectFingerprint,
    workspaceScopeWorkspaceId: config.workspaceScopeWorkspaceId,
    workspaceScopeLastWorkspaceId: config.workspaceScopeLastWorkspaceId,
    codeWorkspaces: config.codeWorkspaces,
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
  if (config.workspaceScopeWorkspaceId.trim().length > 0) {
    localStorage.setItem(WORKSPACE_SCOPE_STORAGE_KEY, config.workspaceScopeWorkspaceId);
  } else {
    localStorage.removeItem(WORKSPACE_SCOPE_STORAGE_KEY);
  }
};

const installBridgeApiFetchProxy = (state: RuntimeState): void => {
  const bridge = state.bridge;
  if (!bridge) return;
  if (typeof window === 'undefined') return;

  const nativeFetch = window.fetch.bind(window);
  const apiBaseUrl = state.config.apiBaseUrl.replace(/\/$/, '');
  const apiBaseOrigin = (() => {
    try {
      return new URL(apiBaseUrl).origin;
    } catch {
      return '';
    }
  })();

  const isBridgeableBody = (value: unknown): value is string | undefined => {
    if (typeof value === 'undefined') return true;
    return typeof value === 'string';
  };

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const request = input instanceof Request ? input : null;
      const rawUrl = request ? request.url : String(input);
      const targetUrl = new URL(rawUrl, window.location.origin);
      if (!apiBaseOrigin || targetUrl.origin !== apiBaseOrigin) {
        return nativeFetch(input, init);
      }
      if (!targetUrl.toString().startsWith(apiBaseUrl)) {
        return nativeFetch(input, init);
      }

      const method = (
        init?.method ??
        request?.method ??
        'GET'
      ).toUpperCase();

      let bodyText: string | undefined;
      if (!isBridgeableBody(init?.body)) {
        return nativeFetch(input, init);
      }
      if (typeof init?.body === 'string') {
        bodyText = init.body;
      } else if (request && method !== 'GET' && method !== 'HEAD') {
        const contentType = request.headers.get('content-type') ?? '';
        if (
          contentType.includes('multipart/form-data') ||
          contentType.includes('application/octet-stream')
        ) {
          return nativeFetch(input, init);
        }
        bodyText = await request.clone().text();
      }

      const headers = new Headers(request?.headers ?? undefined);
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      }
      // Host runtime is the single source of truth for auth; avoid forwarding stale/duplicate auth headers.
      headers.delete('authorization');
      const headersObject: Record<string, string> = {};
      headers.forEach((value, key) => {
        headersObject[key] = value;
      });

      const response = await bridge.request<RuntimeHttpRequestResult>(
        'runtime.http.request',
        {
          url: targetUrl.toString(),
          method,
          headers: headersObject,
          bodyText,
        },
      );

      return new Response(response.bodyText ?? '', {
        status: Number.isFinite(response.status) ? response.status : 500,
        statusText: response.statusText || '',
        headers: new Headers(response.headers ?? {}),
      });
    } catch {
      return nativeFetch(input, init);
    }
  };
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
      credentials: config.sessionToken ? 'omit' : 'include',
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
    codeAgentPromptDefault:
      typeof raw.codeAgentPromptDefault === 'string'
        ? raw.codeAgentPromptDefault
        : current.codeAgentPromptDefault,
    codeAgentPromptGlobal:
      typeof raw.codeAgentPromptGlobal === 'string'
        ? raw.codeAgentPromptGlobal
        : current.codeAgentPromptGlobal,
    codeAgentPromptWorkspace:
      typeof raw.codeAgentPromptWorkspace === 'string'
        ? raw.codeAgentPromptWorkspace
        : current.codeAgentPromptWorkspace,
    instructionIncludePatterns: Array.isArray(raw.instructionIncludePatterns)
      ? raw.instructionIncludePatterns.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : current.instructionIncludePatterns,
    workspaceScopeKey:
      typeof raw.workspaceScopeKey === 'string'
        ? raw.workspaceScopeKey
        : current.workspaceScopeKey,
    workspaceScopeLabel:
      typeof raw.workspaceScopeLabel === 'string'
        ? raw.workspaceScopeLabel
        : current.workspaceScopeLabel,
    projectFingerprint:
      typeof raw.projectFingerprint === 'string'
        ? raw.projectFingerprint
        : current.projectFingerprint,
    workspaceScopeWorkspaceId:
      typeof raw.workspaceScopeWorkspaceId === 'string'
        ? raw.workspaceScopeWorkspaceId
        : current.workspaceScopeWorkspaceId,
    workspaceScopeLastWorkspaceId:
      typeof raw.workspaceScopeLastWorkspaceId === 'string'
        ? raw.workspaceScopeLastWorkspaceId
        : current.workspaceScopeLastWorkspaceId,
    codeWorkspaces: Array.isArray(raw.codeWorkspaces)
      ? normalizeCodeWorkspaces(raw.codeWorkspaces)
      : current.codeWorkspaces,
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
        connect?: (options: { name: string }) => RuntimePortLike;
      };
    };
  };
  const existing = ext.chrome ?? {};

  const resolveAuthStatus = async (): Promise<{
    connected: boolean;
    reason: string;
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      role: string;
    } | null;
  }> => {
    if (state.bridge) {
      try {
        const result = await state.bridge.request<{
          connected: boolean;
          reason: string;
          user?: {
            id: string;
            email: string | null;
            displayName: string | null;
            role: string;
          } | null;
        }>('runtime.auth.validate');
        return {
          connected: Boolean(result?.connected),
          reason: result?.reason || 'not_connected',
          user: result?.user ?? null,
        };
      } catch (error) {
        return {
          connected: false,
          reason: error instanceof Error ? error.message : String(error),
          user: null,
        };
      }
    }

    const session = await fetchSessionUser(state.config);
    if (!session.ok) {
      return {
        connected: false,
        reason:
          session.status === 401 || session.status === 403
            ? 'not_connected'
            : session.error,
        user: null,
      };
    }
    return {
      connected: true,
      reason: 'connected',
      user: session.user,
    };
  };

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
          codeAgentPromptDefault: state.config.codeAgentPromptDefault,
          codeAgentPromptGlobal: state.config.codeAgentPromptGlobal,
          codeAgentPromptWorkspace: state.config.codeAgentPromptWorkspace,
          codeAgentPromptEffective: state.config.codeAgentPromptEffective,
          codeAgentPromptSource: state.config.codeAgentPromptSource,
          instructionIncludePatterns: state.config.instructionIncludePatterns,
          workspaceScopeKey: state.config.workspaceScopeKey,
          workspaceScopeLabel: state.config.workspaceScopeLabel,
          projectFingerprint: state.config.projectFingerprint,
          workspaceScopeWorkspaceId: state.config.workspaceScopeWorkspaceId,
          workspaceScopeLastWorkspaceId:
            state.config.workspaceScopeLastWorkspaceId,
          codeWorkspaces: state.config.codeWorkspaces,
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
            codeAgentPromptDefault: nextConfig.codeAgentPromptDefault,
            codeAgentPromptGlobal: nextConfig.codeAgentPromptGlobal,
            codeAgentPromptWorkspace: nextConfig.codeAgentPromptWorkspace,
            instructionIncludePatterns: nextConfig.instructionIncludePatterns,
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
          codeAgentPromptDefault: state.config.codeAgentPromptDefault,
          codeAgentPromptGlobal: state.config.codeAgentPromptGlobal,
          codeAgentPromptWorkspace: state.config.codeAgentPromptWorkspace,
          codeAgentPromptEffective: state.config.codeAgentPromptEffective,
          codeAgentPromptSource: state.config.codeAgentPromptSource,
          instructionIncludePatterns: state.config.instructionIncludePatterns,
          workspaceScopeKey: state.config.workspaceScopeKey,
          workspaceScopeLabel: state.config.workspaceScopeLabel,
          projectFingerprint: state.config.projectFingerprint,
          workspaceScopeWorkspaceId: state.config.workspaceScopeWorkspaceId,
          workspaceScopeLastWorkspaceId:
            state.config.workspaceScopeLastWorkspaceId,
          codeWorkspaces: state.config.codeWorkspaces,
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

    if (type === 'extension_workspace_mapping_refresh') {
      if (!state.bridge) {
        return { ok: false, error: 'Workspace mapping runtime is unavailable.' };
      }
      try {
        const synced = await state.bridge.request<Partial<TopAiRuntimeConfig>>(
          'runtime.workspace.mapping.get',
          {
            projectFingerprint: state.config.projectFingerprint,
          },
        );
        state.config = normalizeRuntimeConfig({
          ...state.config,
          ...(synced ?? {}),
          updatedAt: Date.now(),
        });
        persistRuntimeConfig(state.config);
        applyApiRuntimeConfig(state.config);
        return { ok: true, config: state.config };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (type === 'extension_workspace_mapping_set') {
      if (!state.bridge) {
        return { ok: false, error: 'Workspace mapping runtime is unavailable.' };
      }
      const requestPayload =
        message.payload && typeof message.payload === 'object'
          ? (message.payload as { workspaceId?: unknown })
          : {};
      const workspaceId =
        typeof requestPayload.workspaceId === 'string'
          ? requestPayload.workspaceId.trim()
          : '';
      if (!workspaceId) {
        return { ok: false, error: 'workspaceId is required.' };
      }
      try {
        const synced = await state.bridge.request<Partial<TopAiRuntimeConfig>>(
          'runtime.workspace.mapping.set',
          {
            projectFingerprint: state.config.projectFingerprint,
            workspaceId,
          },
        );
        state.config = normalizeRuntimeConfig({
          ...state.config,
          ...(synced ?? {}),
          updatedAt: Date.now(),
        });
        persistRuntimeConfig(state.config);
        applyApiRuntimeConfig(state.config);
        return { ok: true, config: state.config };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (type === 'extension_workspace_mapping_create') {
      if (!state.bridge) {
        return { ok: false, error: 'Workspace mapping runtime is unavailable.' };
      }
      const requestPayload =
        message.payload && typeof message.payload === 'object'
          ? (message.payload as { name?: unknown })
          : {};
      const name = typeof requestPayload.name === 'string' ? requestPayload.name.trim() : '';
      try {
        const synced = await state.bridge.request<Partial<TopAiRuntimeConfig>>(
          'runtime.workspace.mapping.create',
          {
            projectFingerprint: state.config.projectFingerprint,
            ...(name ? { name } : {}),
          },
        );
        state.config = normalizeRuntimeConfig({
          ...state.config,
          ...(synced ?? {}),
          updatedAt: Date.now(),
        });
        persistRuntimeConfig(state.config);
        applyApiRuntimeConfig(state.config);
        return { ok: true, config: state.config };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (type === 'extension_workspace_mapping_not_now') {
      if (!state.bridge) {
        return { ok: false, error: 'Workspace mapping runtime is unavailable.' };
      }
      try {
        const synced = await state.bridge.request<Partial<TopAiRuntimeConfig>>(
          'runtime.workspace.mapping.not_now',
          {
            projectFingerprint: state.config.projectFingerprint,
          },
        );
        state.config = normalizeRuntimeConfig({
          ...state.config,
          ...(synced ?? {}),
          updatedAt: Date.now(),
        });
        persistRuntimeConfig(state.config);
        applyApiRuntimeConfig(state.config);
        return { ok: true, config: state.config };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (type === 'extension_auth_status') {
      const status = await resolveAuthStatus();
      if (!status.connected || !status.user) {
        return {
          ok: true,
          status: {
            connected: false,
            reason: status.reason || 'not_connected',
            user: null,
          },
        };
      }
      return {
        ok: true,
        status: {
          connected: true,
          reason: 'connected',
          user: status.user,
        },
      };
    }

    if (type === 'extension_auth_connect') {
      const status = await resolveAuthStatus();
      if (!status.connected || !status.user) {
        const code =
          !state.config.sessionToken.trim()
            ? 'TOKEN_REQUIRED'
            : 'CONNECT_FAILED';
        return {
          ok: false,
          code,
          error:
            code === 'TOKEN_REQUIRED'
              ? 'Extension token is required. Paste it in Extension settings and save.'
              : status.reason || 'Unable to validate extension token',
          loginUrl,
        };
      }
      return {
        ok: true,
        user: status.user,
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

    if (type === 'tool_execute') {
      if (!state.bridge) {
        return {
          ok: false,
          error: 'Local tool runtime is unavailable in this context.',
        };
      }
      const argsPayload =
        message.args && typeof message.args === 'object'
          ? (message.args as Record<string, unknown>)
          : message.payload && typeof message.payload === 'object'
            ? (message.payload as Record<string, unknown>)
            : {};
      return state.bridge.request<{
        ok: boolean;
        result?: unknown;
        error?: string;
        permissionRequest?: unknown;
      }>('runtime.local_tools.execute', {
        toolCallId:
          typeof message.toolCallId === 'string' ? message.toolCallId : '',
        name: typeof message.name === 'string' ? message.name : '',
        args: argsPayload,
      });
    }

    if (type === 'tool_permission_decide') {
      if (!state.bridge) {
        return {
          ok: false,
          error: 'Local tool runtime is unavailable in this context.',
        };
      }
      return state.bridge.request<{ ok: boolean; error?: string }>(
        'runtime.local_tools.permission_decide',
        message.payload ?? {},
      );
    }

    if (type === 'extension_tool_permissions_list') {
      if (!state.bridge) {
        return {
          ok: true,
          items: [],
        };
      }
      return state.bridge.request<{
        ok: boolean;
        items?: unknown[];
        error?: string;
      }>('runtime.local_tools.permissions.list');
    }

    if (type === 'extension_tool_permissions_upsert') {
      if (!state.bridge) {
        return {
          ok: false,
          error: 'Local tool runtime is unavailable in this context.',
        };
      }
      return state.bridge.request<{
        ok: boolean;
        item?: unknown;
        error?: string;
      }>('runtime.local_tools.permissions.upsert', message.payload ?? {});
    }

    if (type === 'extension_tool_permissions_delete') {
      if (!state.bridge) {
        return {
          ok: false,
          error: 'Local tool runtime is unavailable in this context.',
        };
      }
      return state.bridge.request<{ ok: boolean; error?: string }>(
        'runtime.local_tools.permissions.delete',
        message.payload ?? {},
      );
    }

    return {
      ok: false,
      error: `Unsupported runtime message: ${type}`,
    };
  };

  const createRuntimePort = (): RuntimePortLike => {
    const portId = `vscode_port_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const messageListeners = new Set<RuntimePortListener<any>>();
    const disconnectListeners = new Set<RuntimePortListener<void>>();
    const stopStreamEventForward = state.bridge
      ? state.bridge.onEvent('runtime.stream.proxy.event', (payload) => {
          const record =
            payload && typeof payload === 'object'
              ? (payload as { portId?: unknown; message?: unknown })
              : {};
          if (record.portId !== portId) return;
          for (const listener of messageListeners) {
            listener(record.message);
          }
          const maybeMessage =
            record.message && typeof record.message === 'object'
              ? (record.message as { type?: unknown })
              : {};
          if (maybeMessage.type === 'sse_closed') {
            disconnect();
          }
        })
      : null;
    let disconnected = false;

    const disconnect = () => {
      if (disconnected) return;
      disconnected = true;
      stopStreamEventForward?.();
      if (state.bridge) {
        void state.bridge
          .request('runtime.stream.proxy.stop', { portId })
          .catch(() => undefined);
      }
      for (const listener of disconnectListeners) {
        listener();
      }
    };

    return {
      postMessage: (message: unknown) => {
        if (disconnected) return;
        const event =
          message && typeof message === 'object'
            ? (message as { type?: unknown; payload?: unknown })
            : {};
        const type = typeof event.type === 'string' ? event.type : '';
        if (type === 'stream_proxy_start') {
          if (!state.bridge) {
            for (const listener of messageListeners) {
              listener({
                type: 'sse_error',
                error: 'Bridge unavailable for runtime stream proxy.',
              });
            }
            return;
          }
          const payload =
            event.payload && typeof event.payload === 'object'
              ? (event.payload as Record<string, unknown>)
              : {};
          void state.bridge
            .request('runtime.stream.proxy.start', {
              portId,
              baseUrl:
                typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
              workspaceId:
                typeof payload.workspaceId === 'string'
                  ? payload.workspaceId
                  : null,
              streamIds: Array.isArray(payload.streamIds)
                ? payload.streamIds
                : [],
            })
            .catch((error) => {
              const reason =
                error instanceof Error ? error.message : String(error);
              for (const listener of messageListeners) {
                listener({
                  type: 'sse_error',
                  error: reason,
                });
              }
            });
          return;
        }
        if (type === 'stream_proxy_stop') {
          disconnect();
        }
      },
      disconnect,
      onMessage: {
        addListener(listener: RuntimePortListener<any>) {
          messageListeners.add(listener);
        },
        removeListener(listener: RuntimePortListener<any>) {
          messageListeners.delete(listener);
        },
      },
      onDisconnect: {
        addListener(listener: RuntimePortListener<void>) {
          disconnectListeners.add(listener);
        },
        removeListener(listener: RuntimePortListener<void>) {
          disconnectListeners.delete(listener);
        },
      },
    };
  };

  ext.chrome = {
    ...existing,
    runtime: {
      ...(existing.runtime ?? {}),
      id: 'topai.vscode.runtime',
      sendMessage,
      connect: () => createRuntimePort(),
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
    ...persisted,
    ...hostConfig,
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
  installBridgeApiFetchProxy(runtimeState);
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
