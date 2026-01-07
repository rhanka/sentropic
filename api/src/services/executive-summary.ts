import { db } from '../db/client';
import { useCases, folders, organizations, contextDocuments } from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { executeWithToolsStream } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import { settingsService } from './settings';
import { hydrateUseCases } from '../routes/api/use-cases';

type OrganizationData = {
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
};

function parseOrganizationData(value: unknown): OrganizationData {
  if (!value) return {};
  if (typeof value === 'object') return value as OrganizationData;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as OrganizationData;
    } catch {
      return {};
    }
  }
  return {};
}

// Fonction helper pour calculer la médiane
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface GenerateExecutiveSummaryOptions {
  folderId: string;
  valueThreshold?: number | null;
  complexityThreshold?: number | null;
  model?: string;
  signal?: AbortSignal;
  streamId?: string;
}

export interface ExecutiveSummaryResult {
  executive_summary: {
    introduction: string;
    analyse: string;
    recommandation: string;
    synthese_executive: string;
  };
  top_cases: string[];
  thresholds: {
    value: number;
    complexity: number;
    median_value: number;
    median_complexity: number;
  };
}

/**
 * Génère une synthèse exécutive pour un dossier
 */
export async function generateExecutiveSummary(
  options: GenerateExecutiveSummaryOptions
): Promise<ExecutiveSummaryResult> {
  const { folderId, valueThreshold, complexityThreshold, model, signal, streamId } = options;

  // Récupérer le dossier
  const [folder] = await db.select({
    id: folders.id,
    workspaceId: folders.workspaceId,
    name: folders.name,
    description: folders.description,
    organizationId: folders.organizationId,
    organizationName: organizations.name,
    organizationData: organizations.data
  })
  .from(folders)
  .leftJoin(organizations, eq(folders.organizationId, organizations.id))
  .where(eq(folders.id, folderId));

  if (!folder) {
    throw new Error('Folder not found');
  }

  // Récupérer tous les cas d'usage du dossier et les hydrater
  const rows = await db.select().from(useCases).where(eq(useCases.folderId, folderId));
  const useCasesList = await hydrateUseCases(rows);

  if (useCasesList.length === 0) {
    throw new Error('No use cases found for this folder');
  }

  // Calculer les médianes pour valeur et complexité
  const valueScores = useCasesList.map(uc => uc.totalValueScore ?? 0).filter(v => v > 0);
  const complexityScores = useCasesList.map(uc => uc.totalComplexityScore ?? 0).filter(v => v > 0);
  const medianValue = calculateMedian(valueScores);
  const medianComplexity = calculateMedian(complexityScores);

  // Utiliser les seuils personnalisés ou les médianes
  const effectiveValueThreshold = valueThreshold ?? medianValue;
  const effectiveComplexityThreshold = complexityThreshold ?? medianComplexity;

  // Calculer les top cas (ROI quadrant: valeur >= seuil ET complexité <= seuil)
  const topCases = useCasesList
    .filter(uc => {
      const value = uc.totalValueScore ?? 0;
      const complexity = uc.totalComplexityScore ?? 0;
      return value >= effectiveValueThreshold && complexity <= effectiveComplexityThreshold;
    })
    .map(uc => uc.data.name);

  // Formater les cas d'usage pour le prompt
  const useCasesFormatted = useCasesList.map((uc, index) => {
    const benefits = uc.data.benefits ?? [];
    const risks = uc.data.risks ?? [];
    const nextSteps = uc.data.nextSteps ?? [];
    const metrics = uc.data.metrics ?? [];
    const technologies = uc.data.technologies ?? [];

    return `Cas d'usage ${index + 1}: ${uc.data.name}
Description: ${uc.data.description || 'Non disponible'}
Valeur: ${uc.totalValueScore ?? 0} pts | Complexité: ${uc.totalComplexityScore ?? 0} pts
Bénéfices: ${benefits.length > 0 ? benefits.join(', ') : 'Non spécifiés'}
Risques: ${risks.length > 0 ? risks.join(', ') : 'Non spécifiés'}
Prochaines étapes: ${nextSteps.length > 0 ? nextSteps.join(', ') : 'Non spécifiées'}
Métriques: ${metrics.length > 0 ? metrics.join(', ') : 'Non spécifiées'}
Technologies: ${technologies.length > 0 ? technologies.join(', ') : 'Non spécifiées'}
Prérequis: ${uc.data.prerequisites || 'Non spécifiés'}
Contact: ${uc.data.contact || 'Non spécifié'}`;
  }).join('\n\n---\n\n');

  // Formater les top cas
  const topCasesFormatted = topCases.length > 0 
    ? topCases.map((name, index) => `${index + 1}. ${name}`).join('\n')
    : 'Aucun cas d\'usage prioritaire identifié';

  let organizationInfo = 'No organization info available';
  if (folder.organizationId) {
    const data = parseOrganizationData(folder.organizationData);
    organizationInfo = JSON.stringify(
      {
        name: folder.organizationName ?? 'Unknown organization',
        industry: data.industry,
        size: data.size,
        products: data.products,
        processes: data.processes,
        challenges: data.challenges,
        objectives: data.objectives,
        technologies: data.technologies,
      },
      null,
      2
    );
  }

  // Récupérer le prompt executive_summary
  const executiveSummaryPrompt = defaultPrompts.find(p => p.id === 'executive_summary')?.content;
  if (!executiveSummaryPrompt) {
    throw new Error('Executive summary prompt not found');
  }

  // Remplacer les variables du prompt
  const basePrompt = executiveSummaryPrompt
    .replace('{{folder_description}}', folder.description || folder.name)
    .replace('{{organization_info}}', organizationInfo)
    .replace('{{top_cas}}', topCasesFormatted)
    .replace('{{use_cases}}', useCasesFormatted);

  // Documents: autoriser l'outil documents pour le dossier, l'organisation, et les cas d'usage du dossier (si des documents existent).
  const documentsContexts: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'usecase'; contextId: string }> = [];
  const workspaceId = folder.workspaceId;

  const [folderDoc] = await db
    .select({ id: contextDocuments.id })
    .from(contextDocuments)
    .where(and(eq(contextDocuments.workspaceId, workspaceId), eq(contextDocuments.contextType, 'folder'), eq(contextDocuments.contextId, folderId)))
    .limit(1);
  if (folderDoc?.id) documentsContexts.push({ workspaceId, contextType: 'folder', contextId: folderId });

  if (folder.organizationId) {
    const [orgDoc] = await db
      .select({ id: contextDocuments.id })
      .from(contextDocuments)
      .where(
        and(
          eq(contextDocuments.workspaceId, workspaceId),
          eq(contextDocuments.contextType, 'organization'),
          eq(contextDocuments.contextId, folder.organizationId)
        )
      )
      .limit(1);
    if (orgDoc?.id) documentsContexts.push({ workspaceId, contextType: 'organization', contextId: folder.organizationId });
  }

  const useCaseIds = useCasesList.map((uc) => uc.id).filter(Boolean);
  if (useCaseIds.length > 0) {
    const useCaseDocRows = await db
      .select({ contextId: contextDocuments.contextId })
      .from(contextDocuments)
      .where(
        and(
          eq(contextDocuments.workspaceId, workspaceId),
          eq(contextDocuments.contextType, 'usecase'),
          inArray(contextDocuments.contextId, useCaseIds)
        )
      )
      .groupBy(contextDocuments.contextId);
    for (const r of useCaseDocRows) {
      if (r.contextId) documentsContexts.push({ workspaceId, contextType: 'usecase', contextId: r.contextId });
    }
  }

  const docsDirective =
    documentsContexts.length > 0
      ? `\n\nDOCUMENTS DISPONIBLES (outil documents)\n- Tu as accès à l'outil "documents" pour consulter des documents existants.\n- Contextes autorisés:\n${documentsContexts
          .map((c) => `  - contextType="${c.contextType}" contextId="${c.contextId}"`)
          .join('\n')}\n- Si utile, commence par action=list, puis action=get_summary ou get_content.\n- Ne pas inventer: s'appuyer sur les documents uniquement si tu les appelles.`
      : '';

  const prompt = `${basePrompt}${docsDirective}`;

  // Récupérer le modèle (fourni ou par défaut)
  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;
  const isGpt5 = typeof selectedModel === 'string' && selectedModel.startsWith('gpt-5');

  // Appeler OpenAI (toujours avec streaming)
  const finalStreamId = streamId || `executive_summary_${folderId}_${Date.now()}`;
  const result = await executeWithToolsStream(prompt, {
    model: selectedModel,
    useWebSearch: true,
    useDocuments: documentsContexts.length > 0,
    documentsContexts,
    responseFormat: 'json_object',
    reasoningSummary: 'auto',
    ...(isGpt5 ? { reasoningEffort: 'high' as const } : {}),
    promptId: 'executive_summary',
    streamId: finalStreamId,
    signal
  });
  const content = result.content || '';

  if (!content) throw new Error('No response from AI');

  // Parser le JSON
  let executiveSummary;
  try {
    const cleaned = content
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      executiveSummary = JSON.parse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        executiveSummary = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('No JSON object boundaries found');
      }
    }
  } catch (parseError) {
    console.error('Error parsing AI response JSON:', parseError);
    throw new Error(`Invalid JSON response from AI: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
  }

  // Stocker dans la base de données
  await db.update(folders)
    .set({ executiveSummary: JSON.stringify(executiveSummary) })
    .where(eq(folders.id, folderId));

  return {
    executive_summary: executiveSummary,
    top_cases: topCases,
    thresholds: {
      value: effectiveValueThreshold,
      complexity: effectiveComplexityThreshold,
      median_value: medianValue,
      median_complexity: medianComplexity
    }
  };
}

