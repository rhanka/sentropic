import { db, pool } from '../db/client';
import { and, sql, eq, desc } from 'drizzle-orm';
import { createId } from '../utils/id';
import { enrichOrganization, type OrganizationData } from './context-organization';
import { generateUseCaseList, generateUseCaseDetail, type UseCaseListItem } from './context-usecase';
import { parseMatrixConfig } from '../utils/matrix';
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
import { getDocumentsBucketName, getObjectBytes } from './storage-s3';
import { extractDocumentInfoFromDocument } from './document-text';
import { defaultPrompts } from '../config/default-prompts';
import { executeWithToolsStream } from './tools';
import { getNextSequence, writeStreamEvent } from './stream-service';

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

export type JobType =
  | 'organization_enrich'
  | 'usecase_list'
  | 'usecase_detail'
  | 'executive_summary'
  | 'chat_message'
  | 'document_summary';

export interface OrganizationEnrichJobData {
  organizationId: string;
  organizationName: string;
  model?: string;
}

export interface UseCaseListJobData {
  folderId: string;
  input: string;
  organizationId?: string;
  model?: string;
  useCaseCount?: number;
}

export interface UseCaseDetailJobData {
  useCaseId: string;
  useCaseName: string;
  folderId: string;
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
}

export interface DocumentSummaryJobData {
  documentId: string;
  lang?: string; // default: 'fr'
  model?: string;
}

export type JobData =
  | OrganizationEnrichJobData
  | UseCaseListJobData
  | UseCaseDetailJobData
  | ExecutiveSummaryJobData
  | ChatMessageJobData
  | DocumentSummaryJobData;

export interface Job {
  id: string;
  type: JobType;
  data: JobData;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workspaceId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export class QueueManager {
  private isProcessing = false;
  private maxConcurrentJobs = 10; // Limite de concurrence par défaut
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
   * Charger les paramètres de configuration
   */
  private async loadSettings(): Promise<void> {
    try {
      const settings = await settingsService.getAISettings();
      this.maxConcurrentJobs = settings.concurrency;
      this.processingInterval = settings.processingInterval;
      console.log(`🔧 Queue settings loaded: concurrency=${this.maxConcurrentJobs}, interval=${this.processingInterval}ms`);
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

  async drain(timeoutMs: number = 10000): Promise<void> {
    const start = Date.now();
    while (this.jobControllers.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * Ajouter un job à la queue
   */
  async addJob(type: JobType, data: JobData, opts?: { workspaceId?: string }): Promise<string> {
    if (this.cancelAllInProgress || this.paused) {
      console.warn(`⏸️ Queue paused/cancelling, refusing to enqueue job ${type}`);
      throw new Error('Queue is paused or cancelling; job not accepted');
    }
    const jobId = createId();
    const workspaceId = opts?.workspaceId ?? ADMIN_WORKSPACE_ID;
    
    await db.run(sql`
      INSERT INTO job_queue (id, type, data, status, created_at, workspace_id)
      VALUES (${jobId}, ${type}, ${JSON.stringify(data)}, 'pending', ${new Date()}, ${workspaceId})
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

      const sleep = async (ms: number) => new Promise((r) => setTimeout(r, ms));

      const getGlobalProcessingCount = async (): Promise<number> => {
        try {
          const rows = (await db.all(sql`
            SELECT COUNT(*)::int AS count
            FROM job_queue
            WHERE status = 'processing'
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

      const claimPendingJobs = async (limit: number): Promise<JobQueueRow[]> => {
        if (limit <= 0) return [];
        // GLOBAL concurrency: we claim jobs in DB atomically. This prevents over-parallelization across workers
        // and ensures the configured limit applies to the sum of all job types.
        const now = new Date();
        const rows = (await db.all(sql`
          WITH picked AS (
            SELECT id
            FROM job_queue
          WHERE status = 'pending'
          ORDER BY
            CASE type
              WHEN 'chat_message' THEN 0
              WHEN 'usecase_list' THEN 1
              ELSE 2
            END,
            created_at ASC
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

        // Fill available slots continuously (don't wait for a whole batch to finish).
        // IMPORTANT: slots are computed from the GLOBAL processing count in DB,
        // so the configured limit applies to the sum of all queues (all types) and across workers.
        const globalProcessing = await getGlobalProcessingCount();
        const slots = Math.max(0, this.maxConcurrentJobs - globalProcessing);
        if (slots > 0) {
          const claimedJobs = await claimPendingJobs(slots);
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
    const jobData = JSON.parse(job.data);

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
          await this.processOrganizationEnrich(jobData as OrganizationEnrichJobData, jobId, controller.signal);
          break;
        case 'usecase_list':
          await this.processUseCaseList(jobData as UseCaseListJobData, controller.signal);
          break;
        case 'usecase_detail':
          await this.processUseCaseDetail(jobData as UseCaseDetailJobData, controller.signal);
          break;
        case 'executive_summary':
          await this.processExecutiveSummary(jobData as ExecutiveSummaryJobData, controller.signal);
          break;
        case 'chat_message':
          await this.processChatMessage(jobData as ChatMessageJobData, controller.signal);
          break;
        case 'document_summary':
          await this.processDocumentSummary(
            jobData as DocumentSummaryJobData,
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
            await db
              .update(contextDocuments)
              .set({
                status: 'failed',
                summary: this.sanitizePgText(`Échec: ${msg}`).slice(0, 5000),
                updatedAt: new Date(),
              })
              .where(eq(contextDocuments.id, docId));

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
    const cleanedReferences = Array.isArray(enrichedData.references)
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
      nextRefs: Array<{ title: string; url: string; excerpt?: string }>
    ): Array<{ title: string; url: string; excerpt?: string }> => {
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
        merged.push(r);
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
      references: mergeRefs(existingData.references, cleanedData.references ?? []),
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

  private countWords(text: string): number {
    const t = (text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/g).filter(Boolean).length;
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

  private async generateDetailedSummaryFromText(opts: {
    text: string;
    filename: string;
    lang: string;
    model: string;
    streamId: string;
    signal?: AbortSignal;
  }): Promise<{ detailedSummary: string; words: number; clipped: boolean }> {
    const maxWords = 10_000;
    const fullText = (opts.text || '').trim();
    const chunks = this.chunkByWords(fullText, 4500);

    // 1) Summarize each chunk (best-effort, bounded)
    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i]!;
      const chunkPrompt =
        `Tu es un assistant qui résume fidèlement un extrait de document métier.\n` +
        `Contraintes:\n` +
        `- Réponds en ${opts.lang}.\n` +
        `- Format: markdown.\n` +
        `- Pas d'invention.\n` +
        `- Vise ~800-1200 mots max.\n\n` +
        `Document: ${opts.filename}\n` +
        `Partie ${i + 1}/${chunks.length}\n\n` +
        `TEXTE:\n---\n${chunkText}\n---\n\n` +
        `Résume cette partie de façon détaillée (faits, chiffres, obligations, risques, acteurs, échéances).`;

      const { content: chunkContent } = await executeWithToolsStream(chunkPrompt, {
        model: opts.model,
        streamId: opts.streamId,
        promptId: 'document_detailed_summary_part',
        signal: opts.signal
      });
      chunkSummaries.push(this.sanitizePgText(chunkContent).trim());
    }

    // 2) Merge chunk summaries into a single detailed summary (strict maxWords)
    const mergeInput = chunkSummaries.map((s, i) => `### Partie ${i + 1}\n${s}`).join('\n\n');
    const finalPrompt =
      `Tu es un assistant qui produit un résumé détaillé et fidèle d'un document métier.\n` +
      `Contraintes:\n` +
      `- Réponds en ${opts.lang}.\n` +
      `- Format: markdown.\n` +
      `- Pas d'invention: si l'info n'est pas dans le texte, dis-le.\n` +
      `- Longueur: maximum ${maxWords} mots.\n\n` +
      `Document: ${opts.filename}\n\n` +
      `Source (résumés de parties):\n---\n${mergeInput}\n---\n\n` +
      `Produit un résumé détaillé fidèle du document.\n` +
      `Format recommandé:\n` +
      `1) Résumé détaillé\n` +
      `2) Faits & chiffres clés\n` +
      `3) Obligations / exigences\n` +
      `4) Risques / points d'attention\n` +
      `5) Points actionnables (si applicable)\n`;

    const { content: merged } = await executeWithToolsStream(finalPrompt, {
      model: opts.model,
      streamId: opts.streamId,
      promptId: 'document_detailed_summary',
      signal: opts.signal
    });
    const raw = this.sanitizePgText(merged).trim();
    const trimmed = this.trimToMaxWords(raw, maxWords);
    return { detailedSummary: trimmed.text, words: trimmed.words, clipped: trimmed.trimmed };
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

    await db
      .update(contextDocuments)
      .set({ status: 'processing', jobId, updatedAt: new Date() })
      .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));

    const bucket = getDocumentsBucketName();
    const bytes = await getObjectBytes({ bucket, key: doc.storageKey });
    let text: string;
    let extractedMetaTitle: string | undefined;
    let extractedMetaPages: number | undefined;
    try {
      await write('status', { state: 'extracting' });
      const extracted = await extractDocumentInfoFromDocument({ bytes, filename: doc.filename, mimeType: doc.mimeType });
      text = extracted.text;
      extractedMetaTitle = extracted.metadata.title;
      extractedMetaPages = extracted.metadata.pages;
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

    const template = defaultPrompts.find((p) => p.id === 'document_summary')?.content || '';
    if (!template) throw new Error('Prompt document_summary non trouvé');
    const docTitleRaw = (extractedMetaTitle || doc.filename || '-').trim() || '-';
    const docTitle = docTitleRaw === '-' ? 'Non précisé' : docTitleRaw;
    const nbPages =
      typeof extractedMetaPages === 'number' && extractedMetaPages > 0 ? String(extractedMetaPages) : 'Non précisé';
    const nbWords = (() => {
      // Use full extracted text when available; fallback to clipped (aligned with what we send to the model).
      const fromFull = text.split(/\s+/).filter(Boolean).length;
      if (Number.isFinite(fromFull) && fromFull > 0) return String(fromFull);
      const fromClipped = clipped.split(/\s+/).filter(Boolean).length;
      return Number.isFinite(fromClipped) && fromClipped > 0 ? String(fromClipped) : 'Non précisé';
    })();

    const userPrompt = template
      .replace('{{lang}}', lang)
      .replace('{{doc_title}}', docTitle)
      .replace('{{nb_pages}}', nbPages)
      .replace('{{nb_mots}}', nbWords)
      .replace('{{document_text}}', clipped);

    // Reinforce: provide deterministic metadata and require copying them verbatim in the "Fiche document" section.
    const providedMetaBlock = `\n\nDONNÉES FOURNIES (à recopier telles quelles dans "## Fiche document (réexamen)")\n- doc_title: ${docTitle}\n- nb_pages: ${nbPages}\n- nb_mots: ${nbWords}\n\nRègle stricte:\n- Dans la section "## Fiche document (réexamen)", le champ **Titre** doit être exactement doc_title.\n- Dans la section "## Fiche document (réexamen)", le champ **Taille** doit être exactement "${nbPages} pages ; ${nbWords} mots" (et uniquement "Non précisé" si nb_pages/nb_mots valent "Non précisé").\n`;
    const finalPrompt = userPrompt + providedMetaBlock;

    await write('status', { state: 'summarizing' });
    // IMPORTANT (temporary): for document summary + sub-summaries, we force a dedicated model.
    // We intentionally IGNORE:
    // - the admin-configured default model (settingsService.getAISettings().defaultModel)
    // - any model passed via job payload
    // Until prompts/models are versioned in DB and selectable per prompt.
    const selectedModel = 'gpt-4.1-nano';
    const { content: streamedContent } = await executeWithToolsStream(finalPrompt, {
      model: selectedModel,
      streamId,
      promptId: 'document_summary',
      signal,
    });

    const summary = this.sanitizePgText(streamedContent).trim();
    if (!summary) throw new Error('Empty summary');

    // For large documents: auto-generate a detailed summary (~10k words) and store it in data.
    // This is persisted so it is visible in db-query and reusable by tools.
    const wordsAsNumber = Number(nbWords);
    let detailedSummary: string | null = null;
    let detailedSummaryWords: number | null = null;
    if (Number.isFinite(wordsAsNumber) && wordsAsNumber > 10_000) {
      await write('status', { state: 'summarizing_detailed' });
      const detailed = await this.generateDetailedSummaryFromText({
        text,
        filename: doc.filename,
        lang,
        model: selectedModel,
        streamId,
        signal
      });
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
   * Worker pour la génération de liste de cas d'usage
   */
  private async processUseCaseList(data: UseCaseListJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, input, organizationId, model, useCaseCount } = data;

    const [folder] = await db
      .select({
        id: folders.id,
        workspaceId: folders.workspaceId,
        name: folders.name,
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
      signal,
      streamId
    );
    
    // Mettre à jour le nom du dossier
    if (useCaseList.dossier) {
      await db.update(folders)
        .set({
          name: useCaseList.dossier,
          description: `Dossier généré automatiquement pour: ${input}`
        })
        .where(eq(folders.id, folderId));
      console.log(`📁 Folder updated: ${useCaseList.dossier} (ID: ${folderId}, Org: ${organizationId || 'None'})`);
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
            model: selectedModel
          }, { workspaceId });
        } catch (e) {
          console.warn('Skipped enqueue usecase_detail:', (e as Error).message);
        }
      }
    }

    console.log(`📋 Generated ${draftUseCases.length} use cases and queued for detailing`);
  }

  /**
   * Worker pour le détail d'un cas d'usage
   */
  private async processUseCaseDetail(data: UseCaseDetailJobData, signal?: AbortSignal): Promise<void> {
    const { useCaseId, useCaseName, folderId, model } = data;
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer la configuration de la matrice
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    if (!folder) {
      throw new Error('Dossier non trouvé');
    }
    
    const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    if (!matrixConfig) {
      throw new Error('Configuration de matrice non trouvée');
    }
    
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
    
    // Générer le détail
    const streamId = `usecase_${useCaseId}`;
    const useCaseDetail = await generateUseCaseDetail(
      useCaseName,
      context,
      matrixConfig,
      organizationInfo,
      selectedModel,
      documentsContexts,
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
    const { userId, sessionId, assistantMessageId, model } = data;
    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      model: model ?? null,
      signal
    });
  }

  /**
   * Obtenir le statut d'un job
   */
  async getJobStatus(jobId: string): Promise<Job | null> {
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
      data: JSON.parse(row.data) as JobData,
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
      data: JSON.parse(row.data) as JobData,
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      // Drizzle retourne createdAt, startedAt, completedAt en camelCase
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined
    }));
  }
}

// Instance singleton
export const queueManager = new QueueManager();
