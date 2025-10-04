import { env } from '../config/env';

export type GenerateUseCasesParams = {
  input: string;
  createNewFolder: boolean;
  companyId?: string;
};

export type CompanyEnrichmentParams = {
  companyName: string;
};

export type CompanyEnrichmentResult = {
  normalizedName: string;
  industry: string;
  size: string;
  products: string;
  processes: string;
  challenges: string;
  objectives: string;
  technologies: string;
};

// Configuration métier par défaut
const defaultBusinessConfig = {
  sectors: [
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

    const companyInfoPrompt = `Recherchez et fournissez des informations complètes sur l'entreprise {{company_name}}. 
    Les secteurs d'activité disponibles sont: ${defaultBusinessConfig.sectors.map(s => s.name).join(', ')}.
    Normalisez le nom de l'entreprise selon son usage officiel.

    IMPORTANT: 
    - Répondez UNIQUEMENT avec du JSON valide
    - Ne commencez pas par du texte explicatif
    - Tous les champs doivent être des chaînes de caractères lisibles
    - L'industrie DOIT correspondre exactement à un des secteurs listés

    Format de réponse JSON strict:
    {
      "normalizedName": "Nom normalisé de l'entreprise",
      "industry": "Secteur d'activité (DOIT correspondre à un des secteurs listés)",
      "size": "Taille en nombre d'employés et chiffre d'affaires si disponible",
      "products": "Description détaillée des principaux produits ou services",
      "processes": "Description des processus métier clés",
      "challenges": "Défis principaux auxquels l'entreprise est confrontée actuellement",
      "objectives": "Objectifs stratégiques connus de l'entreprise",
      "technologies": "Technologies ou systèmes d'information déjà utilisés"
    }`;

// Prompts selon la spécification
const folderNamePrompt = `Génère un nom et une brève description pour un dossier qui contiendra des cas d'usage d'IA pour le contexte suivant: {{user_input}}.
Le nom doit être court et représentatif du domaine ou secteur d'activité principal.
La description doit expliquer en 1-2 phrases le contenu du dossier.
Format de réponse en JSON:
{
  "name": "Nom du dossier (4-6 mots max)",
  "description": "Description concise du dossier (20-30 mots max)"
}`;

const useCaseListPrompt = `Génère une liste de 5 cas d'usage d'IA innovants pour le domaine suivant: {{user_input}}.
Pour chaque cas d'usage, propose un titre court et explicite.
Format: liste numérotée sans description.

Réponse attendue au format JSON:
{
  "titles": ["Titre 1", "Titre 2", "Titre 3", "Titre 4", "Titre 5"]
}`;

const useCaseDetailPrompt = `Génère un cas d'usage détaillé pour "{{use_case}}" dans le contexte suivant: {{user_input}}. 
Utilise la matrice valeur/complexité fournie: {{matrix}} pour évaluer chaque axe de valeur et complexité.

SYSTÈME DE SCORING FIBONACCI:
Pour chaque axe, tu DOIS utiliser UNIQUEMENT une de ces valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
Ces scores sont ensuite mappés aux étoiles (1-5) pour l'affichage.

La réponse doit impérativement contenir tous les éléments suivants au format JSON:
{
  "name": "{{use_case}}",
  "description": "Description détaillée du cas d'usage sur 5-10 lignes",
  "process": "Le processus d'entreprise concerné",
  "technology": "Technologies d'IA à utiliser (NLP, Computer Vision, etc.)",
  "deadline": "Estimation du délai de mise en œuvre (ex: Q4 2025)",
  "contact": "Nom du responsable suggéré",
  "benefits": [
    "Bénéfice 1",
    "Bénéfice 2",
    "Bénéfice 3",
    "Bénéfice 4",
    "Bénéfice 5"
  ],
  "metrics": [
    "KPI ou mesure de succès 1",
    "KPI ou mesure de succès 2",
    "KPI ou mesure de succès 3"
  ],
  "risks": [
    "Risque 1",
    "Risque 2",
    "Risque 3"
  ],
  "nextSteps": [
    "Étape 1",
    "Étape 2",
    "Étape 3",
    "Étape 4"
  ],
  "sources": [
    "Source de données 1",
    "Source de données 2"
  ],
  "relatedData": [
    "Donnée associée 1",
    "Donnée associée 2",
    "Donnée associée 3"
  ],
  "valueScores": [
    {
      "axisId": "Nom du 1er axe de valeur",
      "rating": 21,
      "description": "Justification du score Fibonacci choisi"
    }
    // Complète pour TOUS les axes de valeur présents dans la matrice
    // Utilise UNIQUEMENT: 0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100
  ],
  "complexityScores": [
    {
      "axisId": "Nom du 1er axe de complexité",
      "rating": 8,
      "description": "Justification du score Fibonacci choisi"
    }
    // Complète pour TOUS les axes de complexité présents dans la matrice
    // Utilise UNIQUEMENT: 0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100
  ]
}

IMPORTANT: 
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Pour les scores, utilise UNIQUEMENT les valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
- Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores
- Justifie chaque score Fibonacci choisi dans la description`;

export type GeneratedFolder = {
  name: string;
  description: string;
};

export type GeneratedUseCaseList = {
  titles: string[];
};

export type GeneratedUseCaseDetail = {
  name: string;
  description: string;
  process: string;
  technology: string;
  deadline: string;
  contact: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  nextSteps: string[];
  sources: string[];
  relatedData: string[];
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
};

const callOpenAI = async (prompt: string, systemMessage: string = 'Tu es un expert en transformation digitale et IA. Fournis des réponses précises et structurées au format JSON demandé.'): Promise<any> => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No content received from OpenAI');
  }

  return JSON.parse(content);
};

export const generateFolderName = async (userInput: string): Promise<GeneratedFolder> => {
  const prompt = folderNamePrompt.replace('{{user_input}}', userInput);
  return callOpenAI(prompt);
};

export const generateUseCaseList = async (userInput: string): Promise<GeneratedUseCaseList> => {
  const prompt = useCaseListPrompt.replace('{{user_input}}', userInput);
  return callOpenAI(prompt);
};

export const generateUseCaseDetail = async (useCaseTitle: string, userInput: string): Promise<GeneratedUseCaseDetail> => {
  const prompt = useCaseDetailPrompt
    .replace(/\{\{use_case\}\}/g, useCaseTitle)
    .replace('{{user_input}}', userInput);
  return callOpenAI(prompt);
};

export const generateUseCases = async (_params: GenerateUseCasesParams) => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  // TODO: Implement full OpenAI orchestration
  return {
    created_folder_id: undefined,
    created_use_case_ids: [],
    summary: 'Generation workflow not implemented yet.'
  };
};

export const enrichCompany = async (params: CompanyEnrichmentParams): Promise<CompanyEnrichmentResult> => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  try {
    const prompt = companyInfoPrompt.replace('{{company_name}}', params.companyName);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en recherche d\'entreprises. Fournis des informations précises et structurées au format JSON demandé.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content received from OpenAI');
    }

    // Nettoyer le contenu pour extraire le JSON
    let jsonContent = content.trim();
    
    // Si le contenu commence par du texte explicatif, extraire le JSON
    const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonContent = jsonMatch[0];
    }

    try {
      // Parser le JSON de la réponse
      const enrichedData = JSON.parse(jsonContent) as CompanyEnrichmentResult;
        
        // Valider que l'industrie correspond à un secteur disponible
        const validIndustries = defaultBusinessConfig.sectors.map(s => s.name);
        if (!validIndustries.includes(enrichedData.industry)) {
          // Si l'industrie n'est pas valide, utiliser "Services" par défaut
          enrichedData.industry = 'Services';
        }

        // S'assurer que tous les champs sont des chaînes de caractères
        const serializedData: CompanyEnrichmentResult = {
          normalizedName: String(enrichedData.normalizedName || ''),
          industry: String(enrichedData.industry || ''),
          size: typeof enrichedData.size === 'object' 
            ? JSON.stringify(enrichedData.size, null, 2)
            : String(enrichedData.size || ''),
          products: typeof enrichedData.products === 'object'
            ? JSON.stringify(enrichedData.products, null, 2)
            : String(enrichedData.products || ''),
          processes: typeof enrichedData.processes === 'object'
            ? JSON.stringify(enrichedData.processes, null, 2)
            : String(enrichedData.processes || ''),
          challenges: typeof enrichedData.challenges === 'object'
            ? JSON.stringify(enrichedData.challenges, null, 2)
            : String(enrichedData.challenges || ''),
          objectives: typeof enrichedData.objectives === 'object'
            ? JSON.stringify(enrichedData.objectives, null, 2)
            : String(enrichedData.objectives || ''),
          technologies: typeof enrichedData.technologies === 'object'
            ? JSON.stringify(enrichedData.technologies, null, 2)
            : String(enrichedData.technologies || '')
        };

        return serializedData;
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      console.error('Raw content:', content);
      throw new Error(`Failed to parse OpenAI response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error enriching company:', error);
    throw new Error(`Failed to enrich company: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
