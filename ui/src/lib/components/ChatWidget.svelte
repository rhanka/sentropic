<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { ContextProvider } from '$lib/core/context-provider';
  import { _ } from 'svelte-i18n';
  import { queueStore, loadJobs, updateJob, addJob } from '$lib/stores/queue';
  import { apiPost } from '$lib/utils/api';
  import { addToast } from '$lib/stores/toast';
  import {
    isAuthenticated,
    session,
    setUser,
    clearUser,
    type User,
  } from '$lib/stores/session';
  import { streamHub } from '$lib/stores/streamHub';
  import { currentFolderId } from '$lib/stores/folders';
  import {
    MessageCircle,
    Loader2,
    Clock,
    X,
    Plus,
    Trash2,
    Maximize2,
    Minimize2,
    Menu,
    List,
    Settings,
  } from '@lucide/svelte';
  import { chatWidgetLayout } from '$lib/stores/chatWidgetLayout';
  import type { ChatWidgetHandoffState } from '$lib/core/chatwidget-handoff';
  import {
    deleteLocalToolPermissionPolicy,
    listLocalToolPermissionPolicies,
    upsertLocalToolPermissionPolicy,
    type LocalToolPermissionPolicyEntry,
  } from '$lib/stores/localTools';

  import QueueMonitor from '$lib/components/QueueMonitor.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';
  import MenuPopover from '$lib/components/MenuPopover.svelte';

  type Tab = 'chat' | 'queue' | 'comments';
  let activeTab: Tab = 'chat';
  let isVisible = false;
  let hasOpenedOnce = false;
  let chatDraft = '';

  // Header Chat (sessions) piloté par ChatPanel via bindings
  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
  };
  let chatPanelRef: any = null;
  let chatSessions: ChatSession[] = [];
  let chatSessionId: string | null = null;
  let chatLoadingSessions = false;
  let commentContext: {
    type: 'organization' | 'folder' | 'usecase' | 'executive_summary';
    id?: string;
  } | null = null;
  let commentContextOverride: {
    type: 'organization' | 'folder' | 'usecase' | 'executive_summary';
    id?: string;
  } | null = null;

  // Core abstraction: allows Chrome extension to inject its own context provider.
  // Defaults to SvelteKit's page store for backward compatibility.
  export let contextProvider: ContextProvider;
  export let hostMode: 'overlay' | 'sidepanel' = 'overlay';
  export let initialState: ChatWidgetHandoffState | null = null;
  $: contextStore = contextProvider.context;
  $: isBrowser = contextProvider.isBrowser;

  let commentSectionKey: string | null = null;
  let commentSectionLabel: string | null = null;
  let commentThreadId: string | null = null;
  let commentLoading = false;
  let commentThreads: Array<{
    id: string;
    sectionKey: string | null;
    count: number;
    lastAt: string;
    preview: string;
    authorLabel: string;
    status: 'open' | 'closed';
    assignedTo: string | null;
    rootId: string;
    createdBy: string;
  }> = [];
  let pendingCommentAutoSelect = false;
  let pendingCommentAutoSelectReady = false;
  let lastCommentContextKey = '';
  let lastCommentRouteKey = '';
  let showSessionMenu = false;
  let sessionMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleCommentSectionClick: ((_: MouseEvent) => void) | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleOpenComments: ((_: CustomEvent) => void) | null = null;

  type DisplayMode = 'floating' | 'docked';
  type ExtensionProfile = 'uat' | 'prod';
  type ExtensionRuntimeConfig = {
    profile: ExtensionProfile;
    apiBaseUrl: string;
    appBaseUrl: string;
    wsBaseUrl: string;
    updatedAt?: number;
  };
  type ExtensionConfigStatusKind = 'info' | 'ok' | 'error';
  type ExtensionAuthStatusKind = 'info' | 'ok' | 'error';
  const DISPLAY_MODE_STORAGE_KEY = 'chatWidgetDisplayMode';
  const HANDOFF_EVENT = 'topai:chatwidget-handoff-state';
  const OPEN_SIDEPANEL_EVENT = 'topai:open-sidepanel';
  const OPEN_OVERLAY_EVENT = 'topai:open-overlay';
  const OPEN_CHAT_EVENT = 'topai:open-chat';
  const EXTENSION_CONFIG_UPDATED_EVENT = 'topai:extension-config-updated';
  const DEFAULT_EXTENSION_CONFIGS: Record<
    ExtensionProfile,
    Omit<ExtensionRuntimeConfig, 'profile' | 'updatedAt'>
  > = {
    uat: {
      apiBaseUrl: 'http://localhost:8787/api/v1',
      appBaseUrl: 'http://localhost:5173',
      wsBaseUrl: '',
    },
    prod: {
      apiBaseUrl: 'https://top-ai-ideas-api.sent-tech.ca/api/v1',
      appBaseUrl: 'https://top-ai-ideas.sent-tech.ca',
      wsBaseUrl: '',
    },
  };
  let displayMode: DisplayMode = 'floating';
  let isSidePanelHost = false;
  let isExtensionOverlayHost = false;
  let showExtensionConfigMenu = false;
  let extensionConfigButtonRef: HTMLButtonElement | null = null;
  let extensionConfigLoading = false;
  let extensionConfigSaving = false;
  let extensionConfigTesting = false;
  let extensionConfigLoaded = false;
  let extensionAuthRequired = false;
  let extensionConfigStatus = '';
  let extensionConfigStatusKind: ExtensionConfigStatusKind = 'info';
  let extensionAuthStatus = '';
  let extensionAuthStatusKind: ExtensionAuthStatusKind = 'info';
  let extensionAuthStatusLoaded = false;
  let extensionAuthLoading = false;
  let extensionAuthConnecting = false;
  let extensionAuthLoggingOut = false;
  let extensionAuthConnected = false;
  let extensionAuthUser: User | null = null;
  let extensionAuthLoginUrl: string | null = null;
  let extensionConfigMenuWasOpen = false;
  let extensionSettingsTab: 'endpoint' | 'permissions' = 'endpoint';
  let extensionConfigMenuMaxHeightPx = 360;
  let extensionToolPermissionsLoading = false;
  let extensionToolPermissionsError = '';
  let extensionToolPermissions: LocalToolPermissionPolicyEntry[] = [];
  const EXTENSION_PERMISSION_TOOL_OPTIONS = [
    'tab_read:*',
    'tab_read:info',
    'tab_read:dom',
    'tab_read:screenshot',
    'tab_read:elements',
    'tab_action:*',
    'tab_action:click',
    'tab_action:input',
    'tab_action:scroll',
    'tab_action:wait',
  ];
  let extensionPermissionDraftToolName = 'tab_action:*';
  let extensionPermissionDraftOrigin = '';
  let extensionPermissionDraftPolicy: 'allow' | 'deny' = 'allow';
  let extensionConfigForm: ExtensionRuntimeConfig = {
    profile: 'uat',
    ...DEFAULT_EXTENSION_CONFIGS.uat,
  };
  let isPluginMode = false;
  const isExtensionRuntime = () => {
    const ext = globalThis as typeof globalThis & {
      chrome?: { runtime?: { id?: string } };
    };
    return Boolean(ext.chrome?.runtime?.id);
  };
  $: isSidePanelHost = hostMode === 'sidepanel';
  $: isExtensionOverlayHost = !isSidePanelHost && isExtensionRuntime();
  $: isPluginMode = isExtensionRuntime();
  $: if (isPluginMode && activeTab === 'comments') activeTab = 'chat';
  $: if (isBrowser) {
    const saved = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (saved === 'docked' && !isExtensionOverlayHost) displayMode = 'docked';
  }
  let dockWidthCss = '0px';

  let bubbleButtonEl: HTMLButtonElement | null = null;
  let dialogEl: HTMLDivElement | null = null;
  let lastActiveElement: HTMLElement | null = null;
  let resizeHandler: (() => void) | null = null;
  let closeButtonEl: HTMLButtonElement | null = null;
  let isMobileViewport = false;
  let effectiveMode: DisplayMode = 'floating';
  let isDocked = false;
  // eslint-disable-next-line no-unused-vars
  let mobileMqlChangeHandler: ((ev: MediaQueryListEvent) => void) | null = null;

  // Mobile UX: prevent "scroll bleed" when the bottom-sheet is open
  let mobileMql: MediaQueryList | null = null;
  let isBrowserReady = false;
  let bodyScrollLocked = false;

  const setBodyScrollLocked = (locked: boolean) => {
    if (typeof document === 'undefined') return;
    if (locked === bodyScrollLocked) return;
    bodyScrollLocked = locked;
    document.body.style.overflow = locked ? 'hidden' : '';
    // iOS: avoid elastic scrolling on background
    document.body.style.touchAction = locked ? 'none' : '';
  };

  const syncScrollLock = () => {
    if (!isBrowserReady) return;
    const isMobile = isMobileViewport;
    setBodyScrollLocked(Boolean(isVisible && isMobile));
  };

  $: effectiveMode = isSidePanelHost
    ? 'docked'
    : isExtensionOverlayHost
      ? 'floating'
      : isMobileViewport
        ? 'docked'
        : displayMode;
  $: isDocked = effectiveMode === 'docked';

  const updateExtensionConfigMenuMaxHeight = () => {
    if (typeof window === 'undefined') return;
    const triggerRect = extensionConfigButtonRef?.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 0;
    const menuOffsetPx = 8; // matches MenuPopover mt-2
    const viewportMarginPx = 16;
    const fallbackPx = 360;

    if (!triggerRect || viewportHeight <= 0) {
      extensionConfigMenuMaxHeightPx = fallbackPx;
      return;
    }

    const viewportAvailablePx = Math.max(
      0,
      Math.floor(viewportHeight - triggerRect.bottom - menuOffsetPx - viewportMarginPx),
    );

    if (!isDocked && dialogEl) {
      const dialogRect = dialogEl.getBoundingClientRect();
      // Floating mode: exact fit to the widget bottom.
      const exactWidgetAvailablePx = Math.max(
        0,
        Math.floor(dialogRect.bottom - triggerRect.bottom - menuOffsetPx),
      );
      extensionConfigMenuMaxHeightPx = Math.min(
        viewportAvailablePx || exactWidgetAvailablePx,
        exactWidgetAvailablePx,
      );
      return;
    }

    extensionConfigMenuMaxHeightPx = viewportAvailablePx;
  };

  $: if (showExtensionConfigMenu) {
    void tick().then(() => {
      updateExtensionConfigMenuMaxHeight();
    });
  }

  const computeDockWidthCss = (): string => {
    if (!isBrowser) return '0px';
    const w = window.innerWidth;
    const minWidgetPx = 28 * 16; // 28rem ~= widget width (matches floating width)
    if (w < 640) return '100vw'; // mobile: full screen dock
    if (w < 1024) {
      // Tablet/intermediate: 50%, but if that would be smaller than the widget width, go full screen.
      return w * 0.5 < minWidgetPx ? '100vw' : '50vw';
    }
    // Desktop: prefer ~33%, but if that would be smaller than the widget width, fallback to 50%.
    if (w * 0.33 >= minWidgetPx) return '33vw';
    return w * 0.5 < minWidgetPx ? '100vw' : '50vw';
  };

  const publishLayout = () => {
    // Important: compute from current state, do not rely on reactive $: order.
    // Otherwise switching modes can publish the previous value and invert the padding logic.
    const modeNow: DisplayMode = isSidePanelHost
      ? 'docked'
      : isExtensionOverlayHost
        ? 'floating'
        : isMobileViewport
          ? 'docked'
          : displayMode;
    chatWidgetLayout.set({
      mode: modeNow,
      isOpen: isVisible && modeNow === 'docked',
      dockWidthCss,
    });
  };

  const setDisplayMode = (next: DisplayMode) => {
    displayMode = next;
    if (isBrowser) localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, next);
    publishLayout();
  };

  const buildHandoffState = (
    source: 'content' | 'sidepanel',
  ): ChatWidgetHandoffState => ({
    activeTab,
    chatSessionId,
    draft: chatDraft,
    commentThreadId,
    commentSectionKey,
    displayMode: isSidePanelHost ? 'docked' : displayMode,
    isOpen: isVisible,
    updatedAt: Date.now(),
    source,
  });

  const applyInitialState = (state: ChatWidgetHandoffState | null) => {
    if (!state) return;
    const canUseComments = !isPluginMode;
    if (state.activeTab === 'chat' || state.activeTab === 'queue') {
      activeTab = state.activeTab;
    } else if (state.activeTab === 'comments' && canUseComments) {
      activeTab = state.activeTab;
    }
    chatSessionId = state.chatSessionId ?? null;
    commentThreadId = state.commentThreadId ?? null;
    commentSectionKey = state.commentSectionKey ?? null;
    chatDraft = state.draft ?? '';
  };

  let lastHandoffStateFingerprint = '';
  const publishHandoffStateIfChanged = () => {
    if (!isBrowser || !isBrowserReady) return;
    const source = isSidePanelHost ? 'sidepanel' : 'content';
    const payload = buildHandoffState(source);
    const fingerprint = JSON.stringify({
      activeTab: payload.activeTab,
      chatSessionId: payload.chatSessionId,
      draft: payload.draft,
      commentThreadId: payload.commentThreadId,
      commentSectionKey: payload.commentSectionKey,
      displayMode: payload.displayMode,
      isOpen: payload.isOpen,
      source: payload.source,
    });
    if (fingerprint === lastHandoffStateFingerprint) return;
    lastHandoffStateFingerprint = fingerprint;
    window.dispatchEvent(
      new CustomEvent<ChatWidgetHandoffState>(HANDOFF_EVENT, {
        detail: payload,
      }),
    );
  };

  const requestOpenSidePanel = async (): Promise<boolean> => {
    if (!isBrowser || !isExtensionOverlayHost) return false;
    const runtime = (globalThis as typeof globalThis & {
      chrome?: { runtime?: any };
    }).chrome?.runtime;

    if (runtime?.sendMessage) {
      try {
        const response = await runtime.sendMessage({
          type: 'open_side_panel',
        });
        if (response?.ok) {
          publishHandoffStateIfChanged();
          return true;
        }
        console.error(
          'Failed to request side panel opening:',
          response?.error ?? 'unknown reason',
        );
        return false;
      } catch (error) {
        console.error('Failed to request side panel opening.', error);
        return false;
      }
    }

    // Legacy fallback (should not happen in normal extension runtime).
    publishHandoffStateIfChanged();
    window.dispatchEvent(new CustomEvent(OPEN_SIDEPANEL_EVENT));
    return false;
  };

  type RuntimeWithMessaging = {
    id?: string;
    sendMessage?: Function;
  };

  const getExtensionRuntime = (): RuntimeWithMessaging | undefined => {
    const ext = globalThis as typeof globalThis & {
      chrome?: { runtime?: RuntimeWithMessaging };
    };
    return ext.chrome?.runtime;
  };

  const isExtensionConfigAvailable = () => {
    const runtime = getExtensionRuntime();
    return Boolean(runtime?.id && runtime?.sendMessage);
  };

  const setExtensionConfigStatus = (
    message: string,
    kind: ExtensionConfigStatusKind = 'info',
  ) => {
    extensionConfigStatus = message;
    extensionConfigStatusKind = kind;
  };

  const setExtensionAuthStatus = (
    message: string,
    kind: ExtensionAuthStatusKind = 'info',
  ) => {
    extensionAuthStatus = message;
    extensionAuthStatusKind = kind;
  };

  const openExtensionSettingsMenu = (event?: Event) => {
    event?.stopPropagation();
    extensionSettingsTab = 'endpoint';
    showExtensionConfigMenu = true;
  };

  const toSessionUser = (payload: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: string;
  }): User => ({
    id: payload.id,
    email: payload.email,
    displayName: payload.displayName,
    role: payload.role as User['role'],
  });

  const normalizeExtensionConfig = (
    raw?: Partial<ExtensionRuntimeConfig> | null,
  ): ExtensionRuntimeConfig => {
    const profile: ExtensionProfile = raw?.profile === 'prod' ? 'prod' : 'uat';
    const defaults = DEFAULT_EXTENSION_CONFIGS[profile];
    const apiBaseUrl = raw?.apiBaseUrl?.trim() || defaults.apiBaseUrl;
    const appBaseUrl = raw?.appBaseUrl?.trim() || defaults.appBaseUrl;
    const wsBaseUrl = raw?.wsBaseUrl?.trim() || '';
    return {
      profile,
      apiBaseUrl,
      appBaseUrl,
      wsBaseUrl,
      updatedAt:
        typeof raw?.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    };
  };

  const loadExtensionConfig = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionConfigLoading) return;
    extensionConfigLoading = true;
    setExtensionConfigStatus($_('chat.extension.status.loadingConfig'), 'info');
    try {
      const runtime = getExtensionRuntime();
      const response = (await runtime?.sendMessage?.({
        type: 'extension_config_get',
      })) as
        | {
            ok?: boolean;
            config?: Partial<ExtensionRuntimeConfig>;
            error?: string;
          }
        | undefined;
      if (!response?.ok || !response?.config) {
        const reason =
          response?.error ?? $_('chat.extension.status.loadConfigFailed');
        setExtensionConfigStatus(reason, 'error');
        return;
      }
      extensionConfigForm = normalizeExtensionConfig(response.config);
      extensionConfigLoaded = true;
      setExtensionConfigStatus($_('chat.extension.status.configLoaded'), 'info');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionConfigStatus(
        $_('chat.extension.status.loadFailed', { values: { reason } }),
        'error',
      );
    } finally {
      extensionConfigLoading = false;
    }
  };

  const saveExtensionConfig = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionConfigSaving) return;
    extensionConfigSaving = true;
    setExtensionConfigStatus($_('chat.extension.status.savingConfig'), 'info');
    try {
      const runtime = getExtensionRuntime();
      const response = (await runtime?.sendMessage?.({
        type: 'extension_config_set',
        payload: {
          profile: extensionConfigForm.profile,
          apiBaseUrl: extensionConfigForm.apiBaseUrl,
          appBaseUrl: extensionConfigForm.appBaseUrl,
          wsBaseUrl: extensionConfigForm.wsBaseUrl,
        },
      })) as
        | {
            ok?: boolean;
            config?: Partial<ExtensionRuntimeConfig>;
            error?: string;
          }
        | undefined;
      if (!response?.ok || !response?.config) {
        const reason =
          response?.error ?? $_('chat.extension.status.saveConfigFailed');
        setExtensionConfigStatus(reason, 'error');
        return;
      }
      extensionConfigForm = normalizeExtensionConfig(response.config);
      extensionConfigLoaded = true;
      extensionAuthStatusLoaded = false;
      extensionAuthConnected = false;
      extensionAuthUser = null;
      extensionAuthLoginUrl = null;
      window.dispatchEvent(
        new CustomEvent<ExtensionRuntimeConfig>(EXTENSION_CONFIG_UPDATED_EVENT, {
          detail: extensionConfigForm,
        }),
      );
      setExtensionConfigStatus($_('chat.extension.status.configSaved'), 'ok');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionConfigStatus(
        $_('chat.extension.status.saveFailed', { values: { reason } }),
        'error',
      );
    } finally {
      extensionConfigSaving = false;
    }
  };

  const loadExtensionAuthStatus = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionAuthLoading) return;
    extensionAuthLoading = true;
    setExtensionAuthStatus($_('chat.extension.status.checkingSession'), 'info');
    try {
      const runtime = getExtensionRuntime();
      const response = (await runtime?.sendMessage?.({
        type: 'extension_auth_status',
      })) as
        | {
            ok?: boolean;
            status?: {
              connected?: boolean;
              reason?: string;
              user?: {
                id: string;
                email: string | null;
                displayName: string | null;
                role: string;
              };
            };
            error?: string;
          }
        | undefined;
      if (!response?.ok || !response.status) {
        const reason =
          response?.error ?? $_('chat.extension.status.readAuthFailed');
        setExtensionAuthStatus(reason, 'error');
        extensionAuthConnected = false;
        extensionAuthUser = null;
        extensionAuthLoginUrl = null;
        clearUser();
        extensionAuthStatusLoaded = true;
        return;
      }

      const status = response.status;
      if (!status.connected || !status.user) {
        extensionAuthConnected = false;
        extensionAuthUser = null;
        extensionAuthLoginUrl = null;
        clearUser();
        setExtensionAuthStatus(
          status.reason || $_('chat.extension.auth.notConnected'),
          'info',
        );
        extensionAuthStatusLoaded = true;
        return;
      }

      const user = toSessionUser(status.user);
      extensionAuthConnected = true;
      extensionAuthUser = user;
      extensionAuthLoginUrl = null;
      setUser(user);
      setExtensionAuthStatus($_('chat.extension.status.connected'), 'ok');
      extensionAuthStatusLoaded = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionAuthStatus(
        $_('chat.extension.status.statusCheckFailed', { values: { reason } }),
        'error',
      );
      extensionAuthConnected = false;
      extensionAuthUser = null;
      extensionAuthLoginUrl = null;
      clearUser();
      extensionAuthStatusLoaded = true;
    } finally {
      extensionAuthLoading = false;
    }
  };

  const connectExtensionAuthAction = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionAuthConnecting) return;
    extensionAuthConnecting = true;
    extensionAuthLoginUrl = null;
    setExtensionAuthStatus($_('chat.extension.status.connecting'), 'info');
    try {
      const runtime = getExtensionRuntime();
      const response = (await runtime?.sendMessage?.({
        type: 'extension_auth_connect',
      })) as
        | {
            ok?: boolean;
            user?: {
              id: string;
              email: string | null;
              displayName: string | null;
              role: string;
            };
            error?: string;
            code?: 'APP_SESSION_REQUIRED' | 'CONFIG_INVALID' | 'CONNECT_FAILED';
            loginUrl?: string;
          }
        | undefined;
      if (!response?.ok || !response.user) {
        const reason =
          response?.error ?? $_('chat.extension.status.connectFailed');
        extensionAuthConnected = false;
        extensionAuthUser = null;
        extensionAuthLoginUrl = response?.loginUrl ?? null;
        clearUser();
        setExtensionAuthStatus(reason, 'error');
        extensionAuthStatusLoaded = true;
        return;
      }

      const user = toSessionUser(response.user);
      extensionAuthConnected = true;
      extensionAuthUser = user;
      extensionAuthLoginUrl = null;
      setUser(user);
      setExtensionAuthStatus($_('chat.extension.status.connectedSuccess'), 'ok');
      extensionAuthStatusLoaded = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      extensionAuthConnected = false;
      extensionAuthUser = null;
      extensionAuthLoginUrl = null;
      clearUser();
      setExtensionAuthStatus(
        $_('chat.extension.status.connectionFailed', { values: { reason } }),
        'error',
      );
      extensionAuthStatusLoaded = true;
    } finally {
      extensionAuthConnecting = false;
    }
  };

  const logoutExtensionAuthAction = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionAuthLoggingOut) return;
    extensionAuthLoggingOut = true;
    setExtensionAuthStatus($_('chat.extension.status.loggingOut'), 'info');
    try {
      const runtime = getExtensionRuntime();
      await runtime?.sendMessage?.({
        type: 'extension_auth_logout',
      });
      extensionAuthConnected = false;
      extensionAuthUser = null;
      extensionAuthLoginUrl = null;
      clearUser();
      setExtensionAuthStatus($_('chat.extension.status.loggedOut'), 'ok');
      extensionAuthStatusLoaded = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionAuthStatus(
        $_('chat.extension.status.logoutFailed', { values: { reason } }),
        'error',
      );
    } finally {
      extensionAuthLoggingOut = false;
    }
  };

  const openExtensionLoginPage = async () => {
    if (!isExtensionConfigAvailable()) return;
    try {
      const runtime = getExtensionRuntime();
      await runtime?.sendMessage?.({
        type: 'extension_auth_open_login',
      });
      setExtensionAuthStatus(
        $_('chat.extension.status.loginOpened'),
        'info',
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionAuthStatus(
        $_('chat.extension.status.openLoginFailed', { values: { reason } }),
        'error',
      );
    }
  };

  const testExtensionConfig = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionConfigTesting) return;
    extensionConfigTesting = true;
    setExtensionConfigStatus($_('chat.extension.status.testingApi'), 'info');
    try {
      const runtime = getExtensionRuntime();
      const response = (await runtime?.sendMessage?.({
        type: 'extension_config_test',
        payload: {
          apiBaseUrl: extensionConfigForm.apiBaseUrl,
        },
      })) as
        | {
            ok?: boolean;
            status?: number;
            error?: string;
          }
        | undefined;
      if (response?.ok && response.status) {
        setExtensionConfigStatus(
          $_('chat.extension.status.apiReachable', {
            values: { status: response.status },
          }),
          'ok',
        );
        return;
      }
      const reason =
        response?.error ?? $_('chat.extension.status.apiTestFailed');
      setExtensionConfigStatus(reason, 'error');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setExtensionConfigStatus(
        $_('chat.extension.status.apiTestFailedWithReason', {
          values: { reason },
        }),
        'error',
      );
    } finally {
      extensionConfigTesting = false;
    }
  };

  const loadExtensionToolPermissions = async () => {
    if (!isExtensionConfigAvailable()) return;
    if (extensionToolPermissionsLoading) return;
    extensionToolPermissionsLoading = true;
    extensionToolPermissionsError = '';
    try {
      extensionToolPermissions = await listLocalToolPermissionPolicies();
    } catch (error) {
      extensionToolPermissionsError =
        error instanceof Error
          ? error.message
          : $_('chat.extension.permissions.loadError');
    } finally {
      extensionToolPermissionsLoading = false;
    }
  };

  const upsertExtensionToolPermission = async (
    toolName: string,
    origin: string,
    policy: 'allow' | 'deny',
  ) => {
    extensionToolPermissionsError = '';
    try {
      await upsertLocalToolPermissionPolicy({
        toolName,
        origin,
        policy,
      });
      await loadExtensionToolPermissions();
    } catch (error) {
      extensionToolPermissionsError =
        error instanceof Error
          ? error.message
          : $_('chat.extension.permissions.updateError');
    }
  };

  const deleteExtensionToolPermission = async (
    toolName: string,
    origin: string,
  ) => {
    extensionToolPermissionsError = '';
    try {
      await deleteLocalToolPermissionPolicy({
        toolName,
        origin,
      });
      await loadExtensionToolPermissions();
    } catch (error) {
      extensionToolPermissionsError =
        error instanceof Error
          ? error.message
          : $_('chat.extension.permissions.deleteError');
    }
  };

  const addExtensionToolPermissionFromDraft = async () => {
    const toolName = extensionPermissionDraftToolName.trim();
    const origin = extensionPermissionDraftOrigin.trim();
    if (!toolName || !origin) {
      extensionToolPermissionsError = $_(
        'chat.extension.permissions.missingDraftFields',
      );
      return;
    }
    await upsertExtensionToolPermission(
      toolName,
      origin,
      extensionPermissionDraftPolicy,
    );
    extensionPermissionDraftOrigin = '';
  };

  $: if (
    isExtensionConfigAvailable() &&
    showExtensionConfigMenu &&
    !extensionConfigLoaded
  ) {
    void loadExtensionConfig();
  }

  $: if (
    isExtensionConfigAvailable() &&
    showExtensionConfigMenu &&
    !extensionAuthStatusLoaded
  ) {
    void loadExtensionAuthStatus();
  }

  $: if (
    isExtensionConfigAvailable() &&
    showExtensionConfigMenu &&
    extensionSettingsTab === 'permissions'
  ) {
    void loadExtensionToolPermissions();
  }

  $: if (
    isExtensionConfigAvailable() &&
    isVisible &&
    !extensionAuthStatusLoaded
  ) {
    void loadExtensionAuthStatus();
  }

  $: extensionAuthRequired =
    isExtensionConfigAvailable() && !extensionAuthConnected;

  $: {
    if (extensionConfigMenuWasOpen && !showExtensionConfigMenu) {
      extensionAuthStatusLoaded = false;
      extensionSettingsTab = 'endpoint';
    }
    extensionConfigMenuWasOpen = showExtensionConfigMenu;
  }

  const requestOpenOverlay = () => {
    if (!isBrowser || !isSidePanelHost) return;
    publishHandoffStateIfChanged();
    window.dispatchEvent(
      new CustomEvent<{ activeTab: Tab }>(OPEN_OVERLAY_EVENT, {
        detail: { activeTab },
      }),
    );
  };

  const toggleDisplayMode = async () => {
    if (isExtensionOverlayHost) {
      const opened = await requestOpenSidePanel();
      if (opened) close();
      return;
    }
    if (isSidePanelHost) {
      requestOpenOverlay();
      return;
    }
    setDisplayMode(displayMode === 'docked' ? 'floating' : 'docked');
  };

  $: if (isBrowserReady) {
    activeTab;
    chatSessionId;
    chatDraft;
    commentThreadId;
    commentSectionKey;
    isVisible;
    publishHandoffStateIfChanged();
  }

  const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(selectors.join(',')),
    );
    return nodes.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  };

  const focusFirstFocusable = async () => {
    if (!isBrowser) return;
    await tick();
    // Prefer the chat composer first (better UX + matches UAT expectation)
    if (activeTab === 'chat') {
      await chatPanelRef?.focusComposer?.();
      const active = document.activeElement as HTMLElement | null;
      if (active && dialogEl?.contains(active)) return;
    }
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length > 0) {
      focusables[0].focus();
      return;
    }
    root.focus();
  };

  const onDialogKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogEl;
    if (!root) return;
    const focusables = getFocusableElements(root);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;

    // UX: from chat composer -> conversations menu button
    if (
      !e.shiftKey &&
      active.tagName.toLowerCase() === 'textarea' &&
      sessionMenuButtonRef
    ) {
      e.preventDefault();
      sessionMenuButtonRef.focus();
      return;
    }
    // UX: shift+tab from composer -> close button
    if (
      e.shiftKey &&
      active.tagName.toLowerCase() === 'textarea' &&
      closeButtonEl
    ) {
      e.preventDefault();
      closeButtonEl.focus();
      return;
    }

    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const formatSessionLabel = (s: ChatSession) => {
    if (s.title) return s.title;
    return $_('chat.sessions.defaultTitle', {
      values: { id: s.id.slice(0, 6) },
    });
  };

  $: activeJobsCount = $queueStore.jobs.filter(
    (job) => job.status === 'pending' || job.status === 'processing',
  ).length;
  $: hasActiveJobs = activeJobsCount > 0;
  $: failedJobsCount = $queueStore.jobs.filter(
    (job) => job.status === 'failed',
  ).length;
  $: hasFailedJobs = failedJobsCount > 0;

  const detectCommentContextFromRoute = (
    routeId: string | null,
    params: Record<string, string>,
    folderId: string | null,
  ): {
    type: 'organization' | 'folder' | 'usecase' | 'executive_summary';
    id?: string;
  } | null => {
    if (routeId === '/usecase/[id]' && params.id) {
      return { type: 'usecase', id: params.id };
    }
    if (routeId === '/usecase' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/dashboard' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/matrix' && folderId) {
      return { type: 'folder', id: folderId };
    }
    if (routeId === '/folders/[id]' && params.id) {
      return { type: 'folder', id: params.id };
    }
    if (routeId === '/organizations/[id]' && params.id) {
      return { type: 'organization', id: params.id };
    }
    return null;
  };

  $: commentContext =
    commentContextOverride ??
    detectCommentContextFromRoute(
      $contextStore.route.id ?? null,
      $contextStore.params,
      $currentFolderId,
    );
  $: if (activeTab !== 'chat' && showSessionMenu) showSessionMenu = false;

  $: {
    const detected = detectCommentContextFromRoute(
      $contextStore.route.id ?? null,
      $contextStore.params,
      $currentFolderId,
    );
    if (
      commentContextOverride &&
      (!detected ||
        detected.type !== commentContextOverride.type ||
        detected.id !== commentContextOverride.id)
    ) {
      commentContextOverride = null;
    }
  }

  const SECTION_LABEL_KEYS: Record<string, Record<string, string>> = {
    usecase: {
      name: 'common.name',
      description: 'chat.sections.usecase.description',
      problem: 'chat.sections.usecase.problem',
      solution: 'chat.sections.usecase.solution',
      benefits: 'chat.sections.usecase.benefits',
      constraints: 'chat.sections.usecase.constraints',
      risks: 'chat.sections.usecase.risks',
      metrics: 'chat.sections.usecase.metrics',
      nextSteps: 'chat.sections.usecase.nextSteps',
      technologies: 'chat.sections.usecase.technologies',
      dataSources: 'chat.sections.usecase.dataSources',
      dataObjects: 'chat.sections.usecase.dataObjects',
      valueScores: 'chat.sections.usecase.valueScores',
      complexityScores: 'chat.sections.usecase.complexityScores',
      references: 'chat.sections.usecase.references',
      contact: 'chat.sections.usecase.contact',
      deadline: 'chat.sections.usecase.deadline',
    },
    organization: {
      name: 'common.name',
      industry: 'organization.fields.industry',
      size: 'chat.sections.organization.size',
      technologies: 'chat.sections.organization.technologies',
      products: 'chat.sections.organization.products',
      processes: 'chat.sections.organization.processes',
      kpis: 'chat.sections.organization.kpis',
      challenges: 'chat.sections.organization.challenges',
      objectives: 'chat.sections.organization.objectives',
      references: 'chat.sections.organization.references',
    },
    folder: {
      description: 'chat.sections.folder.description',
      name: 'chat.sections.folder.name',
    },
    executive_summary: {
      introduction: 'chat.sections.executiveSummary.introduction',
      analyse: 'chat.sections.executiveSummary.analysis',
      analysis: 'chat.sections.executiveSummary.analysis',
      recommandation: 'chat.sections.executiveSummary.recommendations',
      recommendations: 'chat.sections.executiveSummary.recommendations',
      synthese: 'chat.sections.executiveSummary.summary',
      summary: 'chat.sections.executiveSummary.summary',
    },
  };

  const getSectionLabel = (type: string | null, key: string | null) => {
    if (!type) return null;
    if (!key) return $_('common.general');
    const i18nKey = SECTION_LABEL_KEYS[type]?.[key];
    return i18nKey ? $_(i18nKey) : key;
  };

  $: commentSectionLabel = getSectionLabel(
    commentContext?.type ?? null,
    commentSectionKey,
  );

  $: if (commentContext?.id && commentContext?.type) {
    const nextKey = `${commentContext.type}:${commentContext.id}`;
    if (nextKey !== lastCommentContextKey) {
      lastCommentContextKey = nextKey;
      commentThreadId = null;
      commentSectionKey = null;
      commentSectionLabel = null;
      commentThreads = [];
      pendingCommentAutoSelectReady = false;
    }
  }

  $: {
    const routeKey = `${$contextStore.route.id ?? ''}:${$contextStore.params?.id ?? ''}:${$currentFolderId ?? ''}`;
    if (routeKey !== lastCommentRouteKey) {
      lastCommentRouteKey = routeKey;
      // Reset selection when changing view to avoid stale section/thread.
      commentThreadId = null;
      commentSectionKey = null;
      commentSectionLabel = null;
      commentThreads = [];
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
    }
  }

  $: if (pendingCommentAutoSelect) {
    if (commentLoading) {
      pendingCommentAutoSelectReady = true;
    } else if (pendingCommentAutoSelectReady || commentThreads.length > 0) {
      const matches = commentSectionKey
        ? commentThreads.filter(
            (t) => t.sectionKey === commentSectionKey && t.status !== 'closed',
          )
        : commentThreads.filter((t) => t.status !== 'closed');
      const next = matches[0] ?? null;
      commentThreadId = next?.id ?? null;
      if (next && next.sectionKey !== commentSectionKey) {
        commentSectionKey = next.sectionKey;
      }
      pendingCommentAutoSelect = false;
      pendingCommentAutoSelectReady = false;
    }
  }

  $: if (activeTab === 'comments' && commentThreadId && commentThreads.length > 0 && !commentLoading) {
    const exists = commentThreads.some((t) => t.id === commentThreadId);
    if (!exists) commentThreadId = null;
  }

  const handleSelectSession = async (id: string) => {
    if (id === chatSessionId) return;
    chatSessionId = id;
    await chatPanelRef?.selectSession?.(id);
  };

  const handleNewSession = () => {
    chatPanelRef?.newSession?.();
    chatSessionId = null;
  };

  const onJobUpdate = (evt: any) => {
    if (evt?.type !== 'job_update') return;
    const data = evt.data ?? {};
    const job = data?.job;
    if (!job) return;
    const exists = $queueStore.jobs.some((j) => j.id === job.id);
    if (exists) updateJob(job.id, job);
    else addJob(job);
  };

  // Abonnement léger permanent aux job_update pour garder l'icône de bulle à jour
  $: if ($isAuthenticated) {
    streamHub.setJobUpdates('chatWidgetJobs', onJobUpdate);
  } else {
    streamHub.delete('chatWidgetJobs');
  }

  onMount(async () => {
    isBrowserReady = true;
    applyInitialState(initialState);
    if (isExtensionOverlayHost) {
      displayMode = 'floating';
    }
    if (isSidePanelHost) {
      displayMode = 'docked';
      isVisible = true;
      hasOpenedOnce = true;
    }
    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      mobileMql = window.matchMedia('(max-width: 639px)');
      isMobileViewport = mobileMql.matches;
      mobileMqlChangeHandler = (e: MediaQueryListEvent) => {
        isMobileViewport = e.matches;
        syncScrollLock();
        publishLayout();
      };
      mobileMql.addEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any).addListener?.(mobileMqlChangeHandler);
    }
    dockWidthCss = computeDockWidthCss();
    publishLayout();
    resizeHandler = () => {
      dockWidthCss = computeDockWidthCss();
      publishLayout();
      if (showExtensionConfigMenu) updateExtensionConfigMenuMaxHeight();
    };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('keydown', globalShortcutHandler);
    window.addEventListener('topai:close-chat', onExternalCloseChat as any);
    window.addEventListener(OPEN_CHAT_EVENT, onExternalOpenChat as any);
    handleCommentSectionClick = (event: MouseEvent) => {
      if (!commentContext?.id || !commentContext?.type) return;
      const target = event.target as HTMLElement | null;
      const sectionEl = target?.closest?.(
        '[data-comment-section]',
      ) as HTMLElement | null;
      if (!sectionEl) return;
      const sectionKey = sectionEl.getAttribute('data-comment-section');
      if (!sectionKey || sectionKey === commentSectionKey) return;
      commentSectionKey = sectionKey;
      commentThreadId = null;
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
    };
    document.addEventListener('click', handleCommentSectionClick, true);
    handleOpenComments = (event: CustomEvent) => {
      if (isPluginMode) return;
      const detail = event?.detail as {
        contextType?: string;
        contextId?: string;
        sectionKey?: string;
      } | null;
      if (!detail?.contextType || !detail?.contextId) return;
      commentContextOverride = {
        type: detail.contextType as any,
        id: detail.contextId,
      };
      activeTab = 'comments';
      commentSectionKey = detail.sectionKey ?? null;
      commentThreadId = null;
      pendingCommentAutoSelect = true;
      pendingCommentAutoSelectReady = false;
      void openWidget();
    };
    window.addEventListener('topai:open-comments', handleOpenComments as any);
    syncScrollLock();
    if ($isAuthenticated) await loadJobs();
  });

  const onBubbleKeyDown = (e: KeyboardEvent) => {
    // Ensure keyboard activation works consistently (Enter/Space)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggle();
    }
  };

  const globalShortcutHandler = (e: KeyboardEvent) => {
    // Ctrl+Shift+K toggles the widget (avoid triggering while typing)
    if (!e.ctrlKey || !e.shiftKey || (e.key !== 'K' && e.key !== 'k')) return;
    // If open, always allow closing (even while typing)
    if (isVisible) {
      e.preventDefault();
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      (target as any)?.isContentEditable
    )
      return;
    e.preventDefault();
    void toggle();
  };

  const onExternalCloseChat = () => {
    if (isExtensionOverlayHost) {
      if (!isVisible) return;
      close();
      return;
    }
    // Only close automatically when the chat is docked full screen on mobile.
    if (!isDocked || !isMobileViewport) return;
    if (!isVisible) return;
    close();
  };

  const onExternalOpenChat = (event: Event) => {
    const detail = (event as CustomEvent<{ activeTab?: Tab }>).detail;
    if (
      detail?.activeTab === 'chat' ||
      detail?.activeTab === 'queue' ||
      (detail?.activeTab === 'comments' && !isPluginMode)
    ) {
      activeTab = detail.activeTab;
    }
    void openWidget();
  };

  const toggle = async () => {
    if (isBrowser)
      lastActiveElement =
        (document.activeElement as HTMLElement | null) ?? null;
    isVisible = !isVisible;
    if (isVisible) hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    if (isVisible) void focusFirstFocusable();
  };

  const openWidget = async () => {
    if (isVisible) return;
    if (isBrowser)
      lastActiveElement =
        (document.activeElement as HTMLElement | null) ?? null;
    isVisible = true;
    hasOpenedOnce = true;
    syncScrollLock();
    publishLayout();
    await focusFirstFocusable();
  };

  const close = () => {
    if (isSidePanelHost) {
      publishHandoffStateIfChanged();
      window.close();
      return;
    }
    isVisible = false;
    syncScrollLock();
    publishLayout();
    if (isBrowser) {
      void tick().then(() => {
        if (bubbleButtonEl) {
          bubbleButtonEl.focus();
          return;
        }
        lastActiveElement?.focus?.();
      });
    }
  };

  const handlePurgeMyJobs = async () => {
    if (!confirm($_('chat.queue.confirmPurgeMine'))) {
      return;
    }
    try {
      const result = await apiPost('/queue/purge-mine', { status: 'all' });
      addToast({ type: 'success', message: result.message });
      await loadJobs();
    } catch (error) {
      console.error('Failed to purge my jobs:', error);
      addToast({ type: 'error', message: $_('chat.queue.errors.purgeMine') });
    }
  };

  onDestroy(() => {
    try {
      if (mobileMqlChangeHandler)
        mobileMql?.removeEventListener?.('change', mobileMqlChangeHandler);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (mobileMql as any)?.removeListener?.(mobileMqlChangeHandler);
    } catch {
      // ignore
    }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('keydown', globalShortcutHandler);
    window.removeEventListener('topai:close-chat', onExternalCloseChat as any);
    window.removeEventListener(OPEN_CHAT_EVENT, onExternalOpenChat as any);
    if (handleCommentSectionClick)
      document.removeEventListener('click', handleCommentSectionClick, true);
    if (handleOpenComments)
      window.removeEventListener(
        'topai:open-comments',
        handleOpenComments as any,
      );
    setBodyScrollLocked(false);
    publishLayout();
    streamHub.delete('chatWidgetJobs');
  });
</script>

<div
  class={isSidePanelHost
    ? 'queue-monitor h-full min-h-0 flex flex-col'
    : 'queue-monitor fixed bottom-4 right-4 z-50'}
  style="font-family: var(--chat-font-family, 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);"
>
  <!-- Bulle unique (commune Chat/Queue) -->
  {#if !isSidePanelHost}
    <button
      class="relative bg-primary hover:bg-primary/90 text-white rounded-full p-3 shadow-lg transition-colors"
      class:opacity-0={isVisible}
      class:pointer-events-none={isVisible}
      on:click={toggle}
      on:keydown={onBubbleKeyDown}
      title={$_('chat.widget.bubbleLabel')}
      aria-label={$_('chat.widget.bubbleLabel')}
      aria-haspopup="dialog"
      aria-expanded={isVisible}
      aria-controls="chat-widget-dialog"
      bind:this={bubbleButtonEl}
      type="button"
    >
      <!-- Icône principale: chat (toujours visible) -->
      <MessageCircle class="w-6 h-6" aria-hidden="true" />

      <!-- Badge: loading (petit spinner) -->
      {#if $queueStore.isLoading}
        <span class="absolute top-1 right-1 text-white rounded-full p-1 shadow">
          <Loader2 class="w-3 h-3 animate-spin" />
        </span>
      {:else if hasActiveJobs}
        <!-- Badge: jobs en cours => montre -->
        <span
          class="absolute top-1 right-1 text-white rounded-full p-1 shadow"
          title={$_('chat.queue.badge.active', {
            values: { count: activeJobsCount },
          })}
        >
          <Clock class="w-3 h-3" aria-hidden="true" />
        </span>
      {:else if hasFailedJobs}
        <!-- Badge: au moins un job en échec -->
        <span
          class="absolute -top-1 -right-1 bg-white text-red-600 rounded-full p-1 shadow"
          title={$_('chat.queue.badge.failed', {
            values: { count: failedJobsCount },
          })}
        >
          <X class="w-3 h-3" aria-hidden="true" />
        </span>
      {/if}
    </button>
  {/if}

  {#if hasOpenedOnce}
    {#if !isDocked}
      <div
        class="fixed inset-0 z-40 sm:hidden"
        class:hidden={!isVisible}
        aria-hidden="true"
      >
        <!-- Mobile backdrop (click to close) -->
        <button
          type="button"
          class="absolute inset-0 h-full w-full bg-black bg-opacity-40"
          on:click={close}
          tabindex="-1"
          aria-hidden="true"
        ></button>
      </div>
    {/if}

    <!-- Window mounted once, then hide/show to avoid remount + API calls -->
    <div
      id="chat-widget-dialog"
      role="dialog"
      aria-label={$_('chat.widget.bubbleLabel')}
      aria-modal={isDocked ? 'false' : 'true'}
      tabindex="-1"
      bind:this={dialogEl}
      on:keydown={onDialogKeyDown}
      class={isSidePanelHost
        ? 'h-full w-full bg-white flex flex-col'
        : isDocked
        ? 'fixed top-0 right-0 bottom-0 z-50 bg-white border-l border-gray-200 flex flex-col'
        : 'fixed inset-x-0 bottom-0 z-50 bg-white shadow-2xl border border-gray-200 flex flex-col h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl sm:absolute sm:inset-auto sm:bottom-0 sm:right-0 sm:h-[70vh] sm:max-h-[calc(100vh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg'}
      style={isSidePanelHost ? '' : isDocked ? `width: ${dockWidthCss};` : ''}
      class:hidden={!isVisible}
      class:overflow-hidden={!showExtensionConfigMenu}
      class:overflow-visible={showExtensionConfigMenu}
    >
      <!-- Header commun (tabs) -->
      <div class="px-4 h-14 border-b border-gray-200 flex items-center">
        <div class="flex w-full items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            {#if isDocked && isMobileViewport && !isSidePanelHost}
              <button
                class="inline-flex items-center justify-center rounded p-2 text-slate-700 hover:bg-slate-100"
                on:click={() =>
                  window.dispatchEvent(
                    new CustomEvent('topai:toggle-burger-menu'),
                  )}
                aria-label={$_('common.menu')}
                type="button"
              >
                <Menu class="h-5 w-5" aria-hidden="true" />
              </button>
            {/if}

            <div class="flex items-center gap-2">
              <div class="flex items-center gap-1 rounded bg-slate-50 p-1">
                {#if !isPluginMode}
                  <button
                    class="rounded px-2 py-1 text-xs transition {activeTab ===
                    'comments'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'}"
                    type="button"
                    on:click={() => (activeTab = 'comments')}
                  >
                    {$_('chat.tabs.comments')}
                  </button>
                {/if}
                <button
                  class="rounded px-2 py-1 text-xs transition {activeTab ===
                  'chat'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'}"
                  type="button"
                  on:click={() => (activeTab = 'chat')}
                >
                  {$_('chat.tabs.chat')}
                </button>
                <button
                  class="rounded px-2 py-1 text-xs transition {activeTab ===
                  'queue'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'}"
                  type="button"
                  on:click={() => (activeTab = 'queue')}
                >
                  {$_('chat.tabs.jobs')}
                </button>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            {#if activeTab === 'chat'}
              <MenuPopover
                bind:open={showSessionMenu}
                bind:triggerRef={sessionMenuButtonRef}
              >
                <svelte:fragment slot="trigger" let:toggle>
                  <button
                    class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                    on:click={toggle}
                    title={$_('chat.sessions.choose')}
                    aria-label={$_('chat.sessions.choose')}
                    type="button"
                    bind:this={sessionMenuButtonRef}
                  >
                    <List class="w-4 h-4" />
                  </button>
                </svelte:fragment>
                <svelte:fragment slot="menu" let:close>
                  <button
                    class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50"
                    type="button"
                    on:click={() => {
                      close();
                      handleNewSession();
                    }}
                  >
                    {$_('chat.sessions.new')}
                  </button>
                  <div class="border-t border-slate-100 my-1"></div>
                  {#if chatLoadingSessions}
                    <div class="px-2 py-1 text-[11px] text-slate-500">
                      {$_('common.loading')}
                    </div>
                  {:else if chatSessions.length === 0}
                    <div class="px-2 py-1 text-[11px] text-slate-500">
                      {$_('chat.sessions.none')}
                    </div>
                  {:else}
                    <div class="max-h-48 overflow-auto slim-scroll">
                      {#each chatSessions as s (s.id)}
                        <button
                          class="w-full text-left rounded px-2 py-1 text-xs hover:bg-slate-50 {chatSessionId ===
                          s.id
                            ? 'text-slate-900 font-semibold'
                            : 'text-slate-600'}"
                          type="button"
                          on:click={() => {
                            close();
                            void handleSelectSession(s.id);
                          }}
                        >
                          {formatSessionLabel(s)}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </svelte:fragment>
              </MenuPopover>
              <button
                class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                on:click={() => chatPanelRef?.newSession?.()}
                title={$_('chat.sessions.new')}
                aria-label={$_('chat.sessions.new')}
                type="button"
              >
                <Plus class="w-4 h-4" />
              </button>

              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded disabled:opacity-50"
                on:click={() => chatPanelRef?.deleteCurrentSession?.()}
                title={$_('chat.sessions.delete')}
                aria-label={$_('chat.sessions.delete')}
                type="button"
                disabled={!chatSessionId}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
            {#if activeTab === 'queue'}
              <button
                class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                on:click={handlePurgeMyJobs}
                title={$_('chat.queue.purgeMine')}
                aria-label={$_('chat.queue.purgeMine')}
                type="button"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            {/if}
            {#if isExtensionConfigAvailable()}
              <MenuPopover
                bind:open={showExtensionConfigMenu}
                bind:triggerRef={extensionConfigButtonRef}
                widthClass="w-80"
                align="right"
                menuPaddingClass="p-0"
                menuClass="overflow-hidden"
                menuStyle={`height: ${extensionConfigMenuMaxHeightPx}px; max-height: ${extensionConfigMenuMaxHeightPx}px;`}
              >
                <svelte:fragment slot="trigger" let:toggle>
                  <button
                    class="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded"
                    on:click={toggle}
                    title={$_('chat.extension.settingsTitle')}
                    aria-label={$_('chat.extension.settingsTitle')}
                    type="button"
                    bind:this={extensionConfigButtonRef}
                  >
                    <Settings class="w-4 h-4" />
                  </button>
                </svelte:fragment>
                <svelte:fragment slot="menu">
                  <div class="flex h-full min-h-0 flex-col">
                    <div class="border-b border-slate-200 p-2">
                      <div class="flex items-center gap-1 rounded bg-slate-50 p-1">
                        <button
                          class="rounded px-2 py-1 text-xs transition {extensionSettingsTab ===
                          'endpoint'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'}"
                          type="button"
                          on:click={() => (extensionSettingsTab = 'endpoint')}
                        >
                          {$_('chat.extension.settingsTabs.endpoint')}
                        </button>
                        <button
                          class="rounded px-2 py-1 text-xs transition {extensionSettingsTab ===
                          'permissions'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'}"
                          type="button"
                          on:click={() => (extensionSettingsTab = 'permissions')}
                        >
                          {$_('chat.extension.settingsTabs.permissions')}
                        </button>
                      </div>
                    </div>
                    <div class="flex-1 min-h-0 overflow-auto slim-scroll space-y-2 p-2">

                  {#if extensionSettingsTab === 'endpoint'}
                    <div class="text-xs font-semibold text-slate-700">
                      {$_('chat.extension.endpointConfiguration')}
                    </div>
                    <div class="space-y-1">
                      <label
                        class="block text-[11px] text-slate-600"
                        for="extension-config-api-base-url"
                      >
                        {$_('chat.extension.apiBaseUrl')}
                      </label>
                      <input
                        id="extension-config-api-base-url"
                        class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        type="text"
                        bind:value={extensionConfigForm.apiBaseUrl}
                        placeholder="https://.../api/v1"
                        disabled={extensionConfigLoading ||
                          extensionConfigSaving ||
                          extensionConfigTesting}
                      />
                    </div>
                    <div class="space-y-1">
                      <label
                        class="block text-[11px] text-slate-600"
                        for="extension-config-app-base-url"
                      >
                        {$_('chat.extension.appBaseUrl')}
                      </label>
                      <input
                        id="extension-config-app-base-url"
                        class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        type="text"
                        bind:value={extensionConfigForm.appBaseUrl}
                        placeholder="https://..."
                        disabled={extensionConfigLoading ||
                          extensionConfigSaving ||
                          extensionConfigTesting}
                      />
                    </div>
                    <div class="space-y-1">
                      <label
                        class="block text-[11px] text-slate-600"
                        for="extension-config-ws-base-url"
                      >
                        {$_('chat.extension.wsBaseUrlOptional')}
                      </label>
                      <input
                        id="extension-config-ws-base-url"
                        class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        type="text"
                        bind:value={extensionConfigForm.wsBaseUrl}
                        placeholder="wss://..."
                        disabled={extensionConfigLoading ||
                          extensionConfigSaving ||
                          extensionConfigTesting}
                      />
                    </div>
                    <div class="flex items-center gap-2 pt-1">
                      <button
                        class="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                        type="button"
                        on:click={() => void saveExtensionConfig()}
                        disabled={extensionConfigLoading ||
                          extensionConfigSaving ||
                          extensionConfigTesting}
                      >
                        {$_('common.save')}
                      </button>
                      <button
                        class="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        type="button"
                        on:click={() => void testExtensionConfig()}
                        disabled={extensionConfigLoading ||
                          extensionConfigSaving ||
                          extensionConfigTesting}
                      >
                        {$_('chat.extension.testApi')}
                      </button>
                    </div>
                    {#if extensionConfigStatus}
                      <div
                        class={`rounded border px-2 py-1 text-[11px] ${
                          extensionConfigStatusKind === 'ok'
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : extensionConfigStatusKind === 'error'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        {extensionConfigStatus}
                      </div>
                    {/if}
                    <div class="border-t border-slate-200 pt-2 space-y-2">
                      <div class="text-xs font-semibold text-slate-700">
                        {$_('chat.extension.auth.title')}
                      </div>
                      <div class="text-[11px] text-slate-600">
                        {#if extensionAuthConnected && extensionAuthUser}
                          {$_('chat.extension.auth.connectedAs')} {extensionAuthUser.displayName ||
                            extensionAuthUser.email ||
                            extensionAuthUser.id}
                        {:else}
                          {$_('chat.extension.auth.notConnected')}
                        {/if}
                      </div>
                      <div class="flex items-center gap-2">
                        {#if extensionAuthConnected}
                          <button
                            class="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            type="button"
                            on:click={() => void logoutExtensionAuthAction()}
                            disabled={extensionAuthLoggingOut ||
                              extensionAuthLoading ||
                              extensionConfigLoading ||
                              extensionConfigSaving ||
                              extensionConfigTesting}
                          >
                            {$_('chat.extension.auth.logout')}
                          </button>
                        {:else}
                          <button
                            class="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                            type="button"
                            on:click={() => void connectExtensionAuthAction()}
                            disabled={extensionAuthConnecting ||
                              extensionAuthLoading ||
                              extensionConfigLoading ||
                              extensionConfigSaving ||
                              extensionConfigTesting}
                          >
                            {$_('chat.extension.auth.connect')}
                          </button>
                        {/if}
                        {#if extensionAuthLoginUrl && !extensionAuthConnected}
                          <button
                            class="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                            type="button"
                            on:click={() => void openExtensionLoginPage()}
                          >
                            {$_('chat.extension.auth.openLogin')}
                          </button>
                        {/if}
                      </div>
                      {#if extensionAuthStatus}
                        <div
                          class={`rounded border px-2 py-1 text-[11px] ${
                            extensionAuthStatusKind === 'ok'
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : extensionAuthStatusKind === 'error'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          {extensionAuthStatus}
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <div class="text-xs font-semibold text-slate-700">
                      {$_('chat.extension.permissions.title')}
                    </div>
                    <div class="text-[11px] text-slate-500">
                      {$_('chat.extension.permissions.description')}
                    </div>
                    <div class="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
                      <div class="text-[11px] font-semibold text-slate-600">
                        {$_('chat.extension.permissions.addTitle')}
                      </div>
                      <div class="grid grid-cols-1 gap-2">
                        <select
                          class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                          bind:value={extensionPermissionDraftToolName}
                        >
                          {#each EXTENSION_PERMISSION_TOOL_OPTIONS as option}
                            <option value={option}>{option}</option>
                          {/each}
                        </select>
                        <input
                          class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                          type="text"
                          bind:value={extensionPermissionDraftOrigin}
                          placeholder="https://example.com | https://* | *.example.com | *"
                        />
                        <select
                          class="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                          bind:value={extensionPermissionDraftPolicy}
                        >
                          <option value="allow">
                            {$_('chat.extension.permissions.allowLabel')}
                          </option>
                          <option value="deny">
                            {$_('chat.extension.permissions.denyLabel')}
                          </option>
                        </select>
                        <button
                          class="rounded bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary/90"
                          type="button"
                          on:click={() =>
                            void addExtensionToolPermissionFromDraft()}
                        >
                          {$_('chat.extension.permissions.addCta')}
                        </button>
                      </div>
                    </div>

                    {#if extensionToolPermissionsLoading}
                      <div class="text-[11px] text-slate-500">
                        {$_('common.loading')}
                      </div>
                    {:else if extensionToolPermissions.length === 0}
                      <div class="text-[11px] text-slate-500">
                        {$_('chat.extension.permissions.empty')}
                      </div>
                    {:else}
                      <div class="space-y-2">
                        {#each extensionToolPermissions as entry (
                          `${entry.toolName}:${entry.origin}`
                        )}
                          <div class="rounded border border-slate-200 p-2 space-y-2">
                            <div class="text-[11px] font-semibold text-slate-700 break-all">
                              {entry.toolName}
                            </div>
                            <div class="text-[11px] text-slate-500 break-all">
                              {entry.origin}
                            </div>
                            <div class="flex items-center gap-2">
                              <select
                                class="flex-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                                value={entry.policy}
                                on:change={(event) =>
                                  void upsertExtensionToolPermission(
                                    entry.toolName,
                                    entry.origin,
                                    (
                                      event.currentTarget as HTMLSelectElement
                                    ).value as 'allow' | 'deny',
                                  )}
                              >
                                <option value="allow">
                                  {$_('chat.extension.permissions.allowLabel')}
                                </option>
                                <option value="deny">
                                  {$_('chat.extension.permissions.denyLabel')}
                                </option>
                              </select>
                              <button
                                type="button"
                                class="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                                on:click={() =>
                                  void deleteExtensionToolPermission(
                                    entry.toolName,
                                    entry.origin,
                                  )}
                              >
                                {$_('common.delete')}
                              </button>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}

                    {#if extensionToolPermissionsError}
                      <div
                        class="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700"
                      >
                        {extensionToolPermissionsError}
                      </div>
                    {/if}
                  {/if}
                    </div>
                  </div>
                </svelte:fragment>
              </MenuPopover>
            {/if}
            <!-- Desktop-only: hide below lg to avoid UI duplication in responsive header layouts -->
            <button
              class={`${isSidePanelHost ? 'inline-flex' : 'hidden lg:inline-flex'} text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded`}
              on:click={toggleDisplayMode}
              title={isDocked
                ? $_('chat.widget.switchToWidget')
                : $_('chat.widget.switchToPanel')}
              aria-label={isDocked
                ? $_('chat.widget.switchToWidget')
                : $_('chat.widget.switchToPanel')}
              type="button"
            >
              {#if isDocked}
                <Minimize2 class="w-4 h-4" aria-hidden="true" />
              {:else}
                <Maximize2 class="w-4 h-4" aria-hidden="true" />
              {/if}
            </button>
            <button
              class="text-gray-400 hover:text-gray-600"
              on:click={close}
              aria-label={$_('common.close')}
              type="button"
              bind:this={closeButtonEl}
            >
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Contenu (QueueMonitor inchangé hors header) -->
      <div class="flex-1 min-h-0">
        {#if extensionAuthRequired}
          <div class="h-full min-h-0 flex items-center justify-center px-4 py-6">
            <div
              class="w-full max-w-md rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-3"
            >
              <div>{$_('chat.extension.authRequired.title')}</div>
              <div class="text-xs text-slate-500">
                {$_('chat.extension.authRequired.description')}
              </div>
              <button
                class="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
                type="button"
                on:mousedown|stopPropagation={openExtensionSettingsMenu}
                on:click|stopPropagation={openExtensionSettingsMenu}
              >
                {$_('chat.extension.authRequired.openSettings')}
              </button>
            </div>
          </div>
        {:else}
          {#if activeTab === 'queue'}
            <div class="h-full min-h-0">
              <QueueMonitor />
            </div>
          {/if}
          {#if !isPluginMode && activeTab === 'comments'}
            <div class="h-full min-h-0">
              {#if commentContext?.id}
                <ChatPanel
                  mode="comments"
                  bind:commentThreads
                  bind:commentThreadId
                  bind:commentLoading
                  {commentSectionKey}
                  {commentSectionLabel}
                  commentContextType={commentContext.type}
                  commentContextId={commentContext.id}
                  {contextStore}
                />
              {:else}
                <div
                  class="h-full rounded border border-slate-200 bg-white p-4 text-sm text-slate-500"
                >
                  {$_('chat.comments.noContext')}
                </div>
              {/if}
            </div>
          {/if}
          <div class="h-full min-h-0 flex flex-col" class:hidden={activeTab !== 'chat'}>
            <ChatPanel
              bind:this={chatPanelRef}
              bind:sessions={chatSessions}
              bind:sessionId={chatSessionId}
              bind:draft={chatDraft}
              bind:loadingSessions={chatLoadingSessions}
              {contextStore}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
