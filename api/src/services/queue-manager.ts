import { db } from '../db/client';
import { sql, eq } from 'drizzle-orm';
import { createId } from '../utils/id';
import { enrichCompany } from './context-company';
import { generateUseCaseList, generateUseCaseDetail } from './context-usecase';
import { parseMatrixConfig } from '../utils/matrix';
import { calculateScores } from '../utils/scoring';
import { validateScores, fixScores } from '../utils/score-validation';
import { companies, folders, useCases } from '../db/schema';
import { settingsService } from './settings';

export type JobType = 'company_enrich' | 'usecase_list' | 'usecase_detail';

export interface Job {
  id: string;
  type: JobType;
  data: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface CompanyEnrichJobData {
  companyId: string;
  companyName: string;
  model?: string;
}

export interface UseCaseListJobData {
  folderId: string;
  input: string;
  companyId?: string;
  model?: string;
}

export interface UseCaseDetailJobData {
  useCaseId: string;
  useCaseName: string;
  folderId: string;
  model?: string;
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
    for (const [_, controller] of this.jobControllers.entries()) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {}
    }
    await this.drain();
    this.cancelAllInProgress = false;
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
  async addJob(type: JobType, data: any): Promise<string> {
    if (this.cancelAllInProgress || this.paused) {
      console.warn(`⏸️ Queue paused/cancelling, refusing to enqueue job ${type}`);
      throw new Error('Queue is paused or cancelling; job not accepted');
    }
    const jobId = createId();
    
    await db.run(sql`
      INSERT INTO job_queue (id, type, data, status, created_at)
      VALUES (${jobId}, ${type}, ${JSON.stringify(data)}, 'pending', ${new Date().toISOString()})
    `);
    
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
      while (!this.paused) {
        if (this.cancelAllInProgress) break;
        // Récupérer les jobs en attente
        const pendingJobs = await db.all(sql`
          SELECT * FROM job_queue 
          WHERE status = 'pending' 
          ORDER BY created_at ASC 
          LIMIT ${this.maxConcurrentJobs}
        `);

        if (pendingJobs.length === 0) {
          break;
        }

        // Traiter les jobs en parallèle
        const promises = pendingJobs.map(job => this.processJob(job));
        await Promise.all(promises);
      }
    } finally {
      this.isProcessing = false;
      console.log('✅ Job processing completed');
    }
  }

  /**
   * Traiter un job individuel
   */
  private async processJob(job: any): Promise<void> {
    const jobId = job.id;
    const jobType = job.type as JobType;
    const jobData = JSON.parse(job.data);

    try {
      console.log(`🔄 Processing job ${jobId} (${jobType})`);
      
      // Marquer comme en cours
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'processing', started_at = ${new Date().toISOString()}
        WHERE id = ${jobId}
      `);

      const controller = new AbortController();
      this.jobControllers.set(jobId, controller);

      // Traiter selon le type
      switch (jobType) {
        case 'company_enrich':
          await this.processCompanyEnrich(jobData as CompanyEnrichJobData, controller.signal);
          break;
        case 'usecase_list':
          await this.processUseCaseList(jobData as UseCaseListJobData, controller.signal);
          break;
        case 'usecase_detail':
          await this.processUseCaseDetail(jobData as UseCaseDetailJobData, controller.signal);
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      // Marquer comme terminé
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'completed', completed_at = ${new Date().toISOString()}
        WHERE id = ${jobId}
      `);

      console.log(`✅ Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);
      
      // Marquer comme échoué
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'failed', error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${jobId}
      `);
    } finally {
      this.jobControllers.delete(jobId);
    }
  }

  /**
   * Worker pour l'enrichissement d'entreprise
   */
  private async processCompanyEnrich(data: CompanyEnrichJobData, signal?: AbortSignal): Promise<void> {
    const { companyId, companyName, model } = data;
    
    // Enrichir l'entreprise
    const enrichedData = await enrichCompany(companyName, model, signal);
    
    // Mettre à jour en base
    await db.update(companies)
      .set({
        ...enrichedData,
        status: 'completed',
        updatedAt: new Date().toISOString()
      })
      .where(eq(companies.id, companyId));
  }

  /**
   * Worker pour la génération de liste de cas d'usage
   */
  private async processUseCaseList(data: UseCaseListJobData, signal?: AbortSignal): Promise<void> {
    const { folderId, input, companyId, model } = data;
    
    // Récupérer les informations de l'entreprise si nécessaire
    let companyInfo = '';
    if (companyId) {
      try {
        const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
        if (company) {
          companyInfo = JSON.stringify({
            name: company.name,
            industry: company.industry,
            size: company.size,
            products: company.products,
            processes: company.processes,
            challenges: company.challenges,
            objectives: company.objectives,
            technologies: company.technologies
          }, null, 2);
          console.log(`📊 Informations entreprise récupérées pour ${company.name}:`, companyInfo);
        } else {
          console.warn(`⚠️ Entreprise non trouvée avec l'ID: ${companyId}`);
        }
      } catch (error) {
        console.warn('Erreur lors de la récupération des informations de l\'entreprise:', error);
      }
    } else {
      console.log('ℹ️ Aucune entreprise sélectionnée pour cette génération');
    }

    // Générer la liste de cas d'usage
    const useCaseList = await generateUseCaseList(input, companyInfo, model, signal);
    
    // Mettre à jour le nom du dossier
    if (useCaseList.dossier) {
      await db.update(folders)
        .set({
          name: useCaseList.dossier,
          description: `Dossier généré automatiquement pour: ${input}`
        })
        .where(eq(folders.id, folderId));
      console.log(`📁 Dossier mis à jour: ${useCaseList.dossier} (ID: ${folderId}, Company: ${companyId || 'Aucune'})`);
    }

    // Créer les cas d'usage en mode generating
    const draftUseCases = useCaseList.useCases.map((useCaseItem: any) => {
      const title = useCaseItem.titre || useCaseItem.title || useCaseItem;
      return {
        id: createId(),
        folderId: folderId,
        companyId: companyId || null,
        name: title,
        description: useCaseItem.description || '',
        process: '',
        technologies: JSON.stringify([]),
        deadline: '',
        contact: '',
        benefits: JSON.stringify([]),
        metrics: JSON.stringify([]),
        risks: JSON.stringify([]),
        nextSteps: JSON.stringify([]),
        sources: JSON.stringify([]),
        relatedData: JSON.stringify([]),
        valueScores: JSON.stringify([]),
        complexityScores: JSON.stringify([]),
        totalValueScore: 0,
        totalComplexityScore: 0,
        status: 'generating',
        createdAt: new Date().toISOString()
      };
    });

    // Insérer les cas d'usage
    await db.insert(useCases).values(draftUseCases);

    // Marquer le dossier comme terminé
    await db.update(folders)
      .set({ status: 'completed' })
      .where(eq(folders.id, folderId));

    // Auto-déclencher le détail de tous les cas d'usage (sauf si pause/cancel en cours)
    if (this.cancelAllInProgress || this.paused) {
      console.warn('⏸️ Skipping auto-enqueue of usecase_detail due to pause/cancel');
    } else {
      for (const useCase of draftUseCases) {
        try {
          await this.addJob('usecase_detail', {
            useCaseId: useCase.id,
            useCaseName: useCase.name,
            folderId: folderId,
            model: model
          });
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
    
    // Récupérer la configuration de la matrice
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    if (!folder) {
      throw new Error('Dossier non trouvé');
    }
    
    const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    if (!matrixConfig) {
      throw new Error('Configuration de matrice non trouvée');
    }
    
    // Récupérer les informations de l'entreprise si nécessaire
    let companyInfo = '';
    if (folder.companyId) {
      try {
        const [company] = await db.select().from(companies).where(eq(companies.id, folder.companyId));
        if (company) {
          companyInfo = JSON.stringify({
            name: company.name,
            industry: company.industry,
            size: company.size,
            products: company.products,
            processes: company.processes,
            challenges: company.challenges,
            objectives: company.objectives,
            technologies: company.technologies
          }, null, 2);
          console.log(`📊 Informations entreprise récupérées pour ${company.name}:`, companyInfo);
        } else {
          console.warn(`⚠️ Entreprise non trouvée avec l'ID: ${folder.companyId}`);
        }
      } catch (error) {
        console.error('Erreur lors de la récupération de l\'entreprise:', error);
      }
    }
    
    const context = folder.description || '';
    
    // Générer le détail
    const useCaseDetail = await generateUseCaseDetail(useCaseName, context, matrixConfig, companyInfo, model, signal);
    
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
    
    // Calculer les scores
    const computed = calculateScores(matrixConfig, useCaseDetail.valueScores, useCaseDetail.complexityScores);
    
    // Mettre à jour le cas d'usage
    await db.update(useCases)
      .set({
        name: useCaseDetail.name,
        description: useCaseDetail.description,
        domain: useCaseDetail.domain,
        technologies: JSON.stringify(useCaseDetail.technologies),
        prerequisites: useCaseDetail.prerequisites,
        deadline: useCaseDetail.leadtime, // leadtime du prompt -> deadline en DB
        contact: useCaseDetail.contact,
        benefits: JSON.stringify(useCaseDetail.benefits),
        metrics: JSON.stringify(useCaseDetail.metrics),
        risks: JSON.stringify(useCaseDetail.risks),
        nextSteps: JSON.stringify(useCaseDetail.nextSteps),
        sources: JSON.stringify(useCaseDetail.sources),
        relatedData: JSON.stringify(useCaseDetail.relatedData),
        references: JSON.stringify(useCaseDetail.references || []),
        valueScores: JSON.stringify(useCaseDetail.valueScores),
        complexityScores: JSON.stringify(useCaseDetail.complexityScores),
        totalValueScore: computed.totalValueScore,
        totalComplexityScore: computed.totalComplexityScore,
        status: 'completed'
      })
      .where(eq(useCases.id, useCaseId));
  }

  /**
   * Obtenir le statut d'un job
   */
  async getJobStatus(jobId: string): Promise<Job | null> {
    const result = await db.get(sql`
      SELECT * FROM job_queue WHERE id = ${jobId}
    `) as any;
    
    if (!result) return null;
    
    return {
      id: result.id,
      type: result.type as JobType,
      data: JSON.parse(result.data),
      status: result.status as Job['status'],
      createdAt: result.created_at,
      startedAt: result.started_at,
      completedAt: result.completed_at,
      error: result.error
    };
  }

  /**
   * Obtenir tous les jobs
   */
  async getAllJobs(): Promise<Job[]> {
    const results = await db.all(sql`
      SELECT * FROM job_queue ORDER BY created_at DESC
    `) as any[];
    
    return results.map((row: any) => ({
      id: row.id,
      type: row.type as JobType,
      data: JSON.parse(row.data),
      status: row.status as Job['status'],
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error
    }));
  }
}

// Instance singleton
export const queueManager = new QueueManager();
