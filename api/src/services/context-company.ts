import { executeWithTools, executeWithToolsStream } from './tools';
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

function normalizeCompanyField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceCompanyData(value: unknown): CompanyData {
  const rec = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  return {
    industry: normalizeCompanyField(rec.industry),
    size: normalizeCompanyField(rec.size),
    products: normalizeCompanyField(rec.products),
    processes: normalizeCompanyField(rec.processes),
    challenges: normalizeCompanyField(rec.challenges),
    objectives: normalizeCompanyField(rec.objectives),
    technologies: normalizeCompanyField(rec.technologies)
  };
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
 * Si streamId est fourni, utilise le streaming et écrit les événements dans chat_stream_events
 * Sinon, utilise l'ancienne méthode (non-streaming) pour compatibilité
 */
export const enrichCompany = async (
  companyName: string, 
  model?: string, 
  signal?: AbortSignal,
  streamId?: string
): Promise<CompanyData> => {
  // Si streamId est fourni, utiliser la version streaming
  if (streamId) {
    // enrichCompanyStream attend : (companyName, streamId, model, signal)
    // enrichCompany reçoit : (companyName, model, signal, streamId)
    return enrichCompanyStream(companyName, streamId, model, signal);
  }

  // Sinon, utiliser l'ancienne méthode (non-streaming) pour compatibilité
  const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';
  
  if (!companyInfoPrompt) {
    throw new Error('Prompt company_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = companyInfoPrompt
    .replace('{{company_name}}', companyName)
    .replace('{{industries}}', industriesList);

  const response = await executeWithTools(prompt, { 
    model: model || 'gpt-4.1-nano', 
    useWebSearch: true,
    responseFormat: 'json_object',
    signal
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Aucune réponse reçue de l\'IA');
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return coerceCompanyData(parsed);
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA');
  }
};

/**
 * Enrichir une entreprise avec l'IA en streaming
 * @param companyName - Nom de l'entreprise
 * @param streamId - ID du stream pour écrire les événements (optionnel, généré si non fourni)
 * @param model - Modèle OpenAI à utiliser (optionnel, utilise le défaut depuis settings)
 * @param signal - AbortSignal pour annulation
 * @returns Données enrichies de l'entreprise
 */
export const enrichCompanyStream = async (
  companyName: string,
  streamId?: string,
  model?: string,
  signal?: AbortSignal
): Promise<CompanyData> => {
  const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';
  
  if (!companyInfoPrompt) {
    throw new Error('Prompt company_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = companyInfoPrompt
    .replace('{{company_name}}', companyName)
    .replace('{{industries}}', industriesList);
  const { content: accumulatedContent } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    responseFormat: 'json_object',
    reasoningSummary: 'detailed',
    promptId: 'company_info',
    streamId,
    signal
  });

  // Parser le contenu final
  if (!accumulatedContent) {
    throw new Error('Aucune réponse reçue de l\'IA');
  }

  try {
    const cleaned = accumulatedContent
      .trim()
      // retirer d'éventuels code fences
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const tryParse = (s: string) => JSON.parse(s);

    let parsedData: unknown;
    try {
      parsedData = tryParse(cleaned);
    } catch {
      // Fallback: extraire le premier objet JSON plausible (au cas où du texte parasite s'ajoute)
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        parsedData = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('No JSON object boundaries found');
      }
    }
    return coerceCompanyData(parsedData);
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', accumulatedContent);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA');
  }
};
