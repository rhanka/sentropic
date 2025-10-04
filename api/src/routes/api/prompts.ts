import { Hono } from 'hono';
import { z } from 'zod';

const promptsRouter = new Hono();

// Schéma pour la validation des prompts
const promptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  variables: z.array(z.string())
});

const updatePromptsSchema = z.object({
  prompts: z.array(promptSchema)
});

// Configuration des prompts par défaut
const defaultPrompts = [
  {
    id: 'company_info',
    name: 'Enrichissement d\'entreprise',
    description: 'Prompt pour enrichir les informations d\'une entreprise',
    content: `Recherchez et fournissez des informations complètes sur l'entreprise {{company_name}}. 
Les secteurs d'activité disponibles sont: [SECTEURS].
Normalisez le nom de l'entreprise selon son usage officiel.

Réponds UNIQUEMENT avec un JSON valide contenant:
{
  "name": "Nom officiel de l'entreprise",
  "sector": "Secteur d'activité (doit être un des secteurs disponibles)",
  "description": "Description de l'entreprise (2-3 phrases)",
  "website": "Site web officiel",
  "size": "Taille de l'entreprise (Startup, PME, ETI, Grand Groupe)",
  "location": "Localisation principale",
  "businessModel": "Modèle économique principal",
  "keyProducts": ["Produit 1", "Produit 2"],
  "targetMarket": "Marché cible principal",
  "revenue": "Chiffre d'affaires estimé",
  "employees": "Nombre d'employés estimé",
  "founded": "Année de création",
  "headquarters": "Siège social",
  "keyPeople": ["Personne clé 1", "Personne clé 2"],
  "recentNews": ["Actualité récente 1", "Actualité récente 2"],
  "competitors": ["Concurrent 1", "Concurrent 2"],
  "partnerships": ["Partenariat 1", "Partenariat 2"],
  "technologies": ["Technologie 1", "Technologie 2"],
  "challenges": ["Défi 1", "Défi 2"],
  "opportunities": ["Opportunité 1", "Opportunité 2"]
}

IMPORTANT: 
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Assure-toi que le JSON est valide et complet
- Utilise des valeurs réalistes basées sur tes connaissances`,
    variables: ['company_name']
  },
  {
    id: 'folder_name',
    name: 'Génération de nom de dossier',
    description: 'Prompt pour générer un nom et description de dossier',
    content: `Génère un nom et une brève description pour un dossier qui contiendra des cas d'usage d'IA pour le contexte suivant: {{user_input}}.
Le nom doit être court et représentatif du domaine ou secteur d'activité principal.
La description doit expliquer en 1-2 phrases le contenu du dossier.

Réponds UNIQUEMENT avec un JSON valide:
{
  "name": "Nom du dossier",
  "description": "Description du dossier"
}`,
    variables: ['user_input']
  },
  {
    id: 'use_case_list',
    name: 'Liste de cas d\'usage',
    description: 'Prompt pour générer une liste de cas d\'usage',
    content: `Génère une liste de 5 cas d'usage d'IA innovants pour le domaine suivant: {{user_input}}.
Pour chaque cas d'usage, propose un titre court et explicite.
Format: liste numérotée sans description.

Réponds UNIQUEMENT avec un JSON valide:
{
  "useCases": [
    "Cas d'usage 1",
    "Cas d'usage 2", 
    "Cas d'usage 3",
    "Cas d'usage 4",
    "Cas d'usage 5"
  ]
}`,
    variables: ['user_input']
  },
  {
    id: 'use_case_detail',
    name: 'Détail de cas d\'usage',
    description: 'Prompt pour générer un cas d\'usage détaillé avec scoring',
    content: `Génère un cas d'usage détaillé pour "{{use_case}}" dans le contexte suivant: {{user_input}}. 
Utilise la matrice valeur/complexité fournie: {{matrix}} pour évaluer chaque axe de valeur et complexité.

SYSTÈME DE SCORING FIBONACCI:
Pour chaque axe, tu DOIS utiliser UNIQUEMENT une de ces valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
Ces scores sont ensuite mappés aux étoiles (1-5) pour l'affichage.

La réponse doit impérativement contenir tous les éléments suivants au format JSON:
{
  "name": "{{use_case}}",
  "description": "Description détaillée du cas d'usage sur 5-10 lignes",
  "businessContext": "Contexte métier et enjeux",
  "technicalApproach": "Approche technique proposée",
  "expectedBenefits": "Bénéfices attendus",
  "implementationSteps": ["Étape 1", "Étape 2", "Étape 3"],
  "requiredResources": "Ressources nécessaires",
  "timeline": "Délai de mise en œuvre",
  "risks": ["Risque 1", "Risque 2"],
  "successMetrics": ["Métrique 1", "Métrique 2"],
  "valueScores": [
    {
      "axisId": "Nom du 1er axe de valeur",
      "rating": 21,
      "description": "Justification du score Fibonacci choisi"
    }
  ],
  "complexityScores": [
    {
      "axisId": "Nom du 1er axe de complexité", 
      "rating": 8,
      "description": "Justification du score Fibonacci choisi"
    }
  ]
}
IMPORTANT: 
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Pour les scores, utilise UNIQUEMENT les valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
- Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores
- Justifie chaque score Fibonacci choisi dans la description`,
    variables: ['use_case', 'user_input', 'matrix']
  }
];

// GET /api/v1/prompts - Récupérer tous les prompts
promptsRouter.get('/', (c) => {
  return c.json({ prompts: defaultPrompts });
});

// PUT /api/v1/prompts - Mettre à jour les prompts
promptsRouter.put('/', async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = updatePromptsSchema.parse(body);
    
    // Ici on pourrait sauvegarder en base de données
    // Pour l'instant, on retourne juste les données validées
    return c.json({ 
      success: true, 
      message: 'Prompts mis à jour avec succès',
      prompts: validatedData.prompts 
    });
  } catch (error) {
    console.error('Error updating prompts:', error);
    return c.json({ 
      success: false, 
      message: 'Erreur lors de la mise à jour des prompts',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 400);
  }
});

export default promptsRouter;
