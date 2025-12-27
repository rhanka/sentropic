import { db, pool } from '../db/client';
import { and, sql, eq, desc } from 'drizzle-orm';
import { createId } from '../utils/id';
import { enrichCompany, type CompanyData } from './context-company';
import { generateUseCaseList, generateUseCaseDetail, type UseCaseListItem } from './context-usecase';
import { parseMatrixConfig } from '../utils/matrix';
import type { UseCaseData, UseCaseDataJson } from '../types/usecase';
import { validateScores, fixScores } from '../utils/score-validation';
import { folders, organizations, useCases, jobQueue, ADMIN_WORKSPACE_ID, type JobQueueRow } from '../db/schema';
import { settingsService } from './settings';
import { generateExecutiveSummary } from './executive-summary';
import { chatService } from './chat-service';

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

export type JobType = 'company_enrich' | 'usecase_list' | 'usecase_detail' | 'executive_summary' | 'chat_message';

export interface CompanyEnrichJobData {
  companyId: string;
  companyName: string;
  model?: string;
}

export interface UseCaseListJobData {
  folderId: string;
  input: string;
  organizationId?: string;
  companyId?: string; // backward-compat alias
  model?: string;
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

export type JobData =
  | CompanyEnrichJobData
  | UseCaseListJobData
  | UseCaseDetailJobData
  | ExecutiveSummaryJobData
  | ChatMessageJobData;

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

      const pickPendingJobs = async (limit: number): Promise<JobQueueRow[]> => {
        if (limit <= 0) return [];
        // Priority: chat > usecase_list > others, then FIFO by created_at.
        // This avoids chat starvation when long jobs (usecase_detail/executive_summary) are running.
        return (await db.all(sql`
          SELECT * FROM job_queue
          WHERE status = 'pending'
          ORDER BY
            CASE type
              WHEN 'chat_message' THEN 0
              WHEN 'usecase_list' THEN 1
              ELSE 2
            END,
            created_at ASC
          LIMIT ${limit}
        `)) as JobQueueRow[];
      };

      while (!this.paused) {
        if (this.cancelAllInProgress) break;

        // Fill available slots continuously (don't wait for a whole batch to finish).
        const slots = Math.max(0, this.maxConcurrentJobs - inFlight.size);
        if (slots > 0) {
          const pendingJobs = await pickPendingJobs(slots);
          for (const job of pendingJobs) {
            const p = this.processJob(job).finally(() => {
              inFlight.delete(p);
            });
            inFlight.add(p);
          }
        }

        // If nothing is running and nothing is pending, we're done.
        if (inFlight.size === 0) {
          const more = await pickPendingJobs(1);
          if (more.length === 0) break;
          // else loop will pick it next iteration
          continue;
        }

        // Wait for at least one job to finish, then continue filling.
        await Promise.race(inFlight);
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

      // Safety: the job may have been purged between SELECT and processing start.
      // If it no longer exists (or is no longer pending), don't execute any expensive work.
      const [current] = await db
        .select({ status: jobQueue.status })
        .from(jobQueue)
        .where(eq(jobQueue.id, jobId))
        .limit(1);
      if (!current || current.status !== 'pending') {
        console.log(`⏭️ Skipping job ${jobId}: missing or not pending (likely purged)`);
        return;
      }
      
      // Marquer comme en cours
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'processing', started_at = ${new Date()}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      const controller = new AbortController();
      this.jobControllers.set(jobId, controller);

      // Traiter selon le type
      switch (jobType) {
        case 'company_enrich':
          await this.processCompanyEnrich(jobData as CompanyEnrichJobData, jobId, controller.signal);
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
    } finally {
      this.jobControllers.delete(jobId);
    }
  }

  /**
   * Worker pour l'enrichissement d'entreprise
   */
  private async processCompanyEnrich(data: CompanyEnrichJobData, jobId: string, signal?: AbortSignal): Promise<void> {
    const { companyId, companyName, model } = data;
    
    // Générer un streamId pour le streaming
    // IMPORTANT:
    // Pour l'enrichissement entreprise, on veut pouvoir suivre l'avancement côté UI avec uniquement le companyId
    // (les job_update peuvent être restreints). Donc on utilise un streamId déterministe basé sur l'entreprise.
    const streamId = `organization_${companyId}`;
    
    // Enrichir l'entreprise avec streaming
    // enrichCompany utilise le streaming si streamId est fourni
    const enrichedData: CompanyData = await enrichCompany(companyName, model, signal, streamId);

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
    const cleanedData: CompanyData = {
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
    
    // Store enriched profile in organizations.data JSONB (legacy prompt shape)
    await db
      .update(organizations)
      .set({
        data: {
          industry: cleanedData.industry,
          size: cleanedData.size,
          products: cleanedData.products,
          processes: cleanedData.processes,
          kpis: cleanedData.kpis,
          challenges: cleanedData.challenges,
          objectives: cleanedData.objectives,
          technologies: cleanedData.technologies,
          references: cleanedData.references ?? [],
        },
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, companyId));

    await this.notifyOrganizationEvent(companyId);
  }

  /**
   * Worker pour la génération de liste de cas d'usage
   */
  private async processUseCaseList(data: UseCaseListJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, input, organizationId, companyId, model } = data;
    const resolvedOrganizationId = organizationId ?? companyId;

    const [folder] = await db
      .select({ id: folders.id, workspaceId: folders.workspaceId })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) {
      throw new Error('Folder not found');
    }
    const workspaceId = folder.workspaceId;
    
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

    // Générer la liste de cas d'usage
    const streamId = `folder_${folderId}`;
    const useCaseList = await generateUseCaseList(input, organizationInfo, selectedModel, signal, streamId);
    
    // Mettre à jour le nom du dossier
    if (useCaseList.dossier) {
      await db.update(folders)
        .set({
          name: useCaseList.dossier,
          description: `Dossier généré automatiquement pour: ${input}`
        })
        .where(eq(folders.id, folderId));
      console.log(`📁 Folder updated: ${useCaseList.dossier} (ID: ${folderId}, Org: ${resolvedOrganizationId || 'None'})`);
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
        organizationId: resolvedOrganizationId || null,
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
    
    // Générer le détail
    const streamId = `usecase_${useCaseId}`;
    const useCaseDetail = await generateUseCaseDetail(
      useCaseName,
      context,
      matrixConfig,
      organizationInfo,
      selectedModel,
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
