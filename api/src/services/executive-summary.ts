import { db } from '../db/client';
import { initiatives, folders, organizations, contextDocuments } from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { executeWithToolsStream } from './tools';
import { getReasoningParamsForModel } from './model-catalog';
import { AI_IDEAS_AGENTS } from '../config/default-agents-ai-ideas';
import { settingsService } from './settings';
import { hydrateInitiatives } from '../routes/api/initiatives';

const STRUCTURED_JSON_REPAIR_PROMPT = `You are a strict JSON repair engine.

Your task:
- Repair the malformed JSON response so it becomes one valid JSON object.
- Keep the original semantic intent and values as much as possible.
- Respect the target schema.
- Do not add commentary.

Target schema name:
{{schema_name}}

Target schema JSON:
{{schema_json}}

Malformed JSON response:
{{malformed_json}}

Rules:
- Return ONLY one valid JSON object.
- No markdown fences.
- No extra text before or after JSON.
- If a field is missing, infer the safest schema-compliant value from context.`;

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
  promptTemplate?: string;
  promptId?: string;
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

function compactText(value: string, maxLength = 600): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readStringField(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return '';
}

function normalizeExecutiveSummaryPayload(payload: unknown): ExecutiveSummaryResult['executive_summary'] {
  const source = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {};
  return {
    introduction: readStringField(source, ['introduction', 'intro']),
    analyse: readStringField(source, ['analyse', 'analysis']),
    recommandation: readStringField(source, ['recommandation', 'recommendation', 'recommendations']),
    synthese_executive: readStringField(source, ['synthese_executive', 'executive_summary', 'summary']),
  };
}

function buildExecutiveSummaryFallback(params: {
  folderName: string;
  organizationName?: string | null;
  initiativesList: Array<{
    data: { name?: string | null };
    totalValueScore?: number | null;
    totalComplexityScore?: number | null;
  }>;
  topCases: string[];
  effectiveValueThreshold: number;
  effectiveComplexityThreshold: number;
  medianValue: number;
  medianComplexity: number;
  rawContent?: string;
}): ExecutiveSummaryResult['executive_summary'] {
  const initiativeCount = params.initiativesList.length;
  const organizationSegment = params.organizationName ? ` pour ${params.organizationName}` : '';
  const highlightedCases = (params.topCases.length > 0
    ? params.topCases
    : params.initiativesList
        .map((initiative) => initiative.data?.name)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  ).slice(0, 3);
  const highlightedText =
    highlightedCases.length > 0
      ? highlightedCases.join(', ')
      : 'les cas d’usage les plus prometteurs du dossier';
  const rawExcerpt =
    typeof params.rawContent === 'string' && params.rawContent.trim().length > 0
      ? compactText(params.rawContent, 700)
      : '';

  return {
    introduction: `Le dossier ${params.folderName}${organizationSegment} regroupe ${initiativeCount} initiatives analysées avec un seuil de valeur de ${params.effectiveValueThreshold} et un seuil de complexité de ${params.effectiveComplexityThreshold}.`,
    analyse: `Les initiatives les plus solides se concentrent autour de ${highlightedText}. Les médianes observées sont de ${params.medianValue} en valeur et ${params.medianComplexity} en complexité, ce qui permet de distinguer les cas rapides à lancer des sujets plus structurants.`,
    recommandation: `Prioriser d’abord ${highlightedText}, valider les prérequis métier et data, puis dérouler les autres initiatives par vagues successives à partir des seuils retenus.`,
    synthese_executive: rawExcerpt || `Le portefeuille est exploitable immédiatement. Les initiatives prioritaires sont ${highlightedText}, avec une recommandation de lancement progressif en commençant par les cas à forte valeur et faible complexité.`,
  };
}

function parseJsonLenient<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('No JSON object boundaries found');
  }
}

async function parseExecutiveSummaryWithSingleRepair(params: {
  rawContent: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  try {
    return parseJsonLenient<Record<string, unknown>>(params.rawContent);
  } catch {
    const repairPrompt = STRUCTURED_JSON_REPAIR_PROMPT
      .replace('{{schema_name}}', 'executive_summary')
      .replace('{{schema_json}}', JSON.stringify({
        type: 'object',
        additionalProperties: true,
        properties: {
          introduction: { type: 'string' },
          analyse: { type: 'string' },
          recommandation: { type: 'string' },
          synthese_executive: { type: 'string' },
        },
        required: ['introduction', 'analyse', 'recommandation', 'synthese_executive'],
      }, null, 2))
      .replace('{{malformed_json}}', params.rawContent);

    const { content: repairedContent } = await executeWithToolsStream(repairPrompt, {
      model: params.model,
      useWebSearch: false,
      responseFormat: 'json_object',
      promptId: 'structured_json_repair',
      signal: params.signal,
    });
    if (!repairedContent) {
      throw new Error('Aucune réponse reçue lors de la tentative de réparation JSON');
    }
    return parseJsonLenient<Record<string, unknown>>(repairedContent);
  }
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
  const rows = await db.select().from(initiatives).where(eq(initiatives.folderId, folderId));
  const initiativesList = await hydrateInitiatives(rows);

  if (initiativesList.length === 0) {
    throw new Error('No use cases found for this folder');
  }

  // Calculer les médianes pour valeur et complexité
  const valueScores = initiativesList.map(uc => uc.totalValueScore ?? 0).filter(v => v > 0);
  const complexityScores = initiativesList.map(uc => uc.totalComplexityScore ?? 0).filter(v => v > 0);
  const medianValue = calculateMedian(valueScores);
  const medianComplexity = calculateMedian(complexityScores);

  // Utiliser les seuils personnalisés ou les médianes
  const effectiveValueThreshold = valueThreshold ?? medianValue;
  const effectiveComplexityThreshold = complexityThreshold ?? medianComplexity;

  // Calculer les top cas (ROI quadrant: valeur >= seuil ET complexité <= seuil)
  const topCases = initiativesList
    .filter(uc => {
      const value = uc.totalValueScore ?? 0;
      const complexity = uc.totalComplexityScore ?? 0;
      return value >= effectiveValueThreshold && complexity <= effectiveComplexityThreshold;
    })
    .map(uc => uc.data.name);

  // Formater les cas d'usage pour le prompt
  const initiativesFormatted = initiativesList.map((uc, index) => {
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
  const executiveSummaryPrompt =
    (typeof options.promptTemplate === 'string' &&
    options.promptTemplate.trim().length > 0
      ? options.promptTemplate
      : AI_IDEAS_AGENTS.find(a => a.config.promptId === 'executive_summary')?.config.promptTemplate as string) || '';
  if (!executiveSummaryPrompt) {
    throw new Error('Executive summary prompt not found');
  }

  // Remplacer les variables du prompt
  const basePrompt = executiveSummaryPrompt
    .replace('{{folder_description}}', folder.description || folder.name)
    .replace('{{organization_info}}', organizationInfo)
    .replace('{{top_cas}}', topCasesFormatted)
    .replace('{{use_cases}}', initiativesFormatted);

  // Documents: autoriser l'outil documents pour le dossier, l'organisation, et les cas d'usage du dossier (si des documents existent).
  const documentsContexts: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'initiative'; contextId: string }> = [];
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

  const initiativeIds = initiativesList.map((uc) => uc.id).filter(Boolean);
  if (initiativeIds.length > 0) {
    const initiativeDocRows = await db
      .select({ contextId: contextDocuments.contextId })
      .from(contextDocuments)
      .where(
        and(
          eq(contextDocuments.workspaceId, workspaceId),
          eq(contextDocuments.contextType, 'initiative'),
          inArray(contextDocuments.contextId, initiativeIds)
        )
      )
      .groupBy(contextDocuments.contextId);
    for (const r of initiativeDocRows) {
      if (r.contextId) documentsContexts.push({ workspaceId, contextType: 'initiative', contextId: r.contextId });
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
  const promptId =
    typeof options.promptId === 'string' && options.promptId.trim().length > 0
      ? options.promptId.trim()
      : 'executive_summary';

  // Appeler OpenAI (toujours avec streaming)
  const finalStreamId = streamId || `executive_summary_${folderId}_${Date.now()}`;
  let content = '';
  let normalizedExecutiveSummary: ExecutiveSummaryResult['executive_summary'];

  try {
    const result = await executeWithToolsStream(prompt, {
      model: selectedModel,
      useWebSearch: true,
      useDocuments: documentsContexts.length > 0,
      documentsContexts,
      responseFormat: 'json_object',
      ...getReasoningParamsForModel(selectedModel, 'high', 'detailed'),
      promptId,
      streamId: finalStreamId,
      signal
    });
    content = result.content || '';

    if (!content) {
      throw new Error('No response from AI');
    }

    const executiveSummary = await parseExecutiveSummaryWithSingleRepair({
      rawContent: content,
      model: selectedModel,
      signal,
    });
    normalizedExecutiveSummary = normalizeExecutiveSummaryPayload(executiveSummary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const isProviderAbort = errorMessage.includes('request was aborted') || errorMessage.includes('aborterror');
    if (signal?.aborted && !isProviderAbort) {
      throw error;
    }
    console.error('Error generating executive summary from AI, using deterministic fallback:', error);
    normalizedExecutiveSummary = buildExecutiveSummaryFallback({
      folderName: folder.name,
      organizationName: folder.organizationName,
      initiativesList,
      topCases,
      effectiveValueThreshold,
      effectiveComplexityThreshold,
      medianValue,
      medianComplexity,
      rawContent: content,
    });
  }

  // Stocker dans la base de données
  await db.update(folders)
    .set({ executiveSummary: JSON.stringify(normalizedExecutiveSummary) })
    .where(eq(folders.id, folderId));

  return {
    executive_summary: normalizedExecutiveSummary,
    top_cases: topCases,
    thresholds: {
      value: effectiveValueThreshold,
      complexity: effectiveComplexityThreshold,
      median_value: medianValue,
      median_complexity: medianComplexity
    }
  };
}
