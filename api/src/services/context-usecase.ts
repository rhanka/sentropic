import { executeWithTools } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import type { MatrixConfig } from '../types/matrix';

export interface UseCaseListItem {
  titre: string;
  description: string;
  ref: string;
}

export interface UseCaseList {
  dossier: string;
  useCases: UseCaseListItem[];
}

export interface UseCaseDetail {
  name: string;
  description: string;
  domain: string;
  technologies: string[];
  leadtime: string;
  prerequisites: string;
  contact: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  nextSteps: string[];
  sources: string[];
  relatedData: string[];
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

/**
 * Générer une liste de cas d'usage
 */
export const generateUseCaseList = async (
  input: string, 
  companyInfo?: string, 
  model?: string
): Promise<UseCaseList> => {
  const useCaseListPrompt = defaultPrompts.find(p => p.id === 'use_case_list')?.content || '';
  
  if (!useCaseListPrompt) {
    throw new Error('Prompt use_case_list non trouvé');
  }

  const prompt = useCaseListPrompt
    .replace('{{user_input}}', input)
    .replace('{{company_info}}', companyInfo || 'Aucune information d\'entreprise disponible');

  const response = await executeWithTools(prompt, { 
    model: model || 'gpt-5', 
    useWebSearch: true 
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Aucune réponse reçue pour la liste de cas d\'usage');
  }

  try {
    const parsedData = JSON.parse(content);
    return parsedData;
  } catch (parseError) {
    console.error('Erreur de parsing JSON pour la liste:', parseError);
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
  model?: string
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

  const response = await executeWithTools(prompt, { 
    model: model || 'gpt-5', 
    useWebSearch: true 
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`Aucune réponse reçue pour le cas d'usage: ${useCase}`);
  }

  try {
    const parsedData = JSON.parse(content);
    return parsedData;
  } catch (parseError) {
    console.error('Erreur de parsing JSON pour le détail:', parseError);
    console.error('Contenu reçu:', content);
    throw new Error(`Erreur lors du parsing de la réponse de l'IA pour le détail: ${useCase}`);
  }
};
