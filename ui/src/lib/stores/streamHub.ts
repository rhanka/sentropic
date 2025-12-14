import { API_BASE_URL } from '$lib/config';
import { get } from 'svelte/store';
import { isAuthenticated } from '$lib/stores/session';

export type StreamHubEvent =
  | { type: 'job_update'; jobId: string; data: any }
  | { type: 'company_update'; companyId: string; data: any }
  | { type: 'folder_update'; folderId: string; data: any }
  | { type: 'usecase_update'; useCaseId: string; data: any }
  | { type: string; streamId: string; sequence: number; data: any };

type Subscription = {
  onEvent: (event: StreamHubEvent) => void;
  streamId?: string;
  onlyType?: 'job_update' | 'company_update';
};

const EVENT_TYPES = [
  // job/company
  'job_update',
  'company_update',
  'folder_update',
  'usecase_update',
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Cache des events vus (pour "replay" à l'inscription, sans reconnect)
  private lastJobEventById = new Map<string, StreamHubEvent>();
  private lastCompanyEventById = new Map<string, StreamHubEvent>();
  private lastFolderEventById = new Map<string, StreamHubEvent>();
  private lastUseCaseEventById = new Map<string, StreamHubEvent>();
  // Historique compact par stream_id (on garde surtout les tool calls + un état courant reasoning/content)
  private streamHistoryById = new Map<string, StreamHubEvent[]>();
  private maxStreamIds = 50;
  private maxEventsPerStream = 50;

  set(key: string, onEvent: (event: StreamHubEvent) => void) {
    this.subs.set(key, { onEvent });
    // Replay immédiat du cache vers ce subscriber
    try {
      for (const ev of this.lastJobEventById.values()) onEvent(ev);
      for (const ev of this.lastCompanyEventById.values()) onEvent(ev);
      for (const ev of this.lastFolderEventById.values()) onEvent(ev);
      for (const ev of this.lastUseCaseEventById.values()) onEvent(ev);
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
  }

  private dispatch(event: StreamHubEvent) {
    // Mettre à jour le cache avant d'envoyer aux subscribers
    if ((event as any).type === 'job_update') {
      const e = event as any;
      if (e.jobId) this.lastJobEventById.set(e.jobId, event);
    } else if ((event as any).type === 'company_update') {
      const e = event as any;
      if (e.companyId) this.lastCompanyEventById.set(e.companyId, event);
    } else if ((event as any).type === 'folder_update') {
      const e = event as any;
      if (e.folderId) this.lastFolderEventById.set(e.folderId, event);
    } else if ((event as any).type === 'usecase_update') {
      const e = event as any;
      if (e.useCaseId) this.lastUseCaseEventById.set(e.useCaseId, event);
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
    if (!get(isAuthenticated)) {
      this.close();
      return;
    }

    // Si aucun subscriber, on ferme la connexion
    if (this.subs.size === 0) {
      this.close();
      return;
    }

    const url = `${API_BASE_URL}/streams/sse`;
    if (this.es) return;

    this.close();
    this.es = new EventSource(url, { withCredentials: true } as any);

    const handle = (type: string, raw: MessageEvent) => {
      try {
        const parsed = JSON.parse(raw.data);

        if (type === 'job_update') {
          this.dispatch({ type, jobId: parsed.jobId, data: parsed.data });
          return;
        }
        if (type === 'company_update') {
          this.dispatch({ type, companyId: parsed.companyId, data: parsed.data });
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


