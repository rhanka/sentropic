import { db } from '../db/client';
import { useCases, folders, companies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { executeWithTools } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import { settingsService } from './settings';
import { hydrateUseCases } from '../routes/api/use-cases';

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
  const { folderId, valueThreshold, complexityThreshold, model, signal } = options;

  // Récupérer le dossier
  const [folder] = await db.select({
    id: folders.id,
    name: folders.name,
    description: folders.description,
    companyId: folders.companyId,
    companyName: companies.name
  })
  .from(folders)
  .leftJoin(companies, eq(folders.companyId, companies.id))
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

  // Récupérer les informations de l'entreprise si disponible
  let companyInfo = 'Aucune information d\'entreprise disponible';
  if (folder.companyId) {
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
    }
  }

  // Récupérer le prompt executive_summary
  const executiveSummaryPrompt = defaultPrompts.find(p => p.id === 'executive_summary')?.content;
  if (!executiveSummaryPrompt) {
    throw new Error('Executive summary prompt not found');
  }

  // Remplacer les variables du prompt
  const prompt = executiveSummaryPrompt
    .replace('{{folder_description}}', folder.description || folder.name)
    .replace('{{company_info}}', companyInfo)
    .replace('{{top_cas}}', topCasesFormatted)
    .replace('{{use_cases}}', useCasesFormatted);

  // Récupérer le modèle (fourni ou par défaut)
  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  // Appeler OpenAI
  const response = await executeWithTools(prompt, {
    model: selectedModel,
    useWebSearch: true,
    responseFormat: 'json_object',
    signal
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from AI');
  }

  // Parser le JSON
  let executiveSummary;
  try {
    executiveSummary = JSON.parse(content);
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

