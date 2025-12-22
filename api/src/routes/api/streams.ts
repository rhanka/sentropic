import { Hono } from 'hono';
import { db, pool } from '../../db/client';
import { listActiveStreamIds, readStreamEvents } from '../../services/stream-service';
import { sql } from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';
import type { Notification } from 'pg';
import { hydrateUseCase } from './use-cases';
import { ADMIN_WORKSPACE_ID, chatMessages, chatSessions, companies, folders, jobQueue, useCases, workspaces } from '../../db/schema';

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

function parseCompanyIds(url: URL): string[] {
  const repeated = url.searchParams.getAll('companyIds').flatMap(v => (v || '').split(','));
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

function sseCompanyEvent(companyId: string, data: unknown): string {
  const payload = JSON.stringify({ companyId, data });
  return `event: company_update\nid: company:${companyId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseFolderEvent(folderId: string, data: unknown): string {
  const payload = JSON.stringify({ folderId, data });
  return `event: folder_update\nid: folder:${folderId}:${Date.now()}\ndata: ${payload}\n\n`;
}

function sseUseCaseEvent(useCaseId: string, data: unknown): string {
  const payload = JSON.stringify({ useCaseId, data });
  return `event: usecase_update\nid: usecase:${useCaseId}:${Date.now()}\ndata: ${payload}\n\n`;
}

async function resolveTargetWorkspaceId(c: any, url: URL): Promise<string> {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const requested = url.searchParams.get('workspace_id');

  if (!requested) return user.workspaceId;
  if (user?.role !== 'admin_app') return user.workspaceId;
  if (requested === ADMIN_WORKSPACE_ID) return requested;

  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, requested), eq(workspaces.shareWithAdmin, true)))
    .limit(1);

  if (!ws) throw new Error('Workspace not accessible');
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
  const companyIds = parseCompanyIds(url);
  const jobsScope = (url.searchParams.get('jobs') || '').trim(); // 'all' option
  const wantsAllJobs = jobsScope === 'all';
  const companiesScope = (url.searchParams.get('companies') || '').trim(); // 'all' option
  const wantsAllCompanies = companiesScope === 'all';

  // Keep a single stable SSE URL: stream events are no longer "opt-in" via streamIds.
  // If streamIds are provided, we honor them as an additional client-side filter.
  const hasStreamFilter = streamIds.length > 0;
  const wantsAllCompaniesEffective = wantsAllCompanies || companyIds.length === 0;
  const wantsAllJobsEffective = wantsAllJobs || jobIds.length === 0;

  if (streamIds.length > 200) return c.json({ message: 'Trop de streamIds (max 200)' }, 400);
  if (jobIds.length > 500) return c.json({ message: 'Trop de jobIds (max 500)' }, 400);
  if (companyIds.length > 500) return c.json({ message: 'Trop de companyIds (max 500)' }, 400);

  // Protection: job updates sont sensibles → admin_app requis
  // With tenancy: allow all authenticated users to stream their own workspace jobs.
  const canStreamJobs = true;

  const cursor = parseCursor(url.searchParams.get('cursor'));
  const wanted = new Set(streamIds);
  const wantedJobs = new Set(jobIds);
  const wantedCompanies = new Set(companyIds);

  // lastSeq par stream (reprise)
  const lastSeq: Record<string, number> = {};
  for (const id of streamIds) lastSeq[id] = Number.isFinite(cursor[id]) ? cursor[id] : 0;

  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const draining = new Map<string, boolean>();
      const pending = new Map<string, boolean>();
      const streamAllowedCache = new Map<string, boolean>();

      const push = (text: string) => controller.enqueue(encoder.encode(text));
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
          if (streamId.startsWith('company_')) {
            const id = streamId.slice('company_'.length);
            const [r] = await db
              .select({ id: companies.id })
              .from(companies)
              .where(and(eq(companies.id, id), eq(companies.workspaceId, targetWorkspaceId)))
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
        if (hasStreamFilter && !wanted.has(streamId)) return;
        if (draining.get(streamId)) {
          pending.set(streamId, true);
          return;
        }
        draining.set(streamId, true);
        try {
          const allowed = await isStreamAllowed(streamId);
          if (!allowed) return;

          const events = await readStreamEvents(streamId, lastSeq[streamId] ?? 0);
          for (const ev of events) {
            lastSeq[streamId] = ev.sequence;
            push(sseEvent({ eventType: ev.eventType, streamId, sequence: ev.sequence, data: ev.data }));
          }
        } finally {
          draining.set(streamId, false);
          if (pending.get(streamId)) {
            pending.set(streamId, false);
            // rattrapage supplémentaire
            void drainStream(streamId);
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

      const emitLatestStreamEvent = async (streamId: string) => {
        try {
          const row = (await db.get(sql`
            SELECT stream_id AS "streamId", event_type AS "eventType", data, sequence
            FROM chat_stream_events
            WHERE stream_id = ${streamId}
            ORDER BY sequence DESC
            LIMIT 1
          `)) as unknown as StreamEventRow | undefined;
          if (!row?.streamId || !row?.eventType || !Number.isFinite(row.sequence)) return;
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

      const emitCompanySnapshot = async (companyId: string) => {
        try {
          const row = (await db.get(sql`
            SELECT *
            FROM companies
            WHERE id = ${companyId} AND workspace_id = ${targetWorkspaceId}
          `)) as unknown as Record<string, unknown> | undefined;
          if (!row?.id || typeof row.id !== 'string') return;
          push(sseCompanyEvent(companyId, { company: row }));
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

      // snapshot initial pour les companyIds explicitement demandés
      if (wantedCompanies.size > 0) {
        for (const id of wantedCompanies) {
          await emitCompanySnapshot(id);
        }
      }

      // LISTEN/NOTIFY
      const client = await pool.connect();
      let closed = false;

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          client.removeListener('notification', onNotification);
          await client.query('UNLISTEN stream_events');
          await client.query('UNLISTEN job_events');
          await client.query('UNLISTEN company_events');
          await client.query('UNLISTEN folder_events');
          await client.query('UNLISTEN usecase_events');
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
                void drainStream(streamId);
              })();
              return;
            }

            // Fallback: if no sequence, best-effort drain
            void drainStream(streamId);
          } else if (msg.channel === 'job_events') {
            const jobId = payload.job_id;
            if (!jobId || typeof jobId !== 'string') return;
            if (!canStreamJobs) return;
            if (!wantsAllJobsEffective && wantedJobs.size > 0 && !wantedJobs.has(jobId)) return;
            void emitJobSnapshot(jobId);
          } else if (msg.channel === 'company_events') {
            const companyId = payload.company_id;
            if (!companyId || typeof companyId !== 'string') return;
            if (!wantsAllCompaniesEffective && wantedCompanies.size > 0 && !wantedCompanies.has(companyId)) return;
            void emitCompanySnapshot(companyId);
          } else if (msg.channel === 'folder_events') {
            const folderId = payload.folder_id;
            if (!folderId || typeof folderId !== 'string') return;
            void emitFolderSnapshot(folderId);
          } else if (msg.channel === 'usecase_events') {
            const useCaseId = payload.use_case_id;
            if (!useCaseId || typeof useCaseId !== 'string') return;
            void emitUseCaseSnapshot(useCaseId);
          }
        } catch {
          // ignore
        }
      };

      client.on('notification', onNotification);
      await client.query('LISTEN job_events');
      await client.query('LISTEN company_events');
      await client.query('LISTEN folder_events');
      await client.query('LISTEN usecase_events');
      await client.query('LISTEN stream_events');

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


