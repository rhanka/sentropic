import { Hono, type Context } from 'hono';
import { db, pool } from '../../db/client';
import { listActiveStreamIds, readStreamEvents } from '../../services/stream-service';
import { sql } from 'drizzle-orm';
import { and, eq, gt } from 'drizzle-orm';
import type { Notification } from 'pg';
import { hydrateUseCase } from './use-cases';
import { listPresence } from '../../services/lock-presence';
import type { LockObjectType } from '../../services/lock-service';
import { getWorkspaceRole } from '../../services/workspace-access';
import {
  ADMIN_WORKSPACE_ID,
  chatMessages,
  chatSessions,
  folders,
  jobQueue,
  objectLocks,
  organizations,
  useCases,
  users
} from '../../db/schema';

export const streamsRouter = new Hono();

type StreamEventRow = { streamId: string; eventType: string; data: unknown; sequence: number };
type JobSnapshotRow = {
  id: string;
  type: string;
  data: unknown;
  status: string;
  createdAt: unknown;
  startedAt: unknown;
  completedAt: unknown;
  error: unknown;
};

const PRESENCE_OBJECT_TYPES: LockObjectType[] = ['organization', 'folder', 'usecase'];

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

function sseUseCaseEvent(useCaseId: string, data: unknown): string {
  const payload = JSON.stringify({ useCaseId, data });
  return `event: usecase_update\nid: usecase:${useCaseId}:${Date.now()}\ndata: ${payload}\n\n`;
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

function parseOrgData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function coerceMarkdownString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value
      .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return undefined;
    return items.map((s) => `- ${s}`).join('\n');
  }
  return undefined;
}

function coerceReferences(value: unknown): Array<{ title: string; url: string; excerpt?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => !!v)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : String(r.title ?? ''),
      url: typeof r.url === 'string' ? r.url : String(r.url ?? ''),
      excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined,
    }))
    .filter((r) => r.title.trim() && r.url.trim());
}

function hydrateOrganizationForSse(row: Record<string, unknown>): Record<string, unknown> {
  const data = parseOrgData(row.data);
  const legacyKpisCombined = (() => {
    const sector = coerceMarkdownString(data.kpis_sector);
    const org = coerceMarkdownString(data.kpis_org);
    const parts = [sector, org].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (!parts.length) return undefined;
    return parts.join('\n\n');
  })();

  return {
    id: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
    name: typeof row.name === 'string' ? row.name : String(row.name ?? ''),
    status: row.status ?? null,
    industry: typeof data.industry === 'string' ? data.industry : undefined,
    size: typeof data.size === 'string' ? data.size : undefined,
    products: coerceMarkdownString(data.products),
    processes: coerceMarkdownString(data.processes),
    kpis: coerceMarkdownString(data.kpis) ?? legacyKpisCombined,
    challenges: coerceMarkdownString(data.challenges),
    objectives: coerceMarkdownString(data.objectives),
    technologies: coerceMarkdownString(data.technologies),
    references: coerceReferences(data.references),
  };
}

async function resolveTargetWorkspaceId(c: Context, url: URL): Promise<string> {
  const user = c.get('user') as { userId: string; role?: string; workspaceId: string };
  const requested = url.searchParams.get('workspace_id');

  if (!requested) return user.workspaceId;
  if (user?.role !== 'admin_app') return user.workspaceId;
  if (requested === ADMIN_WORKSPACE_ID) return requested;

  const role = await getWorkspaceRole(user.userId, requested);
  if (!role) throw new Error('Workspace not accessible');
  return requested;
}

// GET /streams/events/:streamId?limit=2000&sinceSequence=123
streamsRouter.get('/events/:streamId', async (c) => {
  const streamId = c.req.param('streamId');
  const url = new URL(c.req.url);
  const limitRaw = url.searchParams.get('limit');
  const sinceRaw = url.searchParams.get('sinceSequence');

  const limit = limitRaw ? Number(limitRaw) : 2000;
  const sinceSequence = sinceRaw ? Number(sinceRaw) : undefined;

  const events = await readStreamEvents(
    streamId,
    Number.isFinite(sinceSequence as number) ? (sinceSequence as number) : undefined,
    Number.isFinite(limit) ? limit : 2000
  );

  return c.json({ streamId, events });
});

// GET /streams/active?since_minutes=360&limit=200
streamsRouter.get('/active', async (c) => {
  const sinceMinutes = Number(c.req.query('since_minutes') || '360');
  const limit = Number(c.req.query('limit') || '200');
  const streamIds = await listActiveStreamIds({
    sinceMinutes: Number.isFinite(sinceMinutes) ? sinceMinutes : 360,
    limit: Number.isFinite(limit) ? limit : 200
  });
  return c.json({ streamIds });
});

// GET /streams/sse?streamIds=a&streamIds=b&cursor=base64url(json)
streamsRouter.get('/sse', async (c) => {
  const url = new URL(c.req.url);
  const user = c.get('user') as { userId: string; role?: string; workspaceId: string };
  const targetWorkspaceId = await resolveTargetWorkspaceId(c, url);

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
          if (streamId.startsWith('organization_')) {
            const id = streamId.slice('organization_'.length);
            const [r] = await db
              .select({ id: organizations.id })
              .from(organizations)
              .where(and(eq(organizations.id, id), eq(organizations.workspaceId, targetWorkspaceId)))
              .limit(1);
            return !!r;
          }
          if (streamId.startsWith('folder_')) {
            const id = streamId.slice('folder_'.length);
            const [r] = await db
              .select({ id: folders.id })
              .from(folders)
              .where(and(eq(folders.id, id), eq(folders.workspaceId, targetWorkspaceId)))
              .limit(1);
            return !!r;
          }
          if (streamId.startsWith('usecase_')) {
            const id = streamId.slice('usecase_'.length);
            const [r] = await db
              .select({ id: useCases.id })
              .from(useCases)
              .where(and(eq(useCases.id, id), eq(useCases.workspaceId, targetWorkspaceId)))
              .limit(1);
            return !!r;
          }
          if (streamId.startsWith('job_')) {
            const id = streamId.slice('job_'.length);
            const [r] = await db
              .select({ id: jobQueue.id })
              .from(jobQueue)
              .where(and(eq(jobQueue.id, id), eq(jobQueue.workspaceId, targetWorkspaceId)))
              .limit(1);
            return !!r;
          }
          // Chat stream: streamId == assistantMessageId
          const [r] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .leftJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
            .where(and(eq(chatMessages.id, streamId), eq(chatSessions.userId, user.userId)))
            .limit(1);
          return !!r;
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
          const allowed = await isStreamAllowed(streamId);
          if (!allowed) return;

          const events = await readStreamEvents(streamId, lastSeq[streamId] ?? 0);
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
          const row = (await db.get(sql`
            SELECT stream_id AS "streamId", event_type AS "eventType", data, sequence
            FROM chat_stream_events
            WHERE stream_id = ${streamId} AND sequence = ${sequence}
          `)) as unknown as StreamEventRow | undefined;
          if (!row?.streamId || !row?.eventType) return;
          push(sseEvent({ eventType: row.eventType, streamId: row.streamId, sequence: row.sequence, data: row.data }));
        } catch {
          // ignore
        }
      };

      const emitJobSnapshot = async (jobId: string) => {
        try {
          const row = (await db.get(sql`
            SELECT id, type, data, status, created_at AS "createdAt", started_at AS "startedAt", completed_at AS "completedAt", error
            FROM job_queue
            WHERE id = ${jobId} AND workspace_id = ${targetWorkspaceId}
          `)) as unknown as JobSnapshotRow | undefined;
          if (!row?.id) return;
          const parsed = {
            id: row.id,
            type: row.type,
            data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
            status: row.status,
            createdAt: row.createdAt,
            startedAt: row.startedAt || undefined,
            completedAt: row.completedAt || undefined,
            error: row.error || undefined
          };
          push(sseJobEvent(jobId, { job: parsed }));
        } catch {
          // ignore
        }
      };

      const emitOrganizationSnapshot = async (organizationId: string) => {
        try {
          const row = (await db.get(sql`
            SELECT *
            FROM organizations
            WHERE id = ${organizationId} AND workspace_id = ${targetWorkspaceId}
          `)) as unknown as Record<string, unknown> | undefined;
          if (!row?.id || typeof row.id !== 'string') return;
          push(sseOrganizationEvent(organizationId, { organization: hydrateOrganizationForSse(row) }));
        } catch {
          // ignore
        }
      };

      const emitFolderSnapshot = async (folderId: string) => {
        try {
          const row = (await db.get(sql`
            SELECT *
            FROM folders
            WHERE id = ${folderId} AND workspace_id = ${targetWorkspaceId}
          `)) as unknown as Record<string, unknown> | undefined;
          if (!row?.id || typeof row.id !== 'string') return;
          push(sseFolderEvent(folderId, { folder: row }));
        } catch {
          // ignore
        }
      };

      const emitUseCaseSnapshot = async (useCaseId: string) => {
        try {
          const [row] = await db
            .select()
            .from(useCases)
            .where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, targetWorkspaceId)));
          if (!row?.id || typeof row.id !== 'string') return;
          // Utiliser hydrateUseCase pour avoir la même structure que GET /use-cases (camelCase)
          const hydrated = await hydrateUseCase(row);
          push(sseUseCaseEvent(useCaseId, { useCase: hydrated }));
        } catch {
          // ignore
        }
      };

      const emitLockSnapshot = async (objectType: string, objectId: string) => {
        try {
          const now = new Date();
          const [row] = await db
            .select({
              id: objectLocks.id,
              workspaceId: objectLocks.workspaceId,
              objectType: objectLocks.objectType,
              objectId: objectLocks.objectId,
              lockedAt: objectLocks.lockedAt,
              expiresAt: objectLocks.expiresAt,
              lockedByUserId: objectLocks.lockedByUserId,
              lockedByEmail: users.email,
              lockedByDisplayName: users.displayName,
              unlockRequestedAt: objectLocks.unlockRequestedAt,
              unlockRequestedByUserId: objectLocks.unlockRequestedByUserId,
              unlockRequestMessage: objectLocks.unlockRequestMessage,
            })
            .from(objectLocks)
            .innerJoin(users, eq(objectLocks.lockedByUserId, users.id))
            .where(
              and(
                eq(objectLocks.workspaceId, targetWorkspaceId),
                eq(objectLocks.objectType, objectType),
                eq(objectLocks.objectId, objectId),
                gt(objectLocks.expiresAt, now)
              )
            )
            .limit(1);

          const lock = row?.id
            ? {
                id: row.id,
                workspaceId: row.workspaceId,
                objectType: row.objectType,
                objectId: row.objectId,
                lockedAt: row.lockedAt,
                expiresAt: row.expiresAt,
                lockedBy: {
                  userId: row.lockedByUserId,
                  email: row.lockedByEmail ?? null,
                  displayName: row.lockedByDisplayName ?? null,
                },
                unlockRequestedAt: row.unlockRequestedAt ?? null,
                unlockRequestedByUserId: row.unlockRequestedByUserId ?? null,
                unlockRequestMessage: row.unlockRequestMessage ?? null,
              }
            : null;

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
          const snapshot = listPresence({ workspaceId, objectType: coercedType, objectId });
          push(ssePresenceEvent(objectType, objectId, snapshot));
        } catch {
          // ignore
        }
      };

      const isWorkspaceMember = async (workspaceId: string): Promise<boolean> => {
        try {
          const row = await db.get(sql`
            SELECT 1
            FROM workspace_memberships
            WHERE workspace_id = ${workspaceId} AND user_id = ${user.userId}
            LIMIT 1
          `);
          return !!row;
        } catch {
          return false;
        }
      };

      const shouldEmitWorkspaceEvent = async (payload: Record<string, unknown>): Promise<boolean> => {
        const workspaceId = typeof payload.workspace_id === 'string' ? payload.workspace_id : null;
        if (!workspaceId) return false;
        const userId = typeof payload.user_id === 'string' ? payload.user_id : null;
        if (userId && userId === user.userId) return true;
        const userIds = Array.isArray(payload.user_ids)
          ? payload.user_ids.filter((id) => typeof id === 'string')
          : [];
        if (userIds.includes(user.userId)) return true;
        return await isWorkspaceMember(workspaceId);
      };

      // headers de "connexion"
      push(`: connected\n\n`);

      // Burst initial (sans paramétrage): pour QueueMonitor, envoyer un snapshot des jobs actifs
      // + le dernier event stream par job, afin d'avoir quelque chose à afficher immédiatement.
      if (canStreamJobs && wantsAllJobsEffective) {
        try {
          const activeJobs = (await db.all(sql`
            SELECT id
            FROM job_queue
            WHERE status IN ('pending', 'processing')
              AND workspace_id = ${targetWorkspaceId}
            ORDER BY created_at DESC
            LIMIT 50
          `)) as Array<{ id: string }>;
          for (const j of activeJobs) {
            if (!j?.id) continue;
            await emitJobSnapshot(j.id);
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
      const client = await pool.connect();

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          client.removeListener('notification', onNotification);
          await client.query('UNLISTEN stream_events');
          await client.query('UNLISTEN job_events');
          await client.query('UNLISTEN organization_events');
          await client.query('UNLISTEN folder_events');
          await client.query('UNLISTEN usecase_events');
          await client.query('UNLISTEN lock_events');
          await client.query('UNLISTEN presence_events');
          await client.query('UNLISTEN workspace_events');
          await client.query('UNLISTEN workspace_membership_events');
        } catch {
          // ignore
        } finally {
          client.release();
        }
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      const onNotification = (msg: Notification) => {
        try {
          if (!msg.payload) return;
          const payload = JSON.parse(msg.payload) as Record<string, unknown>;
          if (msg.channel === 'stream_events') {
            const streamId = payload.stream_id;
            if (!streamId || typeof streamId !== 'string') return;
            if (hasStreamFilter && !wanted.has(streamId)) return;

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
          } else if (msg.channel === 'usecase_events') {
            const useCaseId = payload.use_case_id;
            if (!useCaseId || typeof useCaseId !== 'string') return;
            void emitUseCaseSnapshot(useCaseId);
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
          }
        } catch {
          // ignore
        }
      };

      client.on('notification', onNotification);
      await client.query('LISTEN job_events');
      await client.query('LISTEN organization_events');
      await client.query('LISTEN folder_events');
      await client.query('LISTEN usecase_events');
      await client.query('LISTEN stream_events');
      await client.query('LISTEN lock_events');
      await client.query('LISTEN presence_events');
      await client.query('LISTEN workspace_events');
      await client.query('LISTEN workspace_membership_events');

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


