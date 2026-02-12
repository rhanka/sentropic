import { db, pool } from '../db/client';
import { and, sql, eq, desc } from 'drizzle-orm';
import { createId } from '../utils/id';
import { enrichOrganization, type OrganizationData } from './context-organization';
import { generateUseCaseList, generateUseCaseDetail, type UseCaseListItem } from './context-usecase';
import { generateOrganizationMatrixTemplate, mergeOrganizationMatrixTemplate } from './context-matrix';
import { parseMatrixConfig } from '../utils/matrix';
import { defaultMatrixConfig } from '../config/default-matrix';
import type { MatrixConfig } from '../types/matrix';
import type { UseCaseData, UseCaseDataJson } from '../types/usecase';
import { validateScores, fixScores } from '../utils/score-validation';
import {
  folders,
  organizations,
  useCases,
  jobQueue,
  ADMIN_WORKSPACE_ID,
  type JobQueueRow,
  contextDocuments,
  contextModificationHistory,
} from '../db/schema';
import { settingsService } from './settings';
import { generateExecutiveSummary } from './executive-summary';
import { chatService } from './chat-service';
import type { StreamEventType } from './openai';
import {
  deleteObject,
  getDocumentsBucketName,
  getObjectBytes,
  headObject,
  putObject,
} from './storage-s3';
import { extractDocumentInfoFromDocument } from './document-text';
import { generateDocumentDetailedSummary, generateDocumentSummary, getDocumentDetailedSummaryPolicy } from './context-document';
import { getNextSequence, writeStreamEvent } from './stream-service';
import type { DocxEntityType, DocxTemplateId } from './docx-service';
import { runDocxGenerationInWorker } from './docx-render-worker';

function parseOrgData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonField<T = unknown>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function sanitizeJobResultForPublic(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const copy = { ...(result as Record<string, unknown>) };
  if (typeof copy.contentBase64 === 'string') {
    delete copy.contentBase64;
    copy.hasContent = true;
  }
  return copy;
}

export type JobType =
  | 'organization_enrich'
  | 'matrix_generate'
  | 'usecase_list'
  | 'usecase_detail'
  | 'executive_summary'
  | 'chat_message'
  | 'document_summary'
  | 'docx_generate';

export type MatrixMode = 'organization' | 'generate' | 'default';

export interface OrganizationEnrichJobData {
  organizationId: string;
  organizationName: string;
  model?: string;
}

export interface MatrixGenerateJobData {
  folderId: string;
  organizationId: string;
  model?: string;
}

export interface UseCaseListJobData {
  folderId: string;
  input: string;
  organizationId?: string;
  matrixMode?: MatrixMode;
  model?: string;
  useCaseCount?: number;
}

export interface UseCaseDetailJobData {
  useCaseId: string;
  useCaseName: string;
  folderId: string;
  matrixMode?: MatrixMode;
  model?: string;
}

export interface ExecutiveSummaryJobData {
  folderId: string;
  valueThreshold?: number | null;
  complexityThreshold?: number | null;
  model?: string;
}

export interface ChatMessageJobData {
  userId: string;
  sessionId: string;
  assistantMessageId: string;
  model?: string;
  contexts?: Array<{ contextType: 'organization' | 'folder' | 'usecase' | 'executive_summary'; contextId: string }>;
  tools?: string[];
}

export interface DocumentSummaryJobData {
  documentId: string;
  lang?: string; // default: 'fr'
  model?: string;
}

export interface DocxGenerateJobData {
  templateId: DocxTemplateId;
  entityType: DocxEntityType;
  entityId: string;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  locale?: string;
  requestId?: string;
  sourceHash?: string;
}

export type JobData =
  | OrganizationEnrichJobData
  | MatrixGenerateJobData
  | UseCaseListJobData
  | UseCaseDetailJobData
  | ExecutiveSummaryJobData
  | ChatMessageJobData
  | DocumentSummaryJobData
  | DocxGenerateJobData;

export interface Job {
  id: string;
  type: JobType;
  data: JobData;
  result?: unknown;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workspaceId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export class QueueManager {
  private isProcessing = false;
  private maxConcurrentJobs = 10; // AI queue class
  private maxPublishingJobs = 5; // Publishing queue class (docx, authoring, ...)
  private processingInterval = 1000; // Intervalle par défaut
  private paused = false;
  private cancelAllInProgress = false;
  private jobControllers: Map<string, AbortController> = new Map();

  constructor() {
    this.loadSettings();
  }

  private async notifyJobEvent(jobId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ job_id: jobId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY job_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyOrganizationEvent(organizationId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ organization_id: organizationId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY organization_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyFolderEvent(folderId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ folder_id: folderId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyUseCaseEvent(useCaseId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ use_case_id: useCaseId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY usecase_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async hasAnyContextDocuments(
    workspaceId: string,
    contextType: 'organization' | 'folder' | 'usecase',
    contextId: string
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: contextDocuments.id })
      .from(contextDocuments)
      .where(and(eq(contextDocuments.workspaceId, workspaceId), eq(contextDocuments.contextType, contextType), eq(contextDocuments.contextId, contextId)))
      .limit(1);
    return Boolean(row?.id);
  }

  private async getDocumentsContextsForGeneration(opts: {
    workspaceId: string;
    folderId: string;
    organizationId?: string | null;
  }): Promise<Array<{ workspaceId: string; contextType: 'organization' | 'folder'; contextId: string }>> {
    const { workspaceId, folderId, organizationId } = opts;
    const contexts: Array<{ workspaceId: string; contextType: 'organization' | 'folder'; contextId: string }> = [];

    if (await this.hasAnyContextDocuments(workspaceId, 'folder', folderId)) {
      contexts.push({ workspaceId, contextType: 'folder', contextId: folderId });
    }
    if (organizationId && (await this.hasAnyContextDocuments(workspaceId, 'organization', organizationId))) {
      contexts.push({ workspaceId, contextType: 'organization', contextId: organizationId });
    }
    return contexts;
  }

  /**
   * Build a preloaded documents context (list + summaries) to inject in generation prompts.
   * Budget is enforced in characters to avoid overly large prompts.
   */
  private async buildDocumentsContextJsonForGeneration(opts: {
    workspaceId: string;
    contexts: Array<{ contextType: 'organization' | 'folder'; contextId: string }>;
    maxChars: number;
  }): Promise<string> {
    const { workspaceId, contexts, maxChars } = opts;
    if (!contexts || contexts.length === 0) return '';

    // Load docs from DB (summary is stored in context_documents.data.summary).
    const rows = await db.select({
      id: contextDocuments.id,
      contextType: contextDocuments.contextType,
      contextId: contextDocuments.contextId,
      filename: contextDocuments.filename,
      mimeType: contextDocuments.mimeType,
      status: contextDocuments.status,
      sizeBytes: contextDocuments.sizeBytes,
      createdAt: contextDocuments.createdAt,
      updatedAt: contextDocuments.updatedAt,
      data: contextDocuments.data,
    })
      .from(contextDocuments)
      .where(eq(contextDocuments.workspaceId, workspaceId));

    const allowed = new Set(contexts.map((c) => `${c.contextType}:${c.contextId}`));
    const candidates = rows
      .filter((r) => allowed.has(`${r.contextType}:${r.contextId}`))
      .map((r) => {
        const dataObj = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
        const summary = typeof dataObj.summary === 'string' ? dataObj.summary : '';
        return {
          id: r.id,
          contextType: r.contextType,
          contextId: r.contextId,
          filename: r.filename,
          mimeType: r.mimeType,
          status: r.status,
          sizeBytes: r.sizeBytes ?? null,
          updatedAt: (r.updatedAt ?? r.createdAt ?? null) ? new Date(r.updatedAt ?? r.createdAt ?? new Date()).toISOString() : null,
          summary,
        };
      })
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));

    const picked: Array<unknown> = [];
    let usedChars = 0;
    const reserve = 400; // headroom for wrapper fields
    const effectiveMax = Math.max(5_000, Math.floor(maxChars));

    for (const item of candidates) {
      const s = JSON.stringify(item);
      const next = usedChars + s.length + 2;
      if (next + reserve > effectiveMax) break;
      picked.push(item);
      usedChars = next;
    }

    const truncated = picked.length < candidates.length;
    const payload = {
      version: 1,
      limits: { maxChars: effectiveMax },
      truncated,
      items: picked,
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Charger les paramètres de configuration
   */
  private async loadSettings(): Promise<void> {
    try {
      const settings = await settingsService.getAISettings();
      this.maxConcurrentJobs = settings.concurrency;
      this.maxPublishingJobs = settings.publishingConcurrency;
      this.processingInterval = settings.processingInterval;
      console.log(
        `🔧 Queue settings loaded: aiConcurrency=${this.maxConcurrentJobs}, publishingConcurrency=${this.maxPublishingJobs}, interval=${this.processingInterval}ms`
      );
    } catch (error) {
      console.warn('⚠️ Failed to load queue settings, using defaults:', error);
    }
  }

  /**
   * Recharger les paramètres de configuration
   */
  async reloadSettings(): Promise<void> {
    await this.loadSettings();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (!this.isProcessing) {
      this.processJobs().catch(console.error);
    }
  }

  async cancelAllProcessing(reason: string = 'cancel-all'): Promise<void> {
    this.cancelAllInProgress = true;
    for (const [, controller] of this.jobControllers.entries()) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // Ignore abort errors if controller is already aborted
      }
    }
    await this.drain();
    this.cancelAllInProgress = false;
  }

  /**
   * Best-effort: cancel any in-flight jobs for a specific workspace.
   * This prevents leakage/cost when a user purges their own job history.
   */
  async cancelProcessingForWorkspace(workspaceId: string, reason: string = 'purge-mine'): Promise<void> {
    // Mark DB rows as failed first (best-effort) so other readers see them as cancelled.
    let processingIds: string[] = [];
    try {
      const rows = (await db.all(sql`
        SELECT id FROM job_queue
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `)) as Array<{ id: string }>;
      processingIds = rows.map((r) => r.id);
    } catch (e) {
      console.warn('⚠️ Failed to load processing jobs for workspace cancellation:', e);
    }

    if (processingIds.length === 0) return;

    try {
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ${`Job cancelled by ${reason}`}
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `);
    } catch (e) {
      // ignore
    }

    for (const jobId of processingIds) {
      const controller = this.jobControllers.get(jobId);
      if (!controller) continue;
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
      try {
        await this.notifyJobEvent(jobId);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Annule un job spécifique (pending ou processing).
   * - chat_message => status "completed" (arrêt utilisateur).
   * - autres => status "failed".
   */
  async cancelJob(jobId: string, reason: string = 'cancelled'): Promise<{ status: string } | null> {
    const [row] = await db
      .select({ id: jobQueue.id, type: jobQueue.type, status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    if (!row) return null;

    const isChat = row.type === 'chat_message';
    const nextStatus = isChat ? 'completed' : 'failed';
    await db.run(sql`
      UPDATE job_queue
      SET status = ${nextStatus},
          completed_at = ${new Date()},
          error = ${`Job cancelled: ${reason}`}
      WHERE id = ${jobId}
    `);
    await this.notifyJobEvent(jobId);

    const controller = this.jobControllers.get(jobId);
    if (controller) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
    }

    return { status: nextStatus };
  }

  async drain(timeoutMs: number = 10000): Promise<void> {
    const start = Date.now();
    while (this.jobControllers.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private queueClassSqlExpr(): string {
    return `
      CASE type
        WHEN 'docx_generate' THEN 'publishing'
        ELSE 'ai'
      END
    `;
  }

  /**
   * Ajouter un job à la queue
   */
  async addJob(
    type: JobType,
    data: JobData,
    opts?: {
      workspaceId?: string;
      /**
       * Max number of retries after the initial attempt.
       * - 0 => 1 total attempt (default)
       * - 1 => up to 2 total attempts
       */
      maxRetries?: number;
    }
  ): Promise<string> {
    if (this.cancelAllInProgress || this.paused) {
      console.warn(`⏸️ Queue paused/cancelling, refusing to enqueue job ${type}`);
      throw new Error('Queue is paused or cancelling; job not accepted');
    }
    const jobId = createId();
    const workspaceId = opts?.workspaceId ?? ADMIN_WORKSPACE_ID;
    const maxRetries = Number.isFinite(opts?.maxRetries as number) ? Number(opts?.maxRetries) : 0;
    const payload = {
      ...(data as unknown as Record<string, unknown>),
      _retry: {
        attempt: 0,
        maxRetries: Math.max(0, Math.floor(maxRetries)),
      },
    };
    
    await db.run(sql`
      INSERT INTO job_queue (id, type, data, status, created_at, workspace_id)
      VALUES (${jobId}, ${type}, ${JSON.stringify(payload)}, 'pending', ${new Date()}, ${workspaceId})
    `);
    await this.notifyJobEvent(jobId);
    
    console.log(`📝 Job ${jobId} (${type}) added to queue`);
    
    // Démarrer le traitement si pas déjà en cours
    if (!this.isProcessing) {
      this.processJobs().catch(console.error);
    }
    
    return jobId;
  }

  /**
   * Traiter les jobs en attente
   */
  async processJobs(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    if (this.paused) {
      console.log('⏸️ Queue is paused; aborting processJobs start');
      return;
    }

    this.isProcessing = true;
    console.log('🚀 Starting job processing...');

    try {
      const inFlight = new Set<Promise<void>>();
      const queueClassExpr = sql.raw(this.queueClassSqlExpr());
      const queueClasses: Array<'ai' | 'publishing'> = ['publishing', 'ai'];

      const sleep = async (ms: number) => new Promise((r) => setTimeout(r, ms));

      const getProcessingCountByClass = async (
        queueClass: 'ai' | 'publishing'
      ): Promise<number> => {
        try {
          const rows = (await db.all(sql`
            SELECT COUNT(*)::int AS count
            FROM job_queue
            WHERE status = 'processing'
              AND ${queueClassExpr} = ${queueClass}
          `)) as Array<{ count: number }>;
          return rows?.[0]?.count ?? 0;
        } catch {
          return 0;
        }
      };

      const hasAnyPending = async (): Promise<boolean> => {
        const rows = await db
          .select({ id: sql<string>`id` })
          .from(jobQueue)
          .where(eq(jobQueue.status, 'pending'))
          .limit(1);
        return rows.length > 0;
      };

      const claimPendingJobsByClass = async (
        queueClass: 'ai' | 'publishing',
        limit: number
      ): Promise<JobQueueRow[]> => {
        if (limit <= 0) return [];
        const orderByExpr =
          queueClass === 'ai'
            ? sql.raw(
                "CASE type WHEN 'chat_message' THEN 0 WHEN 'matrix_generate' THEN 1 WHEN 'usecase_list' THEN 1 ELSE 2 END, created_at ASC"
              )
            : sql.raw('created_at ASC');
        const now = new Date();
        const rows = (await db.all(sql`
          WITH picked AS (
            SELECT id
            FROM job_queue
            WHERE status = 'pending'
              AND ${queueClassExpr} = ${queueClass}
            ORDER BY ${orderByExpr}
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE job_queue q
          SET status = 'processing', started_at = ${now}
          FROM picked
          WHERE q.id = picked.id
          RETURNING q.*
        `)) as JobQueueRow[];
        return rows ?? [];
      };

      while (!this.paused) {
        if (this.cancelAllInProgress) break;

        for (const queueClass of queueClasses) {
          const classLimit = queueClass === 'ai' ? this.maxConcurrentJobs : this.maxPublishingJobs;
          const classProcessing = await getProcessingCountByClass(queueClass);
          const slots = Math.max(0, classLimit - classProcessing);
          if (slots <= 0) continue;

          const claimedJobs = await claimPendingJobsByClass(queueClass, slots);
          for (const job of claimedJobs) {
            await this.notifyJobEvent(job.id);
            const p = this.processJob(job).finally(() => {
              inFlight.delete(p);
            });
            inFlight.add(p);
          }
        }

        // If nothing is running and nothing is pending, we're done.
        if (inFlight.size === 0) {
          const more = await hasAnyPending();
          if (!more) break;
          // No local work but pending exists: either slots=0 (global limit reached) or a race. Wait briefly.
          await sleep(200);
          continue;
        }

        // Wait for at least one job to finish, then continue filling.
        // IMPORTANT: do not block indefinitely on long-running jobs.
        // New jobs can be enqueued while we are waiting; we must periodically wake up to claim
        // additional pending jobs (up to the configured global concurrency).
        await Promise.race([Promise.race(inFlight), sleep(this.processingInterval)]);
      }
    } finally {
      this.isProcessing = false;
      console.log('✅ Job processing completed');
    }
  }

  /**
   * Traiter un job individuel
   */
  private async processJob(job: JobQueueRow): Promise<void> {
    const jobId = job.id;
    const jobType = job.type as JobType;
    const jobData = JSON.parse(job.data) as unknown;

    const getRetryMeta = (value: unknown): { attempt: number; maxRetries: number } => {
      if (!value || typeof value !== 'object') return { attempt: 0, maxRetries: 0 };
      const retry = (value as { _retry?: unknown })._retry;
      if (!retry || typeof retry !== 'object') return { attempt: 0, maxRetries: 0 };
      const attemptRaw = (retry as { attempt?: unknown }).attempt;
      const maxRaw = (retry as { maxRetries?: unknown }).maxRetries;
      const attempt = typeof attemptRaw === 'number' && Number.isFinite(attemptRaw) ? attemptRaw : Number(attemptRaw);
      const maxRetries = typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? maxRaw : Number(maxRaw);
      return {
        attempt: Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0,
        maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0,
      };
    };

    const { attempt: retryAttempt, maxRetries: retryMax } = getRetryMeta(jobData);

    const isAbort = (err: unknown): boolean => {
      if (!err) return false;
      if (err instanceof DOMException && err.name === 'AbortError') return true;
      if (err instanceof Error && err.name === 'AbortError') return true;
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('AbortError') || msg.includes('aborted') || msg.includes('Request was aborted');
    };

    const isRetryableUseCaseError = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      // JSON/format issues (LLM returned non-JSON or concatenated junk)
      if (msg.includes('Erreur lors du parsing') || msg.includes('Invalid JSON') || msg.includes('Unexpected non-whitespace character') || msg.includes('No JSON object boundaries')) {
        return true;
      }
      // Missing scores arrays leading to validateScores crash
      if (msg.includes("Cannot read properties of undefined (reading 'map')")) {
        return true;
      }
      // Transient network/OpenAI-ish issues (best-effort)
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
        return true;
      }
      return false;
    };

    try {
      console.log(`🔄 Processing job ${jobId} (${jobType})`);

      // Safety: the job may have been purged between claim and processing start.
      // Also protects against any unexpected double-processing: only proceed if job is still processing.
      const [current] = await db
        .select({ status: jobQueue.status })
        .from(jobQueue)
        .where(eq(jobQueue.id, jobId))
        .limit(1);
      if (!current || current.status !== 'processing') {
        console.log(`⏭️ Skipping job ${jobId}: missing or not processing (likely purged/claimed elsewhere)`);
        return;
      }

      const controller = new AbortController();
      this.jobControllers.set(jobId, controller);

      // Traiter selon le type
      switch (jobType) {
        case 'organization_enrich':
          await this.processOrganizationEnrich(jobData as unknown as OrganizationEnrichJobData, jobId, controller.signal);
          break;
        case 'matrix_generate':
          await this.processMatrixGenerate(jobData as unknown as MatrixGenerateJobData, controller.signal);
          break;
        case 'usecase_list':
          await this.processUseCaseList(jobData as unknown as UseCaseListJobData, controller.signal);
          break;
        case 'usecase_detail':
          await this.processUseCaseDetail(jobData as unknown as UseCaseDetailJobData, controller.signal);
          break;
        case 'executive_summary':
          await this.processExecutiveSummary(jobData as unknown as ExecutiveSummaryJobData, controller.signal);
          break;
        case 'chat_message':
          await this.processChatMessage(jobData as unknown as ChatMessageJobData, controller.signal);
          break;
        case 'document_summary':
          await this.processDocumentSummary(
            jobData as unknown as DocumentSummaryJobData,
            jobId,
            controller.signal
          );
          break;
        case 'docx_generate':
          await this.processDocxGenerate(
            jobData as unknown as DocxGenerateJobData,
            jobId,
            controller.signal
          );
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      // Marquer comme terminé
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'completed', completed_at = ${new Date()}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      console.log(`✅ Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);

      // Retry logic (bounded) for use case generation jobs only.
      // IMPORTANT: never retry on AbortError (user/admin cancel).
      if ((jobType === 'usecase_list' || jobType === 'usecase_detail') && retryMax > 0 && retryAttempt < retryMax && !isAbort(error) && isRetryableUseCaseError(error)) {
        const nextAttempt = retryAttempt + 1;
        const nextData =
          jobData && typeof jobData === 'object'
            ? { ...(jobData as Record<string, unknown>), _retry: { attempt: nextAttempt, maxRetries: retryMax } }
            : { _retry: { attempt: nextAttempt, maxRetries: retryMax } };
        const msg = error instanceof Error ? error.message : 'Unknown error';
        await db.run(sql`
          UPDATE job_queue
          SET status = 'pending',
              data = ${JSON.stringify(nextData)},
              error = ${`retry ${nextAttempt}/${retryMax}: ${msg}`},
              started_at = NULL,
              completed_at = NULL
          WHERE id = ${jobId}
        `);
        await this.notifyJobEvent(jobId);
        console.warn(`🔁 Retrying job ${jobId} (${jobType}) attempt ${nextAttempt}/${retryMax}`);
        return;
      }

      // Annulation utilisateur: pour le chat, on finalise avec le contenu partiel.
      if (jobType === 'chat_message' && isAbort(error)) {
        const assistantMessageId =
          typeof (jobData as { assistantMessageId?: unknown })?.assistantMessageId === 'string'
            ? ((jobData as { assistantMessageId: string }).assistantMessageId as string)
            : null;
        if (assistantMessageId) {
          try {
            await chatService.finalizeAssistantMessageFromStream({
              assistantMessageId,
              reason: error instanceof Error ? error.message : 'cancelled',
              fallbackContent: 'Réponse interrompue.'
            });
          } catch {
            // ignore
          }
        }

        await db.run(sql`
          UPDATE job_queue 
          SET status = 'completed', completed_at = ${new Date()}, error = ${error instanceof Error ? error.message : 'cancelled'}
          WHERE id = ${jobId}
        `);
        await this.notifyJobEvent(jobId);
        return;
      }
      
      // Marquer comme échoué
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'failed', error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      // Best-effort: also propagate failure to context_documents for document_summary jobs,
      // so the UI can show `failed` without having to inspect job_queue.
      if (jobType === 'document_summary') {
        try {
          const docId =
            typeof (jobData as { documentId?: unknown })?.documentId === 'string'
              ? (jobData as { documentId: string }).documentId
              : null;
          if (docId) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            const safe = this.sanitizePgText(`Échec: ${msg}`).slice(0, 5000);
            await db.run(sql`
              UPDATE context_documents
              SET status = 'failed',
                  data = jsonb_set(coalesce(data, '{}'::jsonb), '{summary}', to_jsonb(${safe}), true),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ${docId}
            `);

            // Best-effort: also stream an error for observers (streamId derived from documentId).
            const streamId = `document_${docId}`;
            const seq = await getNextSequence(streamId);
            await writeStreamEvent(streamId, 'error', { message: msg }, seq);
          }
        } catch {
          // ignore
        }
      }
    } finally {
      this.jobControllers.delete(jobId);
    }
  }

  /**
   * Worker pour l'enrichissement d'organisation
   */
  private async processOrganizationEnrich(data: OrganizationEnrichJobData, jobId: string, signal?: AbortSignal): Promise<void> {
    const { organizationId, organizationName, model } = data;
    
    // Générer un streamId pour le streaming
    // IMPORTANT:
    // Pour l'enrichissement organisation, on veut pouvoir suivre l'avancement côté UI avec uniquement l'organizationId
    // (les job_update peuvent être restreints). Donc on utilise un streamId déterministe basé sur l'entreprise.
    const streamId = `organization_${organizationId}`;
    
    // Fetch current org row (needed for workspace scope + preserve user-entered fields)
    const [existingOrg] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const workspaceId = typeof existingOrg?.workspaceId === 'string' ? existingOrg.workspaceId : '';
    const existingData = parseOrgData(existingOrg?.data);
    const effectiveName = (existingOrg?.name || organizationName || '').trim() || organizationName;

    // Only expose documents tool if this organization has attached documents.
    const hasOrgDocs = await (async () => {
      if (!workspaceId) return false;
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(contextDocuments)
        .where(
          and(
            eq(contextDocuments.workspaceId, workspaceId),
            eq(contextDocuments.contextType, 'organization'),
            eq(contextDocuments.contextId, organizationId)
          )
        )
        .limit(1);
      return rows.length > 0;
    })();

    // Enrichir l'organisation avec streaming.
    // IMPORTANT: `documents` tool is enabled only when docs exist; otherwise the model must not call it.
    const enrichedData: OrganizationData = await enrichOrganization(effectiveName, model, signal, streamId, {
      organizationId,
      workspaceId,
      existingData,
      useDocuments: hasOrgDocs
    });

    // Safety: PostgreSQL text/json cannot contain NUL (\u0000). Strip control chars before DB write.
    const sanitizePgText = (input: string): string => {
      let out = '';
      for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        if (code === 0) continue;
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
        out += input[i];
      }
      return out;
    };
    const clean = (s: string) => sanitizePgText(typeof s === 'string' ? s : String(s ?? ''));
    const cleanedReferences: Array<{ title: string; url: string; excerpt: string | undefined }> = Array.isArray(enrichedData.references)
      ? enrichedData.references
          .map((r) => ({
            title: clean(r.title),
            url: clean(r.url),
            excerpt: r.excerpt ? clean(r.excerpt) : undefined,
          }))
          .filter((r) => r.title.trim() && r.url.trim())
      : [];
    const cleanedData: OrganizationData = {
      industry: clean(enrichedData.industry),
      size: clean(enrichedData.size),
      products: clean(enrichedData.products),
      processes: clean(enrichedData.processes),
      kpis: clean(enrichedData.kpis),
      challenges: clean(enrichedData.challenges),
      objectives: clean(enrichedData.objectives),
      technologies: clean(enrichedData.technologies),
      references: cleanedReferences,
    };
    
    // Merge: preserve user-entered fields already present in organizations.data.
    const pickStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const keepIfFilled = (existing: unknown, next: string) => (pickStr(existing) ? pickStr(existing) : next);
    const mergeRefs = (
      existingRefs: unknown,
      nextRefs: Array<{ title: string; url: string; excerpt: string | undefined }>
    ): Array<{ title: string; url: string; excerpt: string | undefined }> => {
      const base = Array.isArray(existingRefs)
        ? existingRefs
            .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
            .filter((r): r is Record<string, unknown> => !!r)
            .map((r) => ({
              title: clean(typeof r.title === 'string' ? r.title : String(r.title ?? '')),
              url: clean(typeof r.url === 'string' ? r.url : String(r.url ?? '')),
              excerpt: typeof r.excerpt === 'string' ? clean(r.excerpt) : undefined,
            }))
            .filter((r) => r.title.trim() && r.url.trim())
        : [];
      const byUrl = new Set(base.map((r) => r.url));
      const merged = [...base];
      for (const r of nextRefs || []) {
        if (!r?.url) continue;
        if (byUrl.has(r.url)) continue;
        merged.push({ title: r.title, url: r.url, excerpt: r.excerpt });
        byUrl.add(r.url);
      }
      return merged;
    };

    const mergedData: OrganizationData = {
      industry: keepIfFilled(existingData.industry, cleanedData.industry),
      size: keepIfFilled(existingData.size, cleanedData.size),
      products: keepIfFilled(existingData.products, cleanedData.products),
      processes: keepIfFilled(existingData.processes, cleanedData.processes),
      kpis: keepIfFilled(existingData.kpis, cleanedData.kpis),
      challenges: keepIfFilled(existingData.challenges, cleanedData.challenges),
      objectives: keepIfFilled(existingData.objectives, cleanedData.objectives),
      technologies: keepIfFilled(existingData.technologies, cleanedData.technologies),
      references: mergeRefs(existingData.references, cleanedReferences),
    };

    // Store enriched profile in organizations.data JSONB
    await db
      .update(organizations)
      .set({
        data: mergedData,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));

    await this.notifyOrganizationEvent(organizationId);
  }

  private async processMatrixGenerate(data: MatrixGenerateJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, organizationId, model } = data;

    const [folder] = await db
      .select()
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) throw new Error('Folder not found for matrix generation');

    const [organization] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, folder.workspaceId)))
      .limit(1);
    if (!organization) throw new Error('Organization not found for matrix generation');

    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;

    const orgData = parseOrgData(organization.data);
    const organizationInfo = JSON.stringify(
      {
        name: organization.name,
        industry: orgData.industry,
        size: orgData.size,
        products: orgData.products,
        processes: orgData.processes,
        kpis: orgData.kpis,
        challenges: orgData.challenges,
        objectives: orgData.objectives,
        technologies: orgData.technologies,
      },
      null,
      2
    );

    const streamId = `matrix_${folderId}`;
    const template = await generateOrganizationMatrixTemplate(
      organization.name,
      organizationInfo,
      defaultMatrixConfig,
      selectedModel,
      signal,
      streamId
    );
    const generatedMatrix = mergeOrganizationMatrixTemplate(defaultMatrixConfig, template);

    const nextOrgData = {
      ...orgData,
      matrixTemplate: generatedMatrix,
      matrixTemplateMeta: {
        generatedAt: new Date().toISOString(),
        model: selectedModel,
        promptId: 'organization_matrix_template',
        version: 1,
      },
    };

    await db
      .update(organizations)
      .set({ data: nextOrgData, updatedAt: new Date() })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, folder.workspaceId)));

    await db
      .update(folders)
      .set({ matrixConfig: JSON.stringify(generatedMatrix), organizationId })
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, folder.workspaceId)));

    await this.notifyOrganizationEvent(organizationId);
    await this.notifyFolderEvent(folderId);
  }

  private sanitizePgText(input: string): string {
    let out = '';
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      if (code === 0) continue;
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
      out += input[i];
    }
    return out;
  }

  private trimToMaxWords(text: string, maxWords: number): { text: string; trimmed: boolean; words: number } {
    const t = (text || '').trim();
    if (!t) return { text: '', trimmed: false, words: 0 };
    const words = t.split(/\s+/g).filter(Boolean);
    const max = Math.max(1, Math.min(10_000, Math.floor(maxWords || 10_000)));
    if (words.length <= max) return { text: t, trimmed: false, words: words.length };
    return { text: words.slice(0, max).join(' ') + '\n…(tronqué)…', trimmed: true, words: max };
  }

  private chunkByWords(text: string, chunkWords: number): string[] {
    const t = (text || '').trim();
    if (!t) return [];
    const words = t.split(/\s+/g).filter(Boolean);
    const size = Math.max(500, Math.min(8000, Math.floor(chunkWords || 4500)));
    const out: string[] = [];
    for (let i = 0; i < words.length; i += size) {
      out.push(words.slice(i, i + size).join(' '));
    }
    return out;
  }

  private async getNextModificationSequence(contextType: string, contextId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${contextModificationHistory.sequence})` })
      .from(contextModificationHistory)
      .where(and(eq(contextModificationHistory.contextType, contextType), eq(contextModificationHistory.contextId, contextId)));
    const maxSequence = result[0]?.maxSequence ?? 0;
    return maxSequence + 1;
  }

  /**
   * Worker: summarize an uploaded document and update context_documents.
   * MVP: supports text-like formats only (text/*, application/json).
   */
  private async processDocumentSummary(
    data: DocumentSummaryJobData,
    jobId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const { documentId } = data;
    const lang = (data.lang || 'fr').trim() || 'fr';
    const streamId = `document_${documentId}`;

    const write = async (eventType: StreamEventType, payload: unknown) => {
      const seq = await getNextSequence(streamId);
      await writeStreamEvent(streamId, eventType, payload, seq);
    };

    // Ensure a deterministic "started" exists for monitors and any UI observers.
    await write('status', { state: 'started', jobType: 'document_summary', documentId });

    const [doc] = await db
      .select()
      .from(contextDocuments)
      .where(eq(contextDocuments.id, documentId))
      .limit(1);
    if (!doc) throw new Error('Document not found');
    const workspaceId = doc.workspaceId;

    try {
      await db
        .update(contextDocuments)
        .set({ status: 'processing', jobId, updatedAt: new Date() })
        .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));

      const bucket = getDocumentsBucketName();
      const bytes = await getObjectBytes({ bucket, key: doc.storageKey });
      let text: string;
      let extractedMetaTitle: string | undefined;
      let extractedMetaPages: number | undefined;
      let extractedMetaWords: number | undefined;
      try {
        await write('status', { state: 'extracting' });
        const extracted = await extractDocumentInfoFromDocument({ bytes, filename: doc.filename, mimeType: doc.mimeType });
        text = extracted.text;
        extractedMetaTitle = extracted.metadata.title;
        extractedMetaPages = extracted.metadata.pages;
        extractedMetaWords = (extracted.metadata as unknown as { words?: unknown }).words as number | undefined;
      } catch (e) {
        await db
          .update(contextDocuments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Unsupported mime type for summarization: ${doc.mimeType}. ${msg}`);
      }

      const trimmed = text.trim();
      if (trimmed.length < 80) {
        await db
          .update(contextDocuments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));
        throw new Error('No text extracted from document (empty or image-only PDF).');
      }

      const clipped = trimmed.length > 50_000 ? trimmed.slice(0, 50_000) : trimmed;
      const docTitleRaw = (extractedMetaTitle || doc.filename || '-').trim() || '-';
      const docTitle = docTitleRaw === '-' ? 'Non précisé' : docTitleRaw;
      const nbPages =
        typeof extractedMetaPages === 'number' && extractedMetaPages > 0 ? String(extractedMetaPages) : 'Non précisé';
      const nbWords = (() => {
        if (typeof extractedMetaWords === 'number' && Number.isFinite(extractedMetaWords) && extractedMetaWords > 0) {
          return String(extractedMetaWords);
        }
        // Fallback: count on full extracted text; if unavailable, count on clipped (aligned with what we send to the model).
        const fromFull = text.split(/\s+/).filter(Boolean).length;
        if (Number.isFinite(fromFull) && fromFull > 0) return String(fromFull);
        const fromClipped = clipped.split(/\s+/).filter(Boolean).length;
        return Number.isFinite(fromClipped) && fromClipped > 0 ? String(fromClipped) : 'Non précisé';
      })();

      await write('status', { state: 'summarizing' });
      const summary = await generateDocumentSummary({
        lang: lang === 'en' ? 'en' : 'fr',
        docTitle,
        nbPages,
        fullWords: nbWords,
        documentText: clipped,
        streamId,
        signal,
      });

      // For large documents: auto-generate a detailed summary (~10k words) and store it in data.
      // This is persisted so it is visible in db-query and reusable by tools.
      const wordsAsNumber = Number(nbWords);
      let detailedSummary: string | null = null;
      let detailedSummaryWords: number | null = null;
      if (Number.isFinite(wordsAsNumber) && wordsAsNumber > 10_000) {
        await write('status', { state: 'summarizing_detailed' });
        const detailed = await generateDocumentDetailedSummary({
          text,
          filename: doc.filename,
          lang: lang === 'en' ? 'en' : 'fr',
          streamId,
          signal,
        });
        const policy = getDocumentDetailedSummaryPolicy();
        if (!detailed.detailedSummary.trim() || detailed.words < policy.detailedSummaryMinWords) {
          throw new Error(
            `Résumé détaillé insuffisant: ${detailed.words} mots (min ${policy.detailedSummaryMinWords}). Relancer le job.`
          );
        }
        detailedSummary = detailed.detailedSummary;
        detailedSummaryWords = detailed.words;
      }

      const nextData = {
        ...(doc.data && typeof doc.data === 'object' ? (doc.data as Record<string, unknown>) : {}),
        summary,
        summaryLang: lang,
        extracted: {
          title: docTitle,
          pages: nbPages === 'Non précisé' ? null : Number(nbPages),
          words: nbWords === 'Non précisé' ? null : Number(nbWords),
        },
        prompts: {
          summaryPromptId: 'document_summary',
        }
      };

      const dataWithDetailed: Record<string, unknown> = detailedSummary
        ? {
            ...nextData,
            detailedSummary,
            detailedSummaryLang: lang,
            detailedSummaryWords,
            detailed_summary: detailedSummary,
            detailed_summary_lang: lang,
            detailed_summary_words: detailedSummaryWords,
            prompts: { ...(nextData.prompts as Record<string, unknown>), detailedPromptId: 'document_detailed_summary' }
          }
        : nextData;

      await db
        .update(contextDocuments)
        .set({ status: 'ready', data: dataWithDetailed, updatedAt: new Date() })
        .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));

      await write('done', { state: 'done' });
    } catch (error) {
      // IMPORTANT: always reflect failure on the document row itself so the UI can show `failed`
      // even if the outer job error propagation fails for any reason.
      try {
        const msg = error instanceof Error ? error.message : String(error);
        const safe = this.sanitizePgText(`Échec: ${msg}`).slice(0, 5000);
        await db.run(sql`
          UPDATE context_documents
          SET status = 'failed',
              data = jsonb_set(coalesce(data, '{}'::jsonb), '{summary}', to_jsonb(${safe}), true),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${documentId} AND workspace_id = ${workspaceId}
        `);
      } catch {
        // ignore
      }
      throw error;
    }

    // History event
    let seq = await this.getNextModificationSequence(doc.contextType, doc.contextId);
    await db.insert(contextModificationHistory).values({
      id: createId(),
      contextType: doc.contextType,
      contextId: doc.contextId,
      sessionId: null,
      messageId: null,
      field: 'document_summarized',
      oldValue: null,
      newValue: { documentId, status: 'ready', summaryLang: lang },
      toolCallId: null,
      promptId: null,
      promptType: null,
      promptVersionId: null,
      jobId,
      sequence: seq,
      createdAt: new Date(),
    });
    seq += 1;
  }

  /**
   * Worker: generate DOCX asynchronously in publishing queue.
   * Result binary is stored in job_queue.result as base64 for direct download endpoint.
   */
  private async processDocxGenerate(
    data: DocxGenerateJobData,
    jobId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const streamId = `job_${jobId}`;
    let emitStatusChain: Promise<void> = Promise.resolve();

    const emitStatus = async (
      state: string,
      progress: number,
      extra: Record<string, unknown> = {}
    ) => {
      emitStatusChain = emitStatusChain
        .catch(() => {
          // Keep the chain alive even if a previous status emission failed.
        })
        .then(async () => {
          const payload = {
            state,
            progress,
            ...extra,
            updatedAt: new Date().toISOString(),
          };
          await db.run(sql`
            UPDATE job_queue
            SET result = ${JSON.stringify(payload)}
            WHERE id = ${jobId}
          `);
          await this.notifyJobEvent(jobId);
          const seq = await getNextSequence(streamId);
          await writeStreamEvent(streamId, 'status', payload, seq);
        });

      await emitStatusChain;
    };

    const isAbort = (error: unknown): boolean => {
      if (!error) return false;
      if (error instanceof DOMException && error.name === 'AbortError') return true;
      if (error instanceof Error && error.name === 'AbortError') return true;
      const message = error instanceof Error ? error.message : String(error);
      return message.includes('AbortError') || message.includes('aborted');
    };

    const [jobRow] = await db
      .select({ workspaceId: jobQueue.workspaceId })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    if (!jobRow?.workspaceId) {
      throw new Error('Docx job workspace not found');
    }

    await emitStatus('queued', 0, {
      templateId: data.templateId,
      entityType: data.entityType,
      entityId: data.entityId,
      queueClass: 'publishing',
    });

    try {
      if (signal?.aborted) {
        throw new DOMException('Docx generation cancelled', 'AbortError');
      }

      await emitStatus('loading_data', 10);

      const result = await runDocxGenerationInWorker({
        input: {
        templateId: data.templateId,
        entityType: data.entityType,
        entityId: data.entityId,
        workspaceId: jobRow.workspaceId,
        provided: data.provided ?? {},
        controls: data.controls ?? {},
        locale: data.locale,
        requestId: data.requestId ?? jobId,
        },
        signal,
        onProgress: async (event) => {
          const progress = typeof event.progress === 'number' ? event.progress : 50;
          await emitStatus(event.state || 'rendering', progress, {
            current: event.current,
            total: event.total,
            message: event.message,
          });
        },
      });

      if (signal?.aborted) {
        throw new DOMException('Docx generation cancelled', 'AbortError');
      }

      await emitStatus('packaging', 98, {
        fileName: result.fileName,
        mimeType: result.mimeType,
      });

      const bucket = getDocumentsBucketName();
      const objectKey = `docx-cache/${jobRow.workspaceId}/${data.templateId}/${data.entityType}/${data.entityId}/${jobId}.docx`;
      await putObject({
        bucket,
        key: objectKey,
        body: result.buffer,
        contentType: result.mimeType,
      });

      const finalPayload = {
        state: 'done',
        progress: 100,
        fileName: result.fileName,
        mimeType: result.mimeType,
        byteLength: result.buffer.byteLength,
        storageBucket: bucket,
        storageKey: objectKey,
        sourceHash: typeof data.sourceHash === 'string' ? data.sourceHash : null,
        queueClass: 'publishing',
        completedAt: new Date().toISOString(),
      };

      await db.run(sql`
        UPDATE job_queue
        SET result = ${JSON.stringify(finalPayload)}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      const seq = await getNextSequence(streamId);
      await writeStreamEvent(streamId, 'done', finalPayload, seq);
    } catch (error) {
      if (isAbort(error)) {
        await emitStatus('cancelled', 0, {
          message: error instanceof Error ? error.message : 'Docx generation cancelled',
        });
      } else {
        await emitStatus('failed', 0, {
          message: error instanceof Error ? error.message : 'Docx generation failed',
        });
      }
      throw error;
    }
  }

  /**
   * Worker pour la génération de liste de cas d'usage
   */
  private async processUseCaseList(data: UseCaseListJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, input, organizationId, matrixMode, model, useCaseCount } = data;

    const [folder] = await db
      .select({
        id: folders.id,
        workspaceId: folders.workspaceId,
        name: folders.name,
        description: folders.description,
        organizationId: folders.organizationId,
      })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) {
      throw new Error('Folder not found');
    }
    const workspaceId = folder.workspaceId;
    const resolvedOrganizationId = organizationId ?? folder.organizationId ?? undefined;
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer les informations de l'organisation si nécessaire
    let organizationInfo = '';
    if (resolvedOrganizationId) {
      try {
        const [org] = await db
          .select()
          .from(organizations)
          .where(and(eq(organizations.id, resolvedOrganizationId), eq(organizations.workspaceId, workspaceId)));
        if (org) {
          const orgData = parseOrgData(org.data);
          organizationInfo = JSON.stringify({
            name: org.name,
            industry: orgData.industry,
            size: orgData.size,
            products: orgData.products,
            processes: orgData.processes,
            challenges: orgData.challenges,
            objectives: orgData.objectives,
            technologies: orgData.technologies
          }, null, 2);
          console.log(`📊 Organization info loaded for ${org.name}:`, organizationInfo);
        } else {
          console.warn(`⚠️ Organization not found with id: ${resolvedOrganizationId}`);
        }
      } catch (error) {
        console.warn('Error fetching organization info:', error);
      }
    } else {
      console.log('ℹ️ Aucune entreprise sélectionnée pour cette génération');
    }

    const documentsContexts = await this.getDocumentsContextsForGeneration({
      workspaceId,
      folderId,
      organizationId: resolvedOrganizationId,
    });
    const documentsContextJson = await this.buildDocumentsContextJsonForGeneration({
      workspaceId,
      contexts: documentsContexts.map((c) => ({ contextType: c.contextType, contextId: c.contextId })),
      // Single budget only (no separate doc-count cap): ~100k words equivalent in chars.
      maxChars: 600_000,
    });

    const userFolderName =
      typeof folder.name === 'string' && folder.name.trim() && folder.name.trim() !== 'Brouillon' && !folder.name.startsWith('Génération -')
        ? folder.name.trim()
        : '';

    // Générer la liste de cas d'usage
    const streamId = `folder_${folderId}`;
    const useCaseList = await generateUseCaseList(
      input,
      organizationInfo,
      selectedModel,
      useCaseCount,
      userFolderName,
      documentsContexts,
      documentsContextJson,
      signal,
      streamId
    );
    
    // Mettre à jour le nom du dossier
    // - si l'utilisateur a fourni un nom: le préserver
    // - sinon: utiliser le nom généré par l'IA (et ne jamais conserver "Brouillon" comme titre final)
    const generatedFolderName =
      typeof useCaseList.dossier === 'string' && useCaseList.dossier.trim() && useCaseList.dossier.trim() !== 'Brouillon'
        ? useCaseList.dossier.trim()
        : '';
    const nextFolderName = userFolderName || generatedFolderName;
    if (nextFolderName) {
      const shouldFillDescription = !folder.description || !folder.description.trim();
      await db
        .update(folders)
        .set({
          name: nextFolderName,
          ...(shouldFillDescription ? { description: input } : {}),
        })
        .where(eq(folders.id, folderId));
      console.log(`📁 Folder updated: ${nextFolderName} (ID: ${folderId}, Org: ${resolvedOrganizationId || 'None'})`);
      await this.notifyFolderEvent(folderId);
    }

    // Créer les cas d'usage en mode generating
    // Note: UseCaseListItem n'a que 'titre', pas 'title'
    const draftUseCases = useCaseList.useCases.map((useCaseItem: UseCaseListItem) => {
      const title = useCaseItem.titre || String(useCaseItem);
      const useCaseData: UseCaseData = {
        name: title, // Stocker name dans data
        description: useCaseItem.description || '', // Stocker description dans data
        process: '',
        technologies: [],
        deadline: '',
        contact: '',
        benefits: [],
        metrics: [],
        risks: [],
        nextSteps: [],
        dataSources: [],
        dataObjects: [],
        valueScores: [],
        complexityScores: []
      };
      return {
        id: createId(),
        workspaceId,
        folderId: folderId,
        organizationId: organizationId || null,
        data: useCaseData as UseCaseDataJson, // Drizzle accepte JSONB directement (inclut name et description)
        model: selectedModel,
        status: 'generating',
        createdAt: new Date()
      };
    });

    // Insérer les cas d'usage
    await db.insert(useCases).values(draftUseCases);
    for (const uc of draftUseCases) {
      await this.notifyUseCaseEvent(uc.id);
    }

    // Marquer le dossier comme terminé
    await db.update(folders)
      .set({ status: 'completed' })
      .where(eq(folders.id, folderId));
    await this.notifyFolderEvent(folderId);

    // Auto-déclencher le détail de tous les cas d'usage (sauf si pause/cancel en cours)
    if (this.cancelAllInProgress || this.paused) {
      console.warn('⏸️ Skipping auto-enqueue of usecase_detail due to pause/cancel');
    } else {
      for (const useCase of draftUseCases) {
        try {
          // Extraire name depuis data
          const useCaseName = (useCase.data as UseCaseData)?.name || 'Cas d\'usage sans nom';
          await this.addJob('usecase_detail', {
            useCaseId: useCase.id,
            useCaseName: useCaseName,
            folderId: folderId,
            matrixMode,
            model: selectedModel
          }, { workspaceId, maxRetries: 1 });
        } catch (e) {
          console.warn('Skipped enqueue usecase_detail:', (e as Error).message);
        }
      }
    }

    console.log(`📋 Generated ${draftUseCases.length} use cases and queued for detailing`);
  }

  private async getLatestMatrixJobState(folderId: string): Promise<{ status: string; error: string | null } | null> {
    const rows = (await db.all(sql`
      SELECT status, error
      FROM job_queue
      WHERE type = 'matrix_generate'
        AND (data::jsonb ->> 'folderId') = ${folderId}
      ORDER BY created_at DESC
      LIMIT 1
    `)) as Array<{ status: string; error: string | null }>;
    return rows[0] ?? null;
  }

  private async waitForGeneratedMatrix(folderId: string, signal?: AbortSignal, timeoutMs = 180000, pollMs = 1500): Promise<MatrixConfig> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw new Error('Matrix wait aborted');

      const [folder] = await db
        .select({ matrixConfig: folders.matrixConfig })
        .from(folders)
        .where(eq(folders.id, folderId))
        .limit(1);

      const parsed = parseMatrixConfig(folder?.matrixConfig ?? null);
      if (parsed) return parsed;

      const matrixJob = await this.getLatestMatrixJobState(folderId);
      if (matrixJob?.status === 'failed') {
        throw new Error(matrixJob.error || 'Matrix generation failed');
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error('Matrix generation timed out');
  }

  /**
   * Worker pour le détail d'un cas d'usage
   */
  private async processUseCaseDetail(data: UseCaseDetailJobData, signal?: AbortSignal): Promise<void> {
    const { useCaseId, useCaseName, folderId, matrixMode, model } = data;
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer la configuration de la matrice
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    if (!folder) {
      throw new Error('Dossier non trouvé');
    }
    
    let matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    if (!matrixConfig && matrixMode === 'generate') {
      matrixConfig = await this.waitForGeneratedMatrix(folderId, signal);
    }
    if (!matrixConfig) throw new Error('Configuration de matrice non trouvée');
    
    // Organization info (prompt uses organization_info)
    let organizationInfo = '';
    if (folder.organizationId) {
      try {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, folder.organizationId));
        if (org) {
          const orgData = parseOrgData(org.data);
          organizationInfo = JSON.stringify(
            {
              name: org.name,
              industry: orgData.industry,
              size: orgData.size,
              products: orgData.products,
              processes: orgData.processes,
              challenges: orgData.challenges,
              objectives: orgData.objectives,
              technologies: orgData.technologies
            },
            null,
            2
          );
          console.log(`📊 Organization info loaded for ${org.name}:`, organizationInfo);
        } else {
          console.warn(`⚠️ Organization not found with id: ${folder.organizationId}`);
        }
      } catch (error) {
        console.error('Error fetching organization:', error);
      }
    }
    
    const context = folder.description || '';

    const documentsContexts = await this.getDocumentsContextsForGeneration({
      workspaceId: folder.workspaceId,
      folderId,
      organizationId: folder.organizationId,
    });
    const documentsContextJson = await this.buildDocumentsContextJsonForGeneration({
      workspaceId: folder.workspaceId,
      contexts: documentsContexts.map((c) => ({ contextType: c.contextType, contextId: c.contextId })),
      // Single budget only (no separate doc-count cap): ~100k words equivalent in chars.
      maxChars: 600_000,
    });
    
    // Générer le détail
    const streamId = `usecase_${useCaseId}`;
    const useCaseDetail = await generateUseCaseDetail(
      useCaseName,
      context,
      matrixConfig,
      organizationInfo,
      selectedModel,
      documentsContexts,
      documentsContextJson,
      signal,
      streamId
    );
    
    // Valider les scores générés
    const validation = validateScores(matrixConfig, useCaseDetail.valueScores, useCaseDetail.complexityScores);
    
    if (!validation.isValid) {
      console.warn(`⚠️ Scores invalides pour ${useCaseName}:`, validation.errors);
      console.log(`🔧 Correction automatique des scores...`);
      
      // Corriger les scores
      const fixedScores = fixScores(matrixConfig, useCaseDetail.valueScores, useCaseDetail.complexityScores);
      useCaseDetail.valueScores = fixedScores.valueScores;
      useCaseDetail.complexityScores = fixedScores.complexityScores;
      
      console.log(`✅ Scores corrigés:`, {
        valueAxes: useCaseDetail.valueScores.length,
        complexityAxes: useCaseDetail.complexityScores.length
      });
    } else {
      console.log(`✅ Scores valides pour ${useCaseName}`);
    }
    
    if (validation.warnings.length > 0) {
      console.warn(`⚠️ Avertissements pour ${useCaseName}:`, validation.warnings);
    }
    
    // Récupérer le cas d'usage existant pour préserver name et description s'ils existent déjà
    const [existingUseCase] = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, folder.workspaceId)));
    let existingData: Partial<UseCaseData> = {};
    if (existingUseCase?.data) {
      try {
        if (typeof existingUseCase.data === 'object') {
          existingData = existingUseCase.data as UseCaseData;
        } else if (typeof existingUseCase.data === 'string') {
          existingData = JSON.parse(existingUseCase.data) as UseCaseData;
        }
      } catch (error) {
        // Ignorer les erreurs de parsing
      }
    }
    
    // Construire l'objet data JSONB (préserver name et description existants, ou utiliser ceux du détail)
    const useCaseData: UseCaseData = {
      name: existingData.name || useCaseDetail.name, // Préserver name existant ou utiliser celui du détail
      description: existingData.description || useCaseDetail.description, // Préserver description existante ou utiliser celle du détail
      problem: useCaseDetail.problem,
      solution: useCaseDetail.solution,
      process: useCaseDetail.domain, // domain du prompt -> process en DB
      domain: useCaseDetail.domain,
      technologies: useCaseDetail.technologies,
      prerequisites: useCaseDetail.prerequisites,
      deadline: useCaseDetail.leadtime, // leadtime du prompt -> deadline en DB
      contact: useCaseDetail.contact,
      benefits: useCaseDetail.benefits,
      constraints: useCaseDetail.constraints,
      metrics: useCaseDetail.metrics,
      risks: useCaseDetail.risks,
      nextSteps: useCaseDetail.nextSteps,
      dataSources: useCaseDetail.dataSources,
      dataObjects: useCaseDetail.dataObjects,
      references: useCaseDetail.references || [],
      valueScores: useCaseDetail.valueScores,
      complexityScores: useCaseDetail.complexityScores
    };
    
    // Mettre à jour le cas d'usage
    // Note: Toutes les colonnes métier (prerequisites, deadline, contact, benefits, etc.) sont maintenant dans data JSONB (migration 0008)
    // On met à jour uniquement data qui contient toutes les colonnes métier
    await db.update(useCases)
      .set({
        data: useCaseData as UseCaseDataJson, // Drizzle accepte JSONB directement (inclut name, description, domain, technologies, prerequisites, deadline, contact, benefits, etc.)
        model: selectedModel,
        status: 'completed'
      })
      .where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, folder.workspaceId)));
    await this.notifyUseCaseEvent(useCaseId);

    // Vérifier si tous les use cases du dossier sont complétés
    const allUseCases = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.folderId, folderId), eq(useCases.workspaceId, folder.workspaceId)));
    const allCompleted = allUseCases.length > 0 && allUseCases.every(uc => uc.status === 'completed');

    if (allCompleted) {
      // Vérifier si une synthèse exécutive existe déjà
      const [currentFolder] = await db
        .select()
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, folder.workspaceId)));
      const hasExecutiveSummary = currentFolder?.executiveSummary;

      if (!hasExecutiveSummary) {
        console.log(`✅ Tous les use cases du dossier ${folderId} sont complétés, déclenchement de la génération de la synthèse exécutive`);
        
        // Mettre à jour le statut du dossier
        await db.update(folders)
          .set({ status: 'generating' })
          .where(and(eq(folders.id, folderId), eq(folders.workspaceId, folder.workspaceId)));
        await this.notifyFolderEvent(folderId);

        // Ajouter le job de génération de synthèse exécutive
        try {
          await this.addJob('executive_summary', {
            folderId,
            model: selectedModel
          }, { workspaceId: folder.workspaceId });
          console.log(`📝 Job executive_summary ajouté pour le dossier ${folderId}`);
        } catch (error) {
          console.error(`❌ Erreur lors de l'ajout du job executive_summary:`, error);
          // Ne pas faire échouer le job usecase_detail si l'ajout du job executive_summary échoue
        }
      } else {
        console.log(`ℹ️ Le dossier ${folderId} a déjà une synthèse exécutive, pas de régénération automatique`);
      }
    }
  }

  /**
   * Worker pour la génération de synthèse exécutive
   */
  private async processExecutiveSummary(data: ExecutiveSummaryJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, valueThreshold, complexityThreshold, model } = data;

    console.log(`📊 Génération de la synthèse exécutive pour le dossier ${folderId}`);

    // Générer la synthèse exécutive
    await generateExecutiveSummary({
      folderId,
      valueThreshold,
      complexityThreshold,
      model,
      signal,
      streamId: `folder_${folderId}`
    });

    const [folder] = await db
      .select({ workspaceId: folders.workspaceId })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (folder?.workspaceId) {
      await this.invalidateDocxCacheForEntity({
        workspaceId: folder.workspaceId,
        templateId: 'executive-synthesis-multipage',
        entityType: 'folder',
        entityId: folderId,
      });
    }

    // Mettre à jour le statut du dossier à 'completed'
    await db.update(folders)
      .set({ status: 'completed' })
      .where(eq(folders.id, folderId));
    await this.notifyFolderEvent(folderId);

    console.log(`✅ Synthèse exécutive générée et stockée pour le dossier ${folderId}`);
  }

  /**
   * Worker chat (réponse assistant)
   * NOTE: on réutilise la table job_queue (type = chat_message) pour préparer le scaling via workers dédiés.
   */
  private async processChatMessage(data: ChatMessageJobData, signal?: AbortSignal): Promise<void> {
    const { userId, sessionId, assistantMessageId, model, contexts, tools } = data;
    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model: model ?? null,
      contexts,
      tools,
      signal
    });
  }

  /**
   * Obtenir le statut d'un job
   */
  async getJobStatus(jobId: string, opts?: { includeBinaryResult?: boolean }): Promise<Job | null> {
    const result = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    
    if (!result || result.length === 0) return null;
    
    const row = result[0];
    return {
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result:
        opts?.includeBinaryResult === true
          ? parseJsonField(row.result)
          : sanitizeJobResultForPublic(parseJsonField(row.result)),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      // Drizzle retourne createdAt, startedAt, completedAt en camelCase
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined
    };
  }

  /**
   * Obtenir tous les jobs
   */
  async getAllJobs(opts?: { workspaceId?: string }): Promise<Job[]> {
    const results = await db
      .select()
      .from(jobQueue)
      .where(opts?.workspaceId ? eq(jobQueue.workspaceId, opts.workspaceId) : undefined)
      .orderBy(desc(jobQueue.createdAt));
    
    return results.map((row) => ({
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result: sanitizeJobResultForPublic(parseJsonField(row.result)),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      // Drizzle retourne createdAt, startedAt, completedAt en camelCase
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined
    }));
  }

  async findLatestDocxJobBySource(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
    sourceHash: string;
  }): Promise<Job | null> {
    const jobs = await this.listDocxJobsForEntity(params);
    for (const job of jobs) {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const result = (job.result ?? {}) as Record<string, unknown>;
      const sourceHash =
        typeof result.sourceHash === 'string'
          ? result.sourceHash
          : typeof data.sourceHash === 'string'
            ? data.sourceHash
            : '';
      if (sourceHash !== params.sourceHash) continue;

      if (job.status === 'completed') {
        const storageKey = typeof result.storageKey === 'string' ? result.storageKey : '';
        const storageBucket =
          typeof result.storageBucket === 'string' && result.storageBucket.trim().length > 0
            ? result.storageBucket
            : getDocumentsBucketName();
        if (!storageKey) continue;
        try {
          await headObject({ bucket: storageBucket, key: storageKey });
        } catch {
          continue;
        }
      }
      return job;
    }
    return null;
  }

  async invalidateDocxCacheForEntity(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
    keepSourceHash?: string;
  }): Promise<number> {
    const jobs = await this.listDocxJobsForEntity(params);
    let purged = 0;

    for (const job of jobs) {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const result = (job.result ?? {}) as Record<string, unknown>;
      const sourceHash =
        typeof result.sourceHash === 'string'
          ? result.sourceHash
          : typeof data.sourceHash === 'string'
            ? data.sourceHash
            : null;
      if (params.keepSourceHash && sourceHash === params.keepSourceHash) {
        continue;
      }

      if (job.status === 'processing' || job.status === 'pending') {
        try {
          await this.cancelJob(job.id, 'docx-cache-invalidated');
        } catch {
          // ignore
        }
      }

      const storageKey = typeof result.storageKey === 'string' ? result.storageKey : '';
      if (storageKey) {
        const storageBucket =
          typeof result.storageBucket === 'string' && result.storageBucket.trim().length > 0
            ? result.storageBucket
            : getDocumentsBucketName();
        try {
          await deleteObject({ bucket: storageBucket, key: storageKey });
        } catch {
          // ignore: object may already be missing
        }
      }

      await db.delete(jobQueue).where(eq(jobQueue.id, job.id));
      purged += 1;
    }

    return purged;
  }

  private async listDocxJobsForEntity(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
  }): Promise<Job[]> {
    const rows = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.workspaceId, params.workspaceId), eq(jobQueue.type, 'docx_generate')))
      .orderBy(desc(jobQueue.createdAt))
      .limit(200);

    const matches = rows.filter((row) => {
      const data = (parseJsonField<DocxGenerateJobData>(row.data) ?? {}) as DocxGenerateJobData;
      return (
        data.templateId === params.templateId &&
        data.entityType === params.entityType &&
        data.entityId === params.entityId
      );
    });

    return matches.map((row) => ({
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result: parseJsonField(row.result),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined,
    }));
  }
}

// Instance singleton
export const queueManager = new QueueManager();
