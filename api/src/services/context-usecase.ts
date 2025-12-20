import { executeWithToolsStream } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import type { MatrixConfig } from '../types/matrix';

export interface UseCaseListItem {
  titre: string;
  description: string; // 30-60 caractères (description courte)
  problem?: string; // 40-80 caractères (nouveau champ)
  solution?: string; // 40-80 caractères (nouveau champ)
  ref: string;
}

export interface UseCaseList {
  dossier: string;
  useCases: UseCaseListItem[];
}

export interface UseCaseDetail {
  name: string;
  description: string; // 30-60 caractères (description courte)
  problem?: string; // 40-80 caractères (nouveau champ)
  solution?: string; // 40-80 caractères (nouveau champ)
  domain: string;
  technologies: string[];
  leadtime: string;
  prerequisites: string;
  contact: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  nextSteps: string[];
  dataSources: string[];
  dataObjects: string[];
  references: Array<{
    title: string;
    url: string;
  }>;
  valueScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
  complexityScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
}

const defaultUseCaseCount = 6;

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
    throw new Error('Invalid JSON response');
  }
}

/**
 * Générer une liste de cas d'usage
 */
export const generateUseCaseList = async (
  input: string, 
  companyInfo?: string, 
  model?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseList> => {
  const useCaseListPrompt = defaultPrompts.find(p => p.id === 'use_case_list')?.content || '';
  
  if (!useCaseListPrompt) {
    throw new Error('Prompt use_case_list non trouvé');
  }

  const prompt = useCaseListPrompt
    .replace('{{user_input}}', input)
    .replace('{{company_info}}', companyInfo || 'Aucune information d\'entreprise disponible')
    .replace('{{use_case_count}}', String(defaultUseCaseCount));

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_list_${Date.now()}`;
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    responseFormat: 'json_object',
    reasoningSummary: 'auto',
    promptId: 'use_case_list',
    streamId: finalStreamId,
    signal
  });
  
  if (!content) throw new Error('Aucune réponse reçue pour la liste de cas d\'usage');
  
  try {
    return parseJsonLenient<UseCaseList>(content);
  } catch (e) {
    console.error('Erreur de parsing JSON pour la liste:', e);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA pour la liste');
  }
};

/**
 * Générer le détail d'un cas d'usage
 */
export const generateUseCaseDetail = async (
  useCase: string,
  context: string,
  matrix: MatrixConfig,
  companyInfo?: string,
  model?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseDetail> => {
  const useCaseDetailPrompt = defaultPrompts.find(p => p.id === 'use_case_detail')?.content || '';
  
  if (!useCaseDetailPrompt) {
    throw new Error('Prompt use_case_detail non trouvé');
  }

  const prompt = useCaseDetailPrompt
    .replace(/\{\{use_case\}\}/g, useCase)
    .replace('{{user_input}}', context)
    .replace('{{company_info}}', companyInfo || 'Aucune information d\'entreprise disponible')
    .replace('{{matrix}}', JSON.stringify(matrix));

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_detail_${Date.now()}`;
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    responseFormat: 'json_object',
    reasoningSummary: 'auto',
    promptId: 'use_case_detail',
    streamId: finalStreamId,
    signal
  });
  
  if (!content) throw new Error(`Aucune réponse reçue pour le cas d'usage: ${useCase}`);
  
  try {
    return parseJsonLenient<UseCaseDetail>(content);
  } catch (e) {
    console.error('Erreur de parsing JSON pour le détail:', e);
    console.error('Contenu reçu (premiers 500 chars):', content.substring(0, 500));
    console.error('Contenu reçu (derniers 500 chars):', content.substring(Math.max(0, content.length - 500)));
    console.error('Longueur du contenu:', content.length);
    console.error('Type de contenu:', typeof content);
    throw new Error(`Erreur lors du parsing de la réponse de l'IA pour le détail: ${useCase}`);
  }
};
