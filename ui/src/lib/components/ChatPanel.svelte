<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { page } from '$app/stores';
  import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '$lib/utils/api';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { Streamdown } from 'svelte-streamdown';
  import EditableInput from '$lib/components/EditableInput.svelte';
  import { currentFolderId, foldersStore } from '$lib/stores/folders';
  import { organizationsStore } from '$lib/stores/organizations';
  import { useCasesStore } from '$lib/stores/useCases';
  import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';
  import { deleteDocument, listDocuments, uploadDocument, type ContextDocumentItem } from '$lib/utils/documents';
  import { streamHub, type StreamHubEvent } from '$lib/stores/streamHub';
  import {
    Send,
    ThumbsUp,
    ThumbsDown,
    Copy,
    Pencil,
    RotateCcw,
    Check,
    Paperclip,
    X,
    Plus,
    FileText,
    Globe,
    Link2,
    Building2,
    Folder,
    Lightbulb,
    Table,
    ScrollText
  } from '@lucide/svelte';
  import { renderMarkdownWithRefs } from '$lib/utils/markdown';

  type ChatSession = {
    id: string;
    title?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    createdAt?: string;
    updatedAt?: string | null;
  };

  type ChatMessage = {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string | null;
    reasoning?: string | null;
    sequence?: number;
    createdAt?: string;
    feedbackVote?: number | null;
  };

  type LocalMessage = ChatMessage & {
    _localStatus?: 'processing' | 'completed' | 'failed';
    _streamId?: string;
  };

  type StreamEvent = { eventType: string; data: any; sequence: number; createdAt?: string };
  type IconComponent = typeof FileText;
  type ChatContextEntry = {
    contextType: 'organization' | 'folder' | 'usecase' | 'executive_summary';
    contextId?: string;
    label: string;
    active: boolean;
    used: boolean;
    lastUsedAt: number;
  };

  type ToolToggle = {
    id: string;
    label: string;
    description?: string;
    toolIds: string[];
    icon: IconComponent;
  };

  const getContextIcon = (type: ChatContextEntry['contextType']) => {
    if (type === 'organization') return Building2;
    if (type === 'folder') return Folder;
    if (type === 'usecase') return Lightbulb;
    if (type === 'executive_summary') return ScrollText;
    return FileText;
  };

  const contextNameByKey = new Map<string, string>();
  const contextNameLoading = new Set<string>();

  const getContextLabelFromStores = (type: ChatContextEntry['contextType'], contextId: string) => {
    if (!contextId) return '';
    if (type === 'organization') {
      const org = $organizationsStore.find((o) => o.id === contextId);
      return org?.name || '';
    }
    if (type === 'folder') {
      const folder = $foldersStore.find((f) => f.id === contextId);
      return folder?.name || '';
    }
    if (type === 'usecase') {
      const useCase = $useCasesStore.find((u) => u.id === contextId);
      return useCase?.data?.name || useCase?.name || '';
    }
    if (type === 'executive_summary') {
      const folder = $foldersStore.find((f) => f.id === contextId);
      return folder?.name ? `Synthèse: ${folder.name}` : '';
    }
    return '';
  };

  const loadContextName = async (type: ChatContextEntry['contextType'], contextId: string) => {
    const key = `${type}:${contextId}`;
    if (!contextId || contextNameByKey.has(key) || contextNameLoading.has(key)) return;
    contextNameLoading.add(key);
    try {
      if (type === 'organization') {
        const org = await apiGet<{ name?: string }>(`/organizations/${contextId}`);
        if (org?.name) contextNameByKey.set(key, org.name);
      } else if (type === 'folder' || type === 'executive_summary') {
        const folder = await apiGet<{ name?: string }>(`/folders/${contextId}`);
        if (folder?.name) {
          contextNameByKey.set(key, type === 'executive_summary' ? `Synthèse: ${folder.name}` : folder.name);
        }
      } else if (type === 'usecase') {
        const useCase = await apiGet<{ data?: { name?: string }; name?: string }>(`/use-cases/${contextId}`);
        const name = useCase?.data?.name || useCase?.name;
        if (name) contextNameByKey.set(key, name);
      }
    } catch {
      // ignore
    } finally {
      contextNameLoading.delete(key);
    }
  };

  const refreshContextLabels = () => {
    contextEntries = contextEntries.map((c) => {
      const key = `${c.contextType}:${c.contextId}`;
      const fromStore = getContextLabelFromStores(c.contextType, c.contextId || '');
      const cached = contextNameByKey.get(key) || '';
      const nextLabel = fromStore || cached || c.label;
      if (!nextLabel || nextLabel === c.contextId) {
        void loadContextName(c.contextType, c.contextId || '');
      }
      return { ...c, label: nextLabel };
    });
  };

  export let sessions: ChatSession[] = [];
  export let sessionId: string | null = null;
  export let loadingSessions = false;

  let messages: LocalMessage[] = [];
  let loadingMessages = false;
  let sending = false;
  let errorMsg: string | null = null;
  let input = '';
  let listEl: HTMLDivElement | null = null;
  let composerEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let followBottom = true;
  let scrollScheduled = false;
  let scrollForcePending = false;
  const BOTTOM_THRESHOLD_PX = 96;
  let editingMessageId: string | null = null;
  let editingContent = '';
  const copiedMessageIds = new Set<string>();
  const COMPOSER_BASE_HEIGHT = 40;
  let composerIsMultiline = false;
  let composerMaxHeight = COMPOSER_BASE_HEIGHT;
  let sessionDocs: ContextDocumentItem[] = [];
  let sessionDocsUploading = false;
  let sessionDocsError: string | null = null;
  let sessionDocsKey = '';
  let sessionDocsSseKey = '';
  let sessionTitlesSseKey = '';
  let sessionDocsReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let showComposerMenu = false;
  let composerMenuRef: HTMLDivElement | null = null;
  let composerMenuButtonRef: HTMLButtonElement | null = null;
  // eslint-disable-next-line no-unused-vars
  let handleDocumentClick: ((_: MouseEvent) => void) | null = null;
  let contextEntries: ChatContextEntry[] = [];
  let sortedContexts: ChatContextEntry[] = [];
  let toolEnabledById: Record<string, boolean> = {};
  let prefsKey = '';
  let lastRouteContextKey: string | null = null;

  // Historique batch (Option C): messageId -> events
  let initialEventsByMessageId = new Map<string, StreamEvent[]>();
  let streamDetailsLoading = false;
  const terminalRefreshInFlight = new Set<string>();
  const jobPollInFlight = new Set<string>();

  /**
   * Détecte le contexte depuis la route actuelle
   * Retourne { primaryContextType, primaryContextId? } ou null si pas de contexte
   */
  const detectContextFromRoute = (): { primaryContextType: string; primaryContextId?: string } | null => {
    const routeId = $page.route.id;
    const params = $page.params;

    // /cas-usage/[id] → usecase
    if (routeId === '/cas-usage/[id]' && params.id) {
      return { primaryContextType: 'usecase', primaryContextId: params.id };
    }

    // /cas-usage → use case list; when a folder is selected, treat chat context as folder
    if (routeId === '/cas-usage' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /dashboard → dashboard is folder-scoped when a folder is selected
    if (routeId === '/dashboard' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /matrice → matrix view is folder-scoped when a folder is selected
    if (routeId === '/matrice' && $currentFolderId) {
      return { primaryContextType: 'folder', primaryContextId: $currentFolderId };
    }

    // /dossiers/[id] → folder
    if (routeId === '/dossiers/[id]' && params.id) {
      return { primaryContextType: 'folder', primaryContextId: params.id };
    }

    // /organisations/[id] → organization
    if (routeId === '/organisations/[id]' && params.id) {
      return { primaryContextType: 'organization', primaryContextId: params.id };
    }

    // /organisations → organizations list (organization scope without a specific id)
    if (routeId === '/organisations') {
      return { primaryContextType: 'organization' };
    }

    // /dossiers → folders list (folder scope without a specific id)
    if (routeId === '/dossiers') {
      return { primaryContextType: 'folder' };
    }

    // Pas de contexte détecté
    return null;
  };

  const TOOL_TOGGLES: ToolToggle[] = [
    {
      id: 'documents',
      label: 'Documents',
      description: 'Lister / analyser les documents',
      toolIds: ['documents'],
      icon: FileText
    },
    {
      id: 'web_search',
      label: 'Web search',
      description: 'Rechercher des infos sur le web',
      toolIds: ['web_search'],
      icon: Globe
    },
    {
      id: 'web_extract',
      label: 'Web extract',
      description: 'Extraire le contenu des URLs',
      toolIds: ['web_extract'],
      icon: Link2
    },
    {
      id: 'organization_read',
      label: 'Organisation (lecture)',
      toolIds: ['organizations_list', 'organization_get'],
      icon: Building2
    },
    {
      id: 'organization_update',
      label: 'Organisation (édition)',
      toolIds: ['organization_update'],
      icon: Building2
    },
    {
      id: 'folder_read',
      label: 'Dossier (lecture)',
      toolIds: ['folders_list', 'folder_get'],
      icon: Folder
    },
    {
      id: 'folder_update',
      label: 'Dossier (édition)',
      toolIds: ['folder_update'],
      icon: Folder
    },
    {
      id: 'usecase_read',
      label: "Cas d'usage (lecture)",
      toolIds: ['usecases_list', 'usecase_get', 'read_usecase'],
      icon: Lightbulb
    },
    {
      id: 'usecase_update',
      label: "Cas d'usage (édition)",
      toolIds: ['usecase_update', 'update_usecase_field'],
      icon: Lightbulb
    },
    {
      id: 'matrix',
      label: 'Matrice (lecture/édition)',
      toolIds: ['matrix_get', 'matrix_update'],
      icon: Table
    },
    {
      id: 'executive_summary',
      label: 'Synthèse exécutive',
      toolIds: ['executive_summary_get', 'executive_summary_update'],
      icon: ScrollText
    }
  ];

  const getPrefsKey = (id: string | null) => `chat_session_prefs:${id || 'new'}`;

  const loadPrefs = (id: string | null) => {
    if (typeof localStorage === 'undefined') return;
    const key = getPrefsKey(id);
    prefsKey = key;
    try {
      if (id && !localStorage.getItem(key)) {
        const draft = localStorage.getItem(getPrefsKey(null));
        if (draft) {
          localStorage.setItem(key, draft);
        }
      }
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        contexts?: ChatContextEntry[];
        toolEnabledById?: Record<string, boolean>;
      };
      if (Array.isArray(parsed.contexts)) {
        contextEntries = parsed.contexts
          .filter((c) => !!c.contextType)
          .map((c) => ({
            ...c,
            used: typeof c.used === 'boolean' ? c.used : true
          }));
      }
      if (parsed.toolEnabledById && typeof parsed.toolEnabledById === 'object') {
        toolEnabledById = parsed.toolEnabledById;
      }
    } catch {
      // ignore
    }
  };

  const savePrefs = () => {
    if (!prefsKey || typeof localStorage === 'undefined') return;
    const payload = {
      contexts: contextEntries,
      toolEnabledById
    };
    try {
      localStorage.setItem(prefsKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  const ensureDefaultToolToggles = () => {
    if (Object.keys(toolEnabledById).length > 0) return;
    const defaults: Record<string, boolean> = {};
    for (const t of TOOL_TOGGLES) defaults[t.id] = true;
    toolEnabledById = defaults;
  };

  const updateContextFromRoute = () => {
    const context = detectContextFromRoute();
    const contextId = context?.primaryContextId || '';
    const contextType = (context?.primaryContextType || null) as ChatContextEntry['contextType'] | null;
    const routeKey = contextType && contextId ? `${contextType}:${contextId}` : null;
    if (lastRouteContextKey && lastRouteContextKey !== routeKey) {
      contextEntries = contextEntries.filter(
        (c) => !(c.contextType + ':' + c.contextId === lastRouteContextKey && !c.used)
      );
      savePrefs();
    }
    lastRouteContextKey = routeKey;
    if (!contextType || !contextId) return;
    const label = getContextLabelFromStores(contextType, contextId)
      || contextNameByKey.get(`${contextType}:${contextId}`)
      || contextId;
    const now = Date.now();
    const idx = contextEntries.findIndex((c) => c.contextType === contextType && c.contextId === contextId);
    if (idx === -1) {
      contextEntries = [
        { contextType, contextId, label, active: true, used: false, lastUsedAt: now },
        ...contextEntries
      ];
    } else {
      const next = [...contextEntries];
      const current = next[idx];
      next[idx] = { ...current, label, active: true };
      contextEntries = next;
    }
    if (label === contextId) {
      void loadContextName(contextType, contextId);
    }
    savePrefs();
  };

  const markCurrentContextUsed = () => {
    const context = detectContextFromRoute();
    if (!context?.primaryContextType || !context.primaryContextId) return;
    const contextType = context.primaryContextType as ChatContextEntry['contextType'];
    const contextId = context.primaryContextId;
    const label = getContextLabelFromStores(contextType, contextId)
      || contextNameByKey.get(`${contextType}:${contextId}`)
      || contextId;
    const now = Date.now();
    const idx = contextEntries.findIndex((c) => c.contextType === contextType && c.contextId === contextId);
    if (idx === -1) {
      contextEntries = [
        { contextType, contextId, label, active: true, used: true, lastUsedAt: now },
        ...contextEntries
      ];
    } else {
      const next = [...contextEntries];
      const current = next[idx];
      next[idx] = { ...current, label, active: true, used: true, lastUsedAt: now };
      contextEntries = next;
    }
    if (label === contextId) {
      void loadContextName(contextType, contextId);
    }
    savePrefs();
  };

  $: sortedContexts = [...contextEntries];

  const getActiveContexts = () =>
    contextEntries
      .filter((c) => c.active && c.used)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  const getEnabledToolIds = () => {
    const enabled = new Set<string>();
    for (const t of TOOL_TOGGLES) {
      if (toolEnabledById[t.id]) {
        t.toolIds.forEach((id) => enabled.add(id));
      }
    }
    return Array.from(enabled);
  };

  const toggleContextActive = (entry: ChatContextEntry) => {
    const now = Date.now();
    contextEntries = contextEntries.map((c) =>
      c.contextType === entry.contextType && c.contextId === entry.contextId
        ? { ...c, active: !c.active, lastUsedAt: !c.active ? now : c.lastUsedAt }
        : c
    );
    savePrefs();
  };

  const toggleTool = (id: string) => {
    toolEnabledById = { ...toolEnabledById, [id]: !toolEnabledById[id] };
    savePrefs();
  };

  const isNearBottom = (): boolean => {
    if (!listEl) return true;
    const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    return remaining < BOTTOM_THRESHOLD_PX;
  };

  const scheduleScrollToBottom = (opts?: { force?: boolean }) => {
    if (opts?.force) scrollForcePending = true;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      const force = scrollForcePending;
      scrollForcePending = false;
      if (!force && !followBottom) return;
      void scrollChatToBottomStable();
    });
  };

  const onListScroll = () => {
    followBottom = isNearBottom();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const handleComposerChange = async () => {
    await tick();
    updateComposerHeight();
  };

  const updateComposerHeight = () => {
    if (!composerEl) return;
    const containerHeight = panelEl?.clientHeight ?? 0;
    const maxHeight = Math.max(COMPOSER_BASE_HEIGHT, Math.floor(containerHeight * 0.3));
    composerMaxHeight = maxHeight;
    const contentHeight = composerEl.scrollHeight || COMPOSER_BASE_HEIGHT;
    const wasMultiline = composerIsMultiline;
    composerIsMultiline = contentHeight > COMPOSER_BASE_HEIGHT + 2;
    if (composerIsMultiline !== wasMultiline) {
      requestAnimationFrame(updateComposerHeight);
    }
  };

  const sessionDocStatusLabel = (s: string) => {
    if (s === 'uploaded') return 'En attente';
    if (s === 'processing') return 'Résumé en cours';
    if (s === 'ready') return 'Résumé prêt';
    if (s === 'failed') return 'Échec';
    return 'Inconnu';
  };

  const loadSessionDocs = async () => {
    if (!sessionId) return;
    sessionDocsError = null;
    try {
      const scopedWs = getScopedWorkspaceIdForUser();
      const res = await listDocuments({ contextType: 'chat_session', contextId: sessionId, workspaceId: scopedWs });
      sessionDocs = res.items ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sessionDocsError = msg;
    }
  };

  const onPickSessionDoc = async (e: Event) => {
    const inputEl = e.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    showComposerMenu = false;

    sessionDocsUploading = true;
    sessionDocsError = null;
    try {
      if (!sessionId) {
        const context = detectContextFromRoute();
        const res = await apiPost<{ sessionId: string }>('/chat/sessions', {
          primaryContextType: context?.primaryContextType,
          primaryContextId: context?.primaryContextId
        });
        sessionId = res.sessionId;
        await loadSessions();
        await loadMessages(res.sessionId, { scrollToBottom: true });
      }
      const scopedWs = getScopedWorkspaceIdForUser();
      await uploadDocument({ contextType: 'chat_session', contextId: sessionId!, file, workspaceId: scopedWs });
      await loadSessionDocs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
    } finally {
      sessionDocsUploading = false;
    }
  };

  const removeSessionDoc = async (doc: ContextDocumentItem) => {
    try {
      const scopedWs = getScopedWorkspaceIdForUser();
      await deleteDocument({ documentId: doc.id, workspaceId: scopedWs });
      sessionDocs = sessionDocs.filter((d) => d.id !== doc.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sessionDocsError = msg;
    }
  };

  const startEditMessage = (m: ChatMessage) => {
    if (!m.id || m.role !== 'user') return;
    editingMessageId = m.id;
    editingContent = m.content ?? '';
  };

  const cancelEditMessage = () => {
    editingMessageId = null;
    editingContent = '';
  };

  const saveEditMessage = async (messageId: string) => {
    const next = editingContent.trim();
    if (!next) return;
    errorMsg = null;
    try {
      await apiPatch(`/chat/messages/${encodeURIComponent(messageId)}`, { content: next });
      messages = messages.map((m) => (m.id === messageId ? { ...m, content: next } : m));
      cancelEditMessage();
      await retryMessage(messageId);
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la modification du message');
    }
  };

  const retryMessage = async (messageId: string) => {
    if (!sessionId) return;
    errorMsg = null;
    try {
      await apiPost(`/chat/messages/${encodeURIComponent(messageId)}/retry`);
      await loadMessages(sessionId, { scrollToBottom: true });
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du retry');
    }
  };

  const retryFromAssistant = async (assistantMessageId: string) => {
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const previousUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!previousUser) return;
    await retryMessage(previousUser.id);
  };

  const markCopied = (messageId: string) => {
    copiedMessageIds.add(messageId);
    setTimeout(() => {
      copiedMessageIds.delete(messageId);
    }, 2000);
  };

  const isCopied = (messageId: string) => copiedMessageIds.has(messageId);

  const copyToClipboard = async (text: string, html?: string) => {
    if (!text) return;
    try {
      if (navigator?.clipboard?.write && html && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        });
        await navigator.clipboard.write([item]);
        return true;
      }
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch {
      errorMsg = 'Impossible de copier le message';
    }
    return false;
  };

  export const focusComposer = async () => {
    await tick();
    const target = composerEl?.querySelector('.ProseMirror') as HTMLElement | null;
    target?.focus();
  };

  const scrollChatToBottomStable = async () => {
    await tick();
    if (!listEl) return;
    // Attendre quelques frames pour les variations de layout (StreamMessage, fonts, etc.)
    let lastHeight = -1;
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const h = listEl.scrollHeight;
      if (h === lastHeight) break;
      lastHeight = h;
      try {
        listEl.scrollTop = listEl.scrollHeight;
      } catch {
        // ignore
      }
    }
  };

  const formatApiError = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      const base = typeof e.message === 'string' ? e.message : String(e.message);
      if (e.status) return `HTTP ${e.status}: ${base}`;
      return base;
    }
    return fallback;
  };

  const loadSessions = async () => {
    loadingSessions = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessions: ChatSession[] }>('/chat/sessions');
      sessions = res.sessions ?? [];
      if (!sessionId && sessions.length > 0) {
        await selectSession(sessions[0].id);
      }
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du chargement des sessions');
    } finally {
      loadingSessions = false;
    }
  };

  const loadMessages = async (id: string, opts?: { scrollToBottom?: boolean; silent?: boolean }) => {
    const shouldShowLoader = !opts?.silent;
    if (shouldShowLoader) loadingMessages = true;
    errorMsg = null;
    try {
      const res = await apiGet<{ sessionId: string; messages: ChatMessage[] }>(`/chat/sessions/${id}/messages`);
      const raw = res.messages ?? [];
      messages = raw.map((m) => ({
        ...m,
        _streamId: m.id,
        _localStatus: m.content ? 'completed' : undefined
      }));
      if (opts?.scrollToBottom !== false) scheduleScrollToBottom({ force: true });

      // Hydratation batch (Option C) en arrière-plan: ne doit pas bloquer l'affichage des messages
      initialEventsByMessageId = new Map();
      streamDetailsLoading = true;
      void (async () => {
        try {
          const hist = await apiGet<{ sessionId: string; streams: Array<{ messageId: string; events: StreamEvent[] }> }>(
            `/chat/sessions/${id}/stream-events?limitMessages=20&limitEvents=2000`
          );
          if (sessionId !== id) return;
          const map = new Map<string, StreamEvent[]>();
          for (const item of (hist as any)?.streams ?? []) {
            const mid = String(item?.messageId ?? '').trim();
            if (!mid) continue;
            map.set(mid, (item as any)?.events ?? []);
          }
          initialEventsByMessageId = map;
        } catch {
          initialEventsByMessageId = new Map();
        } finally {
          if (sessionId === id) streamDetailsLoading = false;
        }
      })();

      // Le scroll est exécuté via afterUpdate (une fois le DOM réellement rendu).
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors du chargement des messages');
    } finally {
      if (shouldShowLoader) loadingMessages = false;
    }
  };

  export const selectSession = async (id: string) => {
    sessionId = id;
    await loadMessages(id, { scrollToBottom: true });
  };

  export const newSession = () => {
    sessionId = null;
    messages = [];
    initialEventsByMessageId = new Map();
    errorMsg = null;
    scheduleScrollToBottom({ force: true });
  };

  export const deleteCurrentSession = async () => {
    if (!sessionId) return;
    if (!confirm('Supprimer cette conversation ?')) return;
    errorMsg = null;
    try {
      await apiDelete(`/chat/sessions/${sessionId}`);
      sessionId = null;
      messages = [];
      initialEventsByMessageId = new Map();
      await loadSessions();
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la suppression de la session');
    }
  };

  const handleAssistantTerminal = async (streamId: string, t: 'done' | 'error') => {
    if (terminalRefreshInFlight.has(streamId)) return;
    terminalRefreshInFlight.add(streamId);
    messages = messages.map((m) =>
      (m._streamId ?? m.id) === streamId ? { ...m, _localStatus: t === 'done' ? 'completed' : 'failed' } : m
    );
    // Silent refresh: keep the message list mounted to avoid a visible "blink" at stream completion.
    if (sessionId) await loadMessages(sessionId, { scrollToBottom: true, silent: true });
    scheduleScrollToBottom({ force: true });
    // Laisser le temps à la UI de se stabiliser avant d'autoriser un autre refresh (évite boucles sur replay).
    await tick();
    terminalRefreshInFlight.delete(streamId);
  };

  const pollJobUntilTerminal = async (jobId: string, streamId: string, opts?: { timeoutMs?: number }) => {
    if (!jobId || !streamId) return;
    if (jobPollInFlight.has(jobId)) return;
    jobPollInFlight.add(jobId);
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const startedAt = Date.now();
    try {
      // Petit délai: si SSE marche, on évite de poller tout de suite
      await new Promise((r) => setTimeout(r, 750));

      while (Date.now() - startedAt < timeoutMs) {
        // Si entre-temps le message a été hydraté (contenu final) ou marqué terminal, on stop
        const current = messages.find((m) => (m._streamId ?? m.id) === streamId);
        if (!current) return;
        if (current.content && current.content.trim().length > 0) return;
        if (current._localStatus === 'completed' || current._localStatus === 'failed') return;

        // Queue: endpoint user-scopé
        const job = await apiGet<{ status?: string }>(`/queue/jobs/${encodeURIComponent(jobId)}`);
        const status = String((job as any)?.status ?? 'unknown');

        if (status === 'completed') {
          await handleAssistantTerminal(streamId, 'done');
          return;
        }
        if (status === 'failed') {
          await handleAssistantTerminal(streamId, 'error');
          return;
        }
        // pending/processing
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch {
      // ignore (fallback best-effort)
    } finally {
      jobPollInFlight.delete(jobId);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    sending = true;
    errorMsg = null;
    try {
    // Détecter le contexte depuis la route
    updateContextFromRoute();
    markCurrentContextUsed();
      const activeContexts = getActiveContexts();
      const focusContext = activeContexts[0];

      // Construire le payload avec le contexte si disponible
      const payload: {
        sessionId?: string;
        content: string;
        primaryContextType?: string;
        primaryContextId?: string;
        contexts?: Array<{ contextType: string; contextId: string }>;
        tools?: string[];
        workspace_id?: string;
      } = {
        content: text
      };

      if (sessionId) {
        payload.sessionId = sessionId;
      }

      if (focusContext?.contextType && focusContext.contextId) {
        payload.primaryContextType = focusContext.contextType;
        payload.primaryContextId = focusContext.contextId;
      }

      if (activeContexts.length > 0) {
        payload.contexts = activeContexts
          .filter((c) => c.contextType && c.contextId)
          .map((c) => ({ contextType: c.contextType, contextId: c.contextId ?? '' }));
      }

      const enabledTools = getEnabledToolIds();
      if (enabledTools.length > 0) payload.tools = enabledTools;

      const res = await apiPost<{
        sessionId: string;
        userMessageId: string;
        assistantMessageId: string;
        streamId: string;
        jobId: string;
      }>('/chat/messages', payload);

      input = '';
      composerIsMultiline = false;
      updateComposerHeight();
      if (res.sessionId && res.sessionId !== sessionId) {
        sessionId = res.sessionId;
        void loadSessions();
      }

      const nowIso = new Date().toISOString();
      const userMsg: LocalMessage = {
        id: res.userMessageId,
        sessionId: res.sessionId,
        role: 'user',
        content: text,
        createdAt: nowIso,
        _localStatus: 'completed'
      };
      const assistantMsg: LocalMessage = {
        id: res.assistantMessageId,
        sessionId: res.sessionId,
        role: 'assistant',
        content: null,
        createdAt: nowIso,
        _localStatus: 'processing',
        _streamId: res.streamId
      };
      messages = [...messages, userMsg, assistantMsg];
      followBottom = true;
      scheduleScrollToBottom({ force: true });

      // Fallback: si SSE rate les events (connection pas prête), on rattrape via polling queue.
      // On évite ainsi un "Préparation…" bloqué alors que le job est déjà terminé.
      void pollJobUntilTerminal(res.jobId, assistantMsg._streamId ?? assistantMsg.id, { timeoutMs: 90_000 });
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de l’envoi');
    } finally {
      sending = false;
    }
  };

  const setFeedback = async (messageId: string, next: 'up' | 'down' | 'clear') => {
    errorMsg = null;
    try {
      await apiPost(`/chat/messages/${encodeURIComponent(messageId)}/feedback`, { vote: next });
      const voteValue = next === 'clear' ? null : (next === 'up' ? 1 : -1);
      messages = messages.map((m) => (m.id === messageId ? { ...m, feedbackVote: voteValue } : m));
    } catch (e) {
      errorMsg = formatApiError(e, 'Erreur lors de la mise à jour du feedback');
    }
  };

  $: {
    const key = sessionId ? `chat_session:${sessionId}` : '';
    if (key && key !== sessionDocsKey) {
      sessionDocsKey = key;
      sessionDocs = [];
      void loadSessionDocs();
    }
    if (!key && sessionDocsKey) {
      sessionDocsKey = '';
      sessionDocs = [];
    }
  }

  onMount(async () => {
    await loadSessions();
    if (sessionId && messages.length === 0) {
      await loadMessages(sessionId, { scrollToBottom: true });
    }
    updateComposerHeight();
    ensureDefaultToolToggles();
    loadPrefs(sessionId);
    updateContextFromRoute();
    handleDocumentClick = (event: MouseEvent) => {
      if (!showComposerMenu) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (composerMenuRef?.contains(target)) return;
      if (composerMenuButtonRef?.contains(target)) return;
      showComposerMenu = false;
    };
    if (handleDocumentClick) {
      document.addEventListener('click', handleDocumentClick);
    }
    sessionDocsSseKey = `chat-documents:${Math.random().toString(36).slice(2)}`;
    streamHub.setJobUpdates(sessionDocsSseKey, (ev: StreamHubEvent) => {
      if (ev.type !== 'job_update' || !('jobId' in ev)) return;
      const jobIds = new Set(sessionDocs.map((d) => d.job_id).filter(Boolean) as string[]);
      if (jobIds.size === 0) return;
      if (!jobIds.has(ev.jobId)) return;
      if (sessionDocsReloadTimer) clearTimeout(sessionDocsReloadTimer);
      sessionDocsReloadTimer = setTimeout(() => {
        void loadSessionDocs();
      }, 150);
    });
    sessionTitlesSseKey = `chat-sessions:${Math.random().toString(36).slice(2)}`;
    streamHub.set(sessionTitlesSseKey, (ev: StreamHubEvent) => {
      if (ev.type !== 'workspace_update') return;
      const action = (ev as any)?.data?.action;
      if (action !== 'chat_session_title_updated') return;
      const sessionIdUpdated = String((ev as any)?.data?.sessionId ?? '').trim();
      const title = String((ev as any)?.data?.title ?? '').trim();
      if (!sessionIdUpdated || !title) return;
      if (!sessions?.length) return;
      sessions = sessions.map((s) => (s.id === sessionIdUpdated ? { ...s, title } : s));
    });
  });

  $: if (sessionId && prefsKey !== getPrefsKey(sessionId)) {
    loadPrefs(sessionId);
    ensureDefaultToolToggles();
    refreshContextLabels();
  }

  $: if (!sessionId && prefsKey !== getPrefsKey(null)) {
    loadPrefs(null);
    ensureDefaultToolToggles();
    refreshContextLabels();
  }

  let lastPath = '';
  $: if ($page?.url?.pathname && $page.url.pathname !== lastPath) {
    lastPath = $page.url.pathname;
    updateContextFromRoute();
  }

  $: if ($organizationsStore || $foldersStore || $useCasesStore) {
    refreshContextLabels();
  }

  onDestroy(() => {
    if (sessionDocsReloadTimer) clearTimeout(sessionDocsReloadTimer);
    sessionDocsReloadTimer = null;
    if (sessionDocsSseKey) streamHub.delete(sessionDocsSseKey);
    sessionDocsSseKey = '';
    if (sessionTitlesSseKey) streamHub.delete(sessionTitlesSseKey);
    sessionTitlesSseKey = '';
    if (handleDocumentClick) {
      document.removeEventListener('click', handleDocumentClick);
    }
  });
</script>

<div class="flex flex-col h-full" bind:this={panelEl}>

  <div
    class="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 slim-scroll"
    style="scrollbar-gutter: stable;"
    bind:this={listEl}
    on:scroll={onListScroll}
  >
    {#if errorMsg}
      <div class="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
        {errorMsg}
      </div>
    {/if}
    {#if loadingMessages}
      <div class="text-xs text-slate-500">Chargement…</div>
    {:else if messages.length === 0}
      <div class="text-xs text-slate-500">Aucun message. Écris un message pour démarrer.</div>
    {:else}
      {#each messages as m (m.id)}
        {#if m.role === 'user'}
          <div class="flex flex-col items-end group">
            <div class="max-w-[85%] rounded bg-slate-900 text-white text-xs px-3 py-2 break-words w-full userMarkdown">
              {#if editingMessageId === m.id}
                <div class="space-y-2">
                  <EditableInput
                    markdown={true}
                    bind:value={editingContent}
                    placeholder="Modifier le message…"
                  />
                  <div class="flex items-center justify-end gap-2 text-[11px]">
                    <button
                      class="rounded border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800"
                      type="button"
                      on:click={cancelEditMessage}
                    >
                      Annuler
                    </button>
                    <button
                      class="rounded bg-white text-slate-900 px-2 py-0.5 hover:bg-slate-200"
                      type="button"
                      on:click={() => void saveEditMessage(m.id)}
                    >
                      Envoyer
                    </button>
                  </div>
                </div>
              {:else}
                <Streamdown content={m.content ?? ''} />
              {/if}
            </div>
            <div class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
              on:click={async () => {
                const text = m.content ?? '';
                const ok = await copyToClipboard(text, renderMarkdownWithRefs(text));
                if (ok) markCopied(m.id);
              }}
              type="button"
              aria-label="Copier"
              title="Copier"
            >
              {#if isCopied(m.id)}
                <Check class="w-3.5 h-3.5 text-slate-900" />
              {:else}
                <Copy class="w-3.5 h-3.5" />
              {/if}
            </button>
            <button
              class="inline-flex items-center rounded px-1.5 py-0.5 hover:bg-slate-100"
              on:click={() => startEditMessage(m)}
              type="button"
              aria-label="Modifier"
              title="Modifier"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
            </div>
          </div>
        {:else if m.role === 'assistant'}
          {@const sid = m._streamId ?? m.id}
          {@const initEvents = initialEventsByMessageId.get(sid)}
          {@const showDetailWaiter = !!m.content && streamDetailsLoading && initEvents === undefined}
          {@const isUp = m.feedbackVote === 1}
          {@const isDown = m.feedbackVote === -1}
          {@const isTerminal = (m._localStatus ?? (m.content ? 'completed' : 'processing')) === 'completed'}
          <div class="flex justify-start group">
            <div class="max-w-[85%] w-full">
              <StreamMessage
                variant="chat"
                streamId={sid}
                status={m._localStatus ?? (m.content ? 'completed' : 'processing')}
                finalContent={m.content ?? null}
                historySource="stream"
                initialEvents={initEvents}
                historyPending={showDetailWaiter}
                onStreamEvent={() => scheduleScrollToBottom()}
                onTerminal={(t) => void handleAssistantTerminal(sid, t)}
              />
              {#if isTerminal}
                <div class="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    on:click={async () => {
                      const text = m.content ?? '';
                      const ok = await copyToClipboard(text, renderMarkdownWithRefs(text));
                      if (ok) markCopied(m.id);
                    }}
                    type="button"
                    aria-label="Copier"
                    title="Copier"
                  >
                    {#if isCopied(m.id)}
                      <Check class="w-3.5 h-3.5 text-slate-900" />
                    {:else}
                      <Copy class="w-3.5 h-3.5" />
                    {/if}
                  </button>
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    on:click={() => void retryFromAssistant(m.id)}
                    type="button"
                    aria-label="Réessayer"
                    title="Réessayer"
                  >
                    <RotateCcw class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    class:text-slate-900={isUp}
                    class:bg-slate-100={isUp}
                    on:click={() => void setFeedback(m.id, isUp ? 'clear' : 'up')}
                    type="button"
                    aria-label="Utile"
                    title="Utile"
                  >
                    <ThumbsUp class="w-3.5 h-3.5" fill={isUp ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    class:text-slate-900={isDown}
                    class:bg-slate-100={isDown}
                    on:click={() => void setFeedback(m.id, isDown ? 'clear' : 'down')}
                    type="button"
                    aria-label="Pas utile"
                    title="Pas utile"
                  >
                    <ThumbsDown class="w-3.5 h-3.5" fill={isDown ? 'currentColor' : 'none'} />
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="p-3 border-t border-slate-200">
    <div class="relative flex items-center gap-2">
      <button
        class="rounded border border-slate-300 bg-white text-slate-600 w-10 h-10 flex items-center justify-center hover:bg-slate-50"
        aria-label="Ouvrir le menu"
        title="Ouvrir le menu"
        type="button"
        bind:this={composerMenuButtonRef}
        on:click={() => (showComposerMenu = !showComposerMenu)}
      >
        <Plus class="w-4 h-4" />
      </button>
      {#if showComposerMenu}
        <div
          class="absolute bottom-12 left-0 z-20 w-80 rounded-lg border border-slate-200 bg-white shadow-lg p-3 space-y-3"
          bind:this={composerMenuRef}
        >
          <label
            class={"flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50 " +
              (sessionDocsUploading ? 'opacity-50 pointer-events-none' : '')}
            aria-label="Ajouter un fichier"
            title="Ajouter un fichier"
          >
            <input
              class="hidden"
              type="file"
              on:change={onPickSessionDoc}
              disabled={sessionDocsUploading}
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/markdown,text/plain,application/json"
            />
            <Paperclip class="w-4 h-4" />
            <span>Ajouter un fichier</span>
          </label>
          <div class="border-t border-slate-100 pt-2"></div>
          <div class="text-xs font-semibold text-slate-600">Contexte(s)</div>
          {#if contextEntries.length === 0}
            <div class="text-[11px] text-slate-500">Aucun contexte actif.</div>
          {:else}
            <div class="space-y-1 max-h-40 overflow-auto slim-scroll">
              {#each sortedContexts as c (c.contextType + ':' + c.contextId)}
                <button
                  class={`flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50 ${
                    c.active ? 'text-slate-900' : 'text-slate-400'
                  }`}
                  type="button"
                  on:click={() => toggleContextActive(c)}
                >
                  <svelte:component
                    this={getContextIcon(c.contextType)}
                    class="w-4 h-4"
                  />
                  <span class="truncate max-w-[220px]">{c.label}</span>
                </button>
              {/each}
            </div>
          {/if}

          <div class="border-t border-slate-100 pt-2">
            <div class="text-xs font-semibold text-slate-600 mb-1">Outils</div>
            <div class="space-y-1 max-h-48 overflow-auto slim-scroll">
              {#each TOOL_TOGGLES as t (t.id)}
                <button
                  class="flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                  type="button"
                  on:click={() => toggleTool(t.id)}
                >
                  <svelte:component
                    this={t.icon}
                    class={`w-4 h-4 ${toolEnabledById[t.id] !== false ? 'text-slate-900' : 'text-slate-400'}`}
                  />
                  <span class="truncate">{t.label}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
      <div
        class="flex-1 min-w-0 rounded border border-slate-300 bg-white px-3 py-2 text-xs composer-rich slim-scroll overflow-y-auto overflow-x-hidden"
        class:composer-single-line={!composerIsMultiline}
        style={`max-height: ${composerMaxHeight}px; min-height: ${COMPOSER_BASE_HEIGHT}px;`}
        bind:this={composerEl}
        role="textbox"
        aria-label="Composer"
        tabindex="0"
        on:keydown={handleKeyDown}
      >
        {#if sessionDocsError}
          <div class="mb-2 rounded bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700">
            {sessionDocsError}
          </div>
        {/if}
        {#if sessionDocs.length > 0}
          <div class="mb-2 flex flex-wrap gap-2">
            {#each sessionDocs as doc (doc.id)}
              <div class="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                <div class="max-w-[220px] truncate">{doc.filename}</div>
                <span class="text-slate-400">· {sessionDocStatusLabel(doc.status)}</span>
                <button
                  class="rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-white"
                  type="button"
                  aria-label="Supprimer le document"
                  title="Supprimer"
                  on:click={() => void removeSessionDoc(doc)}
                >
                  <X class="w-3 h-3" />
                </button>
              </div>
            {/each}
          </div>
        {/if}
        <EditableInput
          markdown={true}
          bind:value={input}
          placeholder="Écrire un message…"
          on:change={handleComposerChange}
        />
      </div>
      <button
        class="rounded bg-blue-600 hover:bg-blue-700 text-white w-10 h-10 flex items-center justify-center disabled:opacity-60"
        on:click={() => void sendMessage()}
        disabled={sending || input.trim().length === 0}
        type="button"
        aria-label="Envoyer"
      >
        <Send class="w-4 h-4" />
      </button>
    </div>
  </div>
</div>

<style>
  .composer-rich :global(.markdown-input-wrapper),
  .userMarkdown :global(.markdown-input-wrapper) {
    padding-left: 0;
    margin-left: 0;
    border-left: 0;
  }

  .composer-rich :global(.markdown-input-wrapper:hover),
  .userMarkdown :global(.markdown-input-wrapper:hover) {
    border-left-color: transparent;
    background-color: transparent;
  }

  .composer-rich :global(.markdown-wrapper) {
    max-height: 100%;
    overflow: hidden;
  }

  .composer-rich :global(.ProseMirror) {
    outline: none;
  }

  .composer-single-line :global(.ProseMirror) {
    line-height: 1.25rem;
  }

  .userMarkdown :global(.markdown-wrapper .text-slate-700),
  .userMarkdown :global(.markdown-wrapper .text-slate-700 *) {
    color: #fff;
  }
</style>
