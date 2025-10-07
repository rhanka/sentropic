import { executeWithTools } from './tools';
import { defaultPrompts } from '../config/default-prompts';

export interface CompanyData {
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
}

// Configuration métier par défaut
const industries = {
  industries: [
    { name: 'Technologie' },
    { name: 'Santé' },
    { name: 'Finance' },
    { name: 'Éducation' },
    { name: 'Retail' },
    { name: 'Manufacturing' },
    { name: 'Services' },
    { name: 'Immobilier' },
    { name: 'Transport' },
    { name: 'Énergie' },
    { name: 'Agroalimentaire' },
    { name: 'Média' },
    { name: 'Télécommunications' },
    { name: 'Automobile' },
    { name: 'Aéronautique' }
  ]
};

/**
 * Enrichir une entreprise avec l'IA
 */
export const enrichCompany = async (companyName: string, model?: string, signal?: AbortSignal): Promise<CompanyData> => {
  const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';
  
  if (!companyInfoPrompt) {
    throw new Error('Prompt company_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = companyInfoPrompt
    .replace('{{company_name}}', companyName)
    .replace('{{industries}}', industriesList);

  const response = await executeWithTools(prompt, { 
    model: model || 'gpt-5', 
    useWebSearch: true,
    responseFormat: 'json_object',
    signal
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Aucune réponse reçue de l\'IA');
  }

  try {
    const parsedData = JSON.parse(content);
    return parsedData;
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA');
  }
};
