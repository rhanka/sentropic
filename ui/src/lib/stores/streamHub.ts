import { API_BASE_URL } from '$lib/config';
import { isAuthenticated } from '$lib/stores/session';
import { getScopedWorkspaceIdForUser } from '$lib/stores/workspaceScope';

function getStoreValue<T>(store: { subscribe: (run: (v: T) => void) => () => void }): T {
  let value!: T;
  const unsub = store.subscribe((v: T) => {
    value = v;
  });
  unsub();
  return value;
}

export type StreamHubEvent =
  | { type: 'job_update'; jobId: string; data: any }
  | { type: 'organization_update'; organizationId: string; data: any }
  | { type: 'folder_update'; folderId: string; data: any }
  | { type: 'usecase_update'; useCaseId: string; data: any }
  | { type: 'lock_update'; objectType: string; objectId: string; data: any }
  | { type: 'presence_update'; objectType: string; objectId: string; data: any }
  | { type: 'workspace_update'; workspaceId: string; data: any }
  | { type: 'workspace_membership_update'; workspaceId: string; userId?: string; data: any }
  | { type: 'ping'; data: any }
  | { type: string; streamId: string; sequence: number; data: any };

type Subscription = {
  onEvent: (event: StreamHubEvent) => void;
  streamId?: string;
  onlyType?: 'job_update' | 'organization_update';
};

const EVENT_TYPES = [
  // job/organization
  'job_update',
  'organization_update',
  'folder_update',
  'usecase_update',
  'lock_update',
  'presence_update',
  'workspace_update',
  'workspace_membership_update',
  // stream events (normalized)
  'status',
  'reasoning_delta',
  'tool_call_start',
  'tool_call_delta',
  'tool_call_result',
  'content_delta',
  'error',
  'done',
  // keepalive
  'ping'
] as const;

class StreamHub {
  private subs = new Map<string, Subscription>();
  private es: EventSource | null = null;
  private currentUrl: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Cache des events vus (pour "replay" à l'inscription, sans reconnect)
  private lastJobEventById = new Map<string, StreamHubEvent>();
  private lastOrganizationEventById = new Map<string, StreamHubEvent>();
  private lastFolderEventById = new Map<string, StreamHubEvent>();
  private lastUseCaseEventById = new Map<string, StreamHubEvent>();
  private lastLockEventByKey = new Map<string, StreamHubEvent>();
  // Historique compact par stream_id (on garde surtout les tool calls + un état courant reasoning/content)
  private streamHistoryById = new Map<string, StreamHubEvent[]>();
  private maxStreamIds = 50;
  private maxEventsPerStream = 50;

  /**
   * Clear all cached/replayed events and close the current SSE connection.
   * Useful on logout / user switch to prevent cross-account "ghost" updates.
   */
  reset() {
    this.lastJobEventById.clear();
    this.lastOrganizationEventById.clear();
    this.lastFolderEventById.clear();
    this.lastUseCaseEventById.clear();
    this.lastLockEventByKey.clear();
    this.streamHistoryById.clear();
    this.close();
    this.scheduleReconnect();
  }

  /**
   * Clear caches without closing SSE.
   * Useful when switching UI scope while keeping a single SSE connection stable.
   */
  clearCaches() {
    this.lastJobEventById.clear();
    this.lastOrganizationEventById.clear();
    this.lastFolderEventById.clear();
    this.lastUseCaseEventById.clear();
    this.lastLockEventByKey.clear();
    this.streamHistoryById.clear();
  }

  set(key: string, onEvent: (event: StreamHubEvent) => void) {
    this.subs.set(key, { onEvent });
    // Replay immédiat du cache vers ce subscriber
    try {
      for (const ev of this.lastJobEventById.values()) onEvent(ev);
      for (const ev of this.lastOrganizationEventById.values()) onEvent(ev);
      for (const ev of this.lastFolderEventById.values()) onEvent(ev);
      for (const ev of this.lastUseCaseEventById.values()) onEvent(ev);
      for (const ev of this.lastLockEventByKey.values()) onEvent(ev);
      for (const events of this.streamHistoryById.values()) {
        for (const ev of events) onEvent(ev);
      }
    } catch {
      // ignore
    }
    this.scheduleReconnect();
  }

  /**
   * Subscribe uniquement aux job_update (et rejoue uniquement le dernier snapshot par job).
   * Permet de garder une UI "vivante" même quand certains panneaux sont repliés.
   */
  setJobUpdates(key: string, onEvent: (event: StreamHubEvent) => void) {
    this.subs.set(key, { onEvent, onlyType: 'job_update' });
    try {
      for (const ev of this.lastJobEventById.values()) onEvent(ev);
    } catch {
      // ignore
    }
    this.scheduleReconnect();
  }

  /**
   * Subscribe uniquement aux events d'un streamId (et rejoue uniquement l'historique de ce stream).
   * Utile pour des composants "StreamMessage" instanciés N fois (évite de rejouer tout le cache à chaque fois).
   */
  setStream(key: string, streamId: string, onEvent: (event: StreamHubEvent) => void) {
    this.subs.set(key, { onEvent, streamId });
    try {
      const events = this.streamHistoryById.get(streamId) ?? [];
      for (const ev of events) onEvent(ev);
    } catch {
      // ignore
    }
    this.scheduleReconnect();
  }

  delete(key: string) {
    this.subs.delete(key);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, 150);
  }

  private close() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.currentUrl = null;
  }

  private dispatch(event: StreamHubEvent) {
    // Mettre à jour le cache avant d'envoyer aux subscribers
    if ((event as any).type === 'job_update') {
      const e = event as any;
      if (e.jobId) this.lastJobEventById.set(e.jobId, event);
    } else if ((event as any).type === 'organization_update') {
      const e = event as any;
      if (e.organizationId) this.lastOrganizationEventById.set(e.organizationId, event);
    } else if ((event as any).type === 'folder_update') {
      const e = event as any;
      if (e.folderId) this.lastFolderEventById.set(e.folderId, event);
    } else if ((event as any).type === 'usecase_update') {
      const e = event as any;
      if (e.useCaseId) this.lastUseCaseEventById.set(e.useCaseId, event);
    } else if ((event as any).type === 'lock_update') {
      const e = event as any;
      if (e.objectType && e.objectId) this.lastLockEventByKey.set(`${e.objectType}:${e.objectId}`, event);
    } else {
      const e = event as any;
      if (e.streamId) {
        const streamId: string = e.streamId;
        const type: string = e.type;
        const prev = this.streamHistoryById.get(streamId) ?? [];
        const last = prev[prev.length - 1] as any;

        const isTextDelta = type === 'reasoning_delta' || type === 'content_delta';
        const isToolArgsDelta = type === 'tool_call_delta';

        const sameTextDeltaKind =
          isTextDelta &&
          last &&
          typeof last.type === 'string' &&
          last.type === type &&
          last.streamId === streamId;

        const sameToolArgsDelta =
          isToolArgsDelta &&
          last &&
          typeof last.type === 'string' &&
          last.type === type &&
          last.streamId === streamId &&
          last?.data?.tool_call_id &&
          last.data.tool_call_id === e?.data?.tool_call_id;

        let next: StreamHubEvent[];
        if (sameTextDeltaKind || sameToolArgsDelta) {
          // On agrège les deltas (on garde l'intégralité du texte) sans stocker une entrée par chunk.
          // => les abonnés tardifs reçoivent un delta déjà cumulé.
          const prevDelta = String(last?.data?.delta ?? '');
          const addDelta = String(e?.data?.delta ?? '');
          const merged = { ...event, data: { ...(e?.data ?? {}), delta: prevDelta + addDelta } } as StreamHubEvent;
          next = [...prev];
          next[next.length - 1] = merged;
        } else {
          // dédup consécutif strict
          if (last && last.type === type && last.streamId === streamId) {
            next = [...prev];
            next[next.length - 1] = event;
          } else {
            next = [...prev, event];
          }
        }

        if (next.length > this.maxEventsPerStream) next = next.slice(-this.maxEventsPerStream);
        this.streamHistoryById.set(streamId, next);

        // limiter le nombre de streamIds (LRU simple)
        if (this.streamHistoryById.size > this.maxStreamIds) {
          const firstKey = this.streamHistoryById.keys().next().value;
          if (firstKey) this.streamHistoryById.delete(firstKey);
        }
      }
    }

    for (const sub of this.subs.values()) {
      try {
        if (sub.onlyType && (event as any)?.type !== sub.onlyType) continue;
        // filtre stream-only
        if (sub.streamId) {
          const e = event as any;
          if (e?.streamId !== sub.streamId) continue;
        }
        sub.onEvent(event);
      } catch {
        // ignore
      }
    }
  }

  private async ensureConnected() {
    // pas d'auth => pas de SSE
    if (!getStoreValue(isAuthenticated)) {
      this.close();
      return;
    }

    // Si aucun subscriber, on ferme la connexion
    if (this.subs.size === 0) {
      this.close();
      return;
    }

    // IMPORTANT:
    // `API_BASE_URL` can be relative in production (e.g. `/api/v1` when the UI is served by Nginx
    // and proxies `/api/v1/*` to the API). `new URL('/api/v1/...')` throws in browsers unless a base is provided.
    // Using `window.location.origin` as base aligns SSE URL resolution with how `fetch()` handles relative URLs.
    const urlObj = new URL(`${API_BASE_URL}/streams/sse`, window.location.origin);
    const scoped = getScopedWorkspaceIdForUser();
    if (scoped) urlObj.searchParams.set('workspace_id', scoped);
    const url = urlObj.toString();
    if (this.es && this.currentUrl === url) return;

    this.close();
    this.es = new EventSource(url, { withCredentials: true } as any);
    this.currentUrl = url;

    const handle = (type: string, raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data);

        if (type === 'job_update') {
          this.dispatch({ type, jobId: parsed.jobId, data: parsed.data });
          return;
        }
        if (type === 'organization_update') {
          this.dispatch({ type, organizationId: parsed.organizationId, data: parsed.data });
          return;
        }
        if (type === 'folder_update') {
          this.dispatch({ type, folderId: parsed.folderId, data: parsed.data });
          return;
        }
        if (type === 'usecase_update') {
          this.dispatch({ type, useCaseId: parsed.useCaseId, data: parsed.data });
          return;
        }
        if (type === 'lock_update') {
          this.dispatch({ type, objectType: parsed.objectType, objectId: parsed.objectId, data: parsed.data });
          return;
        }
        if (type === 'presence_update') {
          this.dispatch({ type, objectType: parsed.objectType, objectId: parsed.objectId, data: parsed.data });
          return;
        }
        if (type === 'workspace_update') {
          this.dispatch({ type, workspaceId: parsed.workspaceId, data: parsed.data });
          return;
        }
        if (type === 'workspace_membership_update') {
          this.dispatch({ type, workspaceId: parsed.workspaceId, userId: parsed.userId, data: parsed.data });
          return;
        }
        if (type === 'ping') {
          this.dispatch({ type, data: parsed });
          return;
        }

        // stream event normalisé
        const streamId: string = parsed.streamId;
        const sequence: number = parsed.sequence;
        const data: any = parsed.data ?? {};
        if (streamId && Number.isFinite(sequence)) {
          this.dispatch({ type, streamId, sequence, data });
        }
      } catch {
        // ignore
      }
    };

    for (const t of EVENT_TYPES) {
      this.es.addEventListener(t, (ev) => handle(t, ev as MessageEvent));
    }

    // si ça casse, EventSource reconnecte; on force aussi une reconnexion si l’URL a changé depuis
    this.es.onerror = () => {
      // noop
    };
  }
}

export const streamHub = new StreamHub();


