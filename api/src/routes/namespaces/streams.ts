import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { applyStreamsAuthorFence } from './streams-cutover';
import type {
  StreamNotification,
  StreamPrincipal,
  StreamsNamespacePorts,
} from './streams-ports';
import { createProductStreamsPorts } from './streams-product-ports';

export const createStreamsTransportRouter = (ports: StreamsNamespacePorts): Hono => {
const streamsRouter = new Hono();

type LockObjectType = 'organization' | 'folder' | 'initiative';

const sseConnectionsByUser = new Map<string, number>();


function registerSseConnection(userId: string): () => Promise<void> {
  const current = sseConnectionsByUser.get(userId) ?? 0;
  sseConnectionsByUser.set(userId, current + 1);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const next = (sseConnectionsByUser.get(userId) ?? 1) - 1;
    if (next <= 0) {
      sseConnectionsByUser.delete(userId);
      await ports.locks.clearForUser(userId);
      return;
    }
    sseConnectionsByUser.set(userId, next);
  };
}

const PRESENCE_OBJECT_TYPES: LockObjectType[] = ['organization', 'folder', 'initiative'];
const APP_LOCAL_STREAM_PREFIXES = ['organization_', 'folder_', 'initiative_', 'job_'];

function isChatStreamId(streamId: string): boolean {
  return !APP_LOCAL_STREAM_PREFIXES.some((prefix) => streamId.startsWith(prefix));
}

function coercePresenceObjectType(value: string): LockObjectType | null {
  return PRESENCE_OBJECT_TYPES.includes(value as LockObjectType) ? (value as LockObjectType) : null;
}

function parseStreamIds(url: URL): string[] {
  // support: ?streamIds=a&streamIds=b  (preferred)
  // fallback: ?streamIds=a,b
  const repeated = url.searchParams.getAll('streamIds').flatMap(v => (v || '').split(','));
  return [...new Set(repeated.map(s => s.trim()).filter(Boolean))];
}

function parseJobIds(url: URL): string[] {
  const repeated = url.searchParams.getAll('jobIds').flatMap(v => (v || '').split(','));
  return [...new Set(repeated.map(s => s.trim()).filter(Boolean))];
}

function parseOrganizationIds(url: URL): string[] {
  const repeated = url.searchParams.getAll('organizationIds').flatMap(v => (v || '').split(','));
  return [...new Set(repeated.map(s => s.trim()).filter(Boolean))];
}

function parseCursor(cursor?: string | null): Record<string, number> {
  if (!cursor) return {};
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    // fallback: allow raw json (non-encodé) en dev
    try {
      const obj = JSON.parse(cursor);
      if (!obj || typeof obj !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    } catch {
      return {};
    }
  }
}

function sseEvent(event: { eventType: string; streamId: string; sequence: number; data: unknown }): string {
  const { eventType, streamId, sequence, data } = event;
  const payload = JSON.stringify({ streamId, sequence, data });
  // SSE format
  return `event: ${eventType}\nid: ${streamId}:${sequence}\ndata: ${payload}\n\n`;
}

function sseJobEvent(jobId: string, data: unknown): string {
  const payload = JSON.stringify({ jobId, data });
  return `event: job_update\nid: job:${jobId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseOrganizationEvent(organizationId: string, data: unknown): string {
  const payload = JSON.stringify({ organizationId, data });
  return `event: organization_update\nid: organization:${organizationId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseFolderEvent(folderId: string, data: unknown): string {
  const payload = JSON.stringify({ folderId, data });
  return `event: folder_update\nid: folder:${folderId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseInitiativeEvent(initiativeId: string, data: unknown): string {
  // Client streamHub expects event type "usecase_update" with "useCaseId" field
  const payload = JSON.stringify({ useCaseId: initiativeId, data });
  return `event: usecase_update\nid: initiative:${initiativeId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseWorkspaceEvent(workspaceId: string, data: unknown): string {
  const payload = JSON.stringify({ workspaceId, data });
  return `event: workspace_update\nid: workspace:${workspaceId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseWorkspaceMembershipEvent(workspaceId: string, userId: string | null, data: unknown): string {
  const payload = JSON.stringify({ workspaceId, userId, data });
  return `event: workspace_membership_update\nid: workspace_member:${workspaceId}:${userId ?? 'unknown'}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseLockEvent(objectType: string, objectId: string, data: unknown): string {
  const payload = JSON.stringify({ objectType, objectId, data });
  return `event: lock_update\nid: lock:${objectType}:${objectId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function ssePresenceEvent(objectType: string, objectId: string, data: unknown): string {
  const payload = JSON.stringify({ objectType, objectId, data });
  return `event: presence_update\nid: presence:${objectType}:${objectId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseCommentEvent(contextType: string, contextId: string, data: unknown): string {
  const payload = JSON.stringify({ contextType, contextId, data });
  return `event: comment_update\nid: comment:${contextType}:${contextId}:${Date.now()}\ndata: ${payload}\n\n`;
}

async function resolveTargetWorkspaceId(c: Context, url: URL): Promise<string> {
  return ports.workspaces.resolveTarget({
    principal: c.get('user') as StreamPrincipal,
    requestedWorkspaceId: url.searchParams.get('workspace_id'),
  });
}

// GET /streams/active?since_minutes=360&limit=200
streamsRouter.get('/active', async (c) => {
  const sinceMinutesRaw = Number(c.req.query('since_minutes') || '360');
  const limit = Number(c.req.query('limit') || '200');

  // D2.c: clamp since_minutes to the retention floor so callers cannot request
  // events older than the purge retention window (silent post-purge truncation).
  const retentionMinutes = ports.retentionDays * 24 * 60;
  const sinceMinutes = Math.min(
    Number.isFinite(sinceMinutesRaw) ? sinceMinutesRaw : 360,
    retentionMinutes,
  );

  const streamIds = await ports.outbox.listActive({
    sinceMinutes,
    limit: Number.isFinite(limit) ? limit : 200
  });
  return c.json({ streamIds });
});

// GET /streams/sse?streamIds=a&streamIds=b&cursor=base64url(json)
streamsRouter.get('/sse', async (c) => {
  const url = new URL(c.req.url);
  const user = c.get('user') as { userId: string; role?: string; workspaceId: string };
  const targetWorkspaceId = await resolveTargetWorkspaceId(c, url);
  const releaseSseConnection = registerSseConnection(user.userId);

  const streamIds = parseStreamIds(url);
  const jobIds = parseJobIds(url);
  const organizationIds = parseOrganizationIds(url);
  const jobsScope = (url.searchParams.get('jobs') || '').trim(); // 'all' option
  const wantsAllJobs = jobsScope === 'all';
  const organizationsScope = (url.searchParams.get('organizations') || '').trim(); // 'all' option
  const wantsAllOrganizations = organizationsScope === 'all';

  // Keep a single stable SSE URL: stream events are no longer "opt-in" via streamIds.
  // If streamIds are provided, we honor them as an additional client-side filter.
  const hasStreamFilter = streamIds.length > 0;
  const wantsAllOrganizationsEffective = wantsAllOrganizations || organizationIds.length === 0;
  const wantsAllJobsEffective = wantsAllJobs || jobIds.length === 0;

  if (streamIds.length > 200) return c.json({ message: 'Trop de streamIds (max 200)' }, 400);
  if (jobIds.length > 500) return c.json({ message: 'Trop de jobIds (max 500)' }, 400);
  if (organizationIds.length > 500) return c.json({ message: 'Trop de organizationIds (max 500)' }, 400);

  // Protection: job updates sont sensibles → admin_app requis
  // With tenancy: allow all authenticated users to stream their own workspace jobs.
  const canStreamJobs = true;

  const cursor = parseCursor(url.searchParams.get('cursor'));
  const wanted = new Set(streamIds);
  const wantedJobs = new Set(jobIds);
  const wantedOrganizations = new Set(organizationIds);

  // lastSeq par stream (reprise)
  const lastSeq: Record<string, number> = {};
  for (const id of streamIds) lastSeq[id] = Number.isFinite(cursor[id]) ? cursor[id] : 0;

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const draining = new Map<string, boolean>();
      const pending = new Map<string, boolean>();
      const streamAllowedCache = new Map<string, boolean>();

      // IMPORTANT (prod stability):
      // The SSE request can be aborted at any time; we must never enqueue after the controller is closed,
      // otherwise Node's WebStreams throws ERR_INVALID_STATE and can crash the whole API process.
      let closed = false;
      const push = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Controller already closed (or stream errored). Mark as closed to prevent further writes.
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        try {
          push(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        } catch {
          // cleanup déclenché plus bas (abort)
        }
      }, 25_000);

      const isStreamAllowed = async (streamId: string): Promise<boolean> => {
        const cached = streamAllowedCache.get(streamId);
        if (cached !== undefined) return cached;

        const allowed = await (async () => {
          if (streamId.startsWith('job_')) {
            return ports.jobs.canRead({
              jobId: streamId.slice('job_'.length),
              workspaceId: targetWorkspaceId,
            });
          }
          const businessKind = streamId.startsWith('organization_')
            ? 'organization'
            : streamId.startsWith('folder_')
              ? 'folder'
              : 'initiative';
          return ports.business.canRead({
            kind: businessKind,
            id: streamId.slice(`${businessKind}_`.length),
            workspaceId: targetWorkspaceId,
          });
        })();

        streamAllowedCache.set(streamId, allowed);
        return allowed;
      };

      const drainStream = async (streamId: string) => {
        if (closed) return;
        if (hasStreamFilter && !wanted.has(streamId)) return;
        if (draining.get(streamId)) {
          pending.set(streamId, true);
          return;
        }
        draining.set(streamId, true);
        try {
          if (closed) return;
          const events = isChatStreamId(streamId)
            ? await ports.chat.read({
                streamId,
                principal: user,
                targetWorkspaceId,
                sinceSequence: lastSeq[streamId] ?? 0,
              })
            : await (async () => {
                const allowed = await isStreamAllowed(streamId);
                if (!allowed) return [];
                return ports.outbox.read({
                  streamId,
                  sinceSequence: lastSeq[streamId] ?? 0,
                });
              })();
          for (const ev of events) {
            if (closed) return;
            lastSeq[streamId] = ev.sequence;
            push(sseEvent({ eventType: ev.eventType, streamId, sequence: ev.sequence, data: ev.data }));
          }
        } finally {
          draining.set(streamId, false);
          if (pending.get(streamId)) {
            pending.set(streamId, false);
            // rattrapage supplémentaire
            void drainStream(streamId).catch(() => {});
          }
        }
      };

      const emitSingleStreamEvent = async (streamId: string, sequence: number) => {
        try {
          const row = await ports.outbox.readOne({ streamId, sequence });
          if (!row) return;
          push(sseEvent({ eventType: row.eventType, streamId: row.streamId, sequence: row.sequence, data: row.data }));
        } catch {
          // ignore
        }
      };

      const emitJobSnapshot = async (jobId: string) => {
        try {
          const job = await ports.jobs.readSnapshot({ jobId, workspaceId: targetWorkspaceId });
          if (job) push(sseJobEvent(jobId, { job }));
        } catch {
          // ignore
        }
      };

      const emitOrganizationSnapshot = async (organizationId: string) => {
        try {
          const organization = await ports.business.readOrganization({
            id: organizationId,
            workspaceId: targetWorkspaceId,
          });
          if (organization) push(sseOrganizationEvent(organizationId, { organization }));
        } catch {
          // ignore
        }
      };

      const emitFolderSnapshot = async (folderId: string) => {
        try {
          const folder = await ports.business.readFolder({
            id: folderId,
            workspaceId: targetWorkspaceId,
          });
          if (folder) push(sseFolderEvent(folderId, { folder }));
        } catch {
          // ignore
        }
      };

      const emitInitiativeSnapshot = async (initiativeId: string) => {
        try {
          const useCase = await ports.business.readInitiative({
            id: initiativeId,
            workspaceId: targetWorkspaceId,
          });
          if (useCase) push(sseInitiativeEvent(initiativeId, { useCase }));
        } catch {
          // ignore
        }
      };

      const emitLockSnapshot = async (objectType: string, objectId: string) => {
        try {
          const lock = await ports.locks.readSnapshot({
            objectType,
            objectId,
            workspaceId: targetWorkspaceId,
          });
          push(sseLockEvent(objectType, objectId, { lock }));
        } catch {
          // ignore
        }
      };

      const emitPresenceSnapshot = async (objectType: string, objectId: string, workspaceId: string) => {
        try {
          if (workspaceId !== targetWorkspaceId) return;
          const coercedType = coercePresenceObjectType(objectType);
          if (!coercedType) return;
          const snapshot = await ports.locks.readPresence({
            workspaceId,
            objectType: coercedType,
            objectId,
          });
          push(ssePresenceEvent(objectType, objectId, snapshot));
        } catch {
          // ignore
        }
      };

      const shouldEmitWorkspaceEvent = async (payload: Record<string, unknown>): Promise<boolean> => {
        return ports.workspaces.canObserve({ principal: user, payload });
      };

      // headers de "connexion"
      push(`: connected\n\n`);

      // Burst initial (sans paramétrage): pour QueueMonitor, envoyer un snapshot des jobs actifs
      // + le dernier event stream par job, afin d'avoir quelque chose à afficher immédiatement.
      if (canStreamJobs && wantsAllJobsEffective) {
        try {
          const activeJobs = await ports.jobs.listActive({
            workspaceId: targetWorkspaceId,
            limit: 50,
          });
          for (const jobId of activeJobs) {
            await emitJobSnapshot(jobId);
            // stream events are opt-in via streamIds, so we don't auto-emit job stream events here
          }
        } catch {
          // ignore
        }
      }

      // rattrapage initial uniquement si streamIds explicitement fournis
      if (hasStreamFilter) {
        for (const id of streamIds) {
          await drainStream(id);
        }
      }

      // snapshot initial pour les jobIds explicitement demandés
      if (canStreamJobs && wantedJobs.size > 0) {
        for (const id of wantedJobs) {
          await emitJobSnapshot(id);
        }
      }

      // snapshot initial pour les organizationIds explicitement demandés
      if (wantedOrganizations.size > 0) {
        for (const id of wantedOrganizations) {
          await emitOrganizationSnapshot(id);
        }
      }

      // LISTEN/NOTIFY
      let unsubscribe: (() => Promise<void>) | undefined;

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          await unsubscribe?.();
        } catch {
          // ignore
        }
        try {
          await releaseSseConnection();
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      const onNotification = (msg: StreamNotification) => {
        try {
          if (!msg.payload) return;
          const payload = JSON.parse(msg.payload) as Record<string, unknown>;
          if (msg.channel === 'stream_events') {
            const streamId = payload.stream_id;
            if (!streamId || typeof streamId !== 'string') return;
            if (hasStreamFilter && !wanted.has(streamId)) return;
            if (isChatStreamId(streamId)) {
              void drainStream(streamId).catch(() => {});
              return;
            }

            const seq = Number(payload.sequence);
            if (Number.isFinite(seq)) {
              // Fast path: emit the notified event only (no drain, no history replay).
              // IMPORTANT: if we (re)connect mid-stream, we may have missed earlier events (including 'done').
              // In that case, do a catch-up drain once to avoid "stuck" UIs.
              void (async () => {
                const allowed = await isStreamAllowed(streamId);
                if (!allowed) return;
                const prev = Number.isFinite(lastSeq[streamId]) ? (lastSeq[streamId] as number) : 0;
                if (seq <= prev) return;
                if (seq === prev + 1 && prev > 0) {
                  await emitSingleStreamEvent(streamId, seq);
                  lastSeq[streamId] = seq;
                  return;
                }
                // Gap detected (or first seen): catch up by draining from lastSeq (or 0).
                void drainStream(streamId).catch(() => {});
              })().catch(() => {});
              return;
            }

            // Fallback: if no sequence, best-effort drain
            void drainStream(streamId).catch(() => {});
          } else if (msg.channel === 'job_events') {
            const jobId = payload.job_id;
            if (!jobId || typeof jobId !== 'string') return;
            if (!canStreamJobs) return;
            if (!wantsAllJobsEffective && wantedJobs.size > 0 && !wantedJobs.has(jobId)) return;
            void emitJobSnapshot(jobId);
          } else if (msg.channel === 'organization_events') {
            const organizationId = payload.organization_id;
            if (!organizationId || typeof organizationId !== 'string') return;
            if (!wantsAllOrganizationsEffective && wantedOrganizations.size > 0 && !wantedOrganizations.has(organizationId)) return;
            void emitOrganizationSnapshot(organizationId);
          } else if (msg.channel === 'folder_events') {
            const folderId = payload.folder_id;
            if (!folderId || typeof folderId !== 'string') return;
            void emitFolderSnapshot(folderId);
          } else if (msg.channel === 'initiative_events') {
            const initiativeId = payload.initiative_id;
            if (!initiativeId || typeof initiativeId !== 'string') return;
            void emitInitiativeSnapshot(initiativeId);
          } else if (msg.channel === 'lock_events') {
            const objectType = payload.object_type;
            const objectId = payload.object_id;
            if (!objectType || typeof objectType !== 'string') return;
            if (!objectId || typeof objectId !== 'string') return;
            void emitLockSnapshot(objectType, objectId);
          } else if (msg.channel === 'presence_events') {
            const objectType = payload.object_type;
            const objectId = payload.object_id;
            const workspaceId = payload.workspace_id;
            if (!objectType || typeof objectType !== 'string') return;
            if (!objectId || typeof objectId !== 'string') return;
            if (!workspaceId || typeof workspaceId !== 'string') return;
            void emitPresenceSnapshot(objectType, objectId, workspaceId);
          } else if (msg.channel === 'workspace_events') {
            const workspaceId = payload.workspace_id;
            if (!workspaceId || typeof workspaceId !== 'string') return;
            void (async () => {
              const allowed = await shouldEmitWorkspaceEvent(payload);
              if (!allowed) return;
              const data = (payload.data ?? {}) as Record<string, unknown>;
              push(sseWorkspaceEvent(workspaceId, data));
            })().catch(() => {});
          } else if (msg.channel === 'workspace_membership_events') {
            const workspaceId = payload.workspace_id;
            if (!workspaceId || typeof workspaceId !== 'string') return;
            const targetUserId = typeof payload.user_id === 'string' ? payload.user_id : null;
            void (async () => {
              const allowed = await shouldEmitWorkspaceEvent(payload);
              if (!allowed) return;
              const data = (payload.data ?? {}) as Record<string, unknown>;
              push(sseWorkspaceMembershipEvent(workspaceId, targetUserId, data));
            })().catch(() => {});
          } else if (msg.channel === 'comment_events') {
            const workspaceId = payload.workspace_id;
            if (!workspaceId || typeof workspaceId !== 'string') return;
            const contextType = payload.context_type;
            const contextId = payload.context_id;
            if (!contextType || typeof contextType !== 'string') return;
            if (!contextId || typeof contextId !== 'string') return;
            void (async () => {
              const allowed = await ports.comments.canObserve({ principal: user, payload });
              if (!allowed) return;
              const data = (payload.data ?? {}) as Record<string, unknown>;
              push(sseCommentEvent(contextType, contextId, data));
            })().catch(() => {});
          }
        } catch {
          // ignore
        }
      };

      unsubscribe = await ports.notifications.subscribe({
        channels: [
          'job_events',
          'organization_events',
          'folder_events',
          'initiative_events',
          'stream_events',
          'lock_events',
          'presence_events',
          'workspace_events',
          'workspace_membership_events',
          'comment_events',
        ],
        onNotification,
      });

      // abort client
      c.req.raw.signal.addEventListener('abort', () => {
        void cleanup();
      });
    },
    cancel: async () => {
      // le cleanup est géré via abort; rien de plus ici
    }
  });

  // IMPORTANT:
  // Utiliser la réponse "context-aware" de Hono pour que les headers globaux
  // (notamment CORS avec credentials) soient bien appliqués.
  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');
  return c.newResponse(readable, 200);
});

return streamsRouter;
};

export const STREAM_PATHS = ['/streams/active', '/streams/sse'] as const;

export interface CreateStreamsNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly ports?: StreamsNamespacePorts;
}

export const createStreamsNamespaceModule = (
  options: CreateStreamsNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/streams',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of STREAM_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    applyStreamsAuthorFence(router, STREAM_PATHS);
    router.route('/streams', createStreamsTransportRouter(
      options.ports ?? createProductStreamsPorts(),
    ));
    return router;
  },
});

export const productStreamsModule = createStreamsNamespaceModule();
