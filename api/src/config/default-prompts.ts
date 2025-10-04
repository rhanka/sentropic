// Configuration des prompts par défaut
export const defaultPrompts = [
  {
    id: 'company_info',
    name: 'Enrichissement d\'entreprise',
    description: 'Prompt pour enrichir les informations d\'une entreprise',
    content: `Recherchez et fournissez des informations complètes sur l'entreprise {{company_name}}. 
Les secteurs d'activité disponibles sont: {{industries}}.
Normalisez le nom de l'entreprise selon son usage officiel.

Réponds UNIQUEMENT avec un JSON valide contenant:
{
  "name": "Nom officiel de l'entreprise",
  "industry": "Secteur d'activité principal",
  "size": "Taille en nombre d'employés et chiffre d'affaires si disponible",
  "products": "Description détaillée des principaux produits ou services",
  "processes": "Description des processus métier clés",
  "challenges": "Défis principaux auxquels l'entreprise est confrontée actuellement",
  "objectives": "Objectifs stratégiques connus de l'entreprise",
  "technologies": "Technologies ou systèmes d'information déjà utilisés"
}

IMPORTANT: 
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Assure-toi que le JSON est valide et complet
- Fais une recherche avec le tool web_search pour trouver des informations sur l'entreprise
- Quand le texte est long dans les valeurs string du JSON, formatte en markdown et préfère les listes (markdown) aux points virgules`,
    variables: ['company_name', 'industries']
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
    variables: ['user_input','company_info']
  },
  {
    id: 'use_case_list',
    name: 'Liste de cas d\'usage',
    description: 'Prompt pour générer une liste de cas d\'usage',
    content: `Génère une liste de cas d'usage d'IA innovants selon la demande suivante:
    - la demande utilisateur spécifique suivante: {{user_input}},
    - les informations de l'entreprise: {{company_info}},
    - le nombre de cas d'usage demandés par l'utilisateur, sinon génère 10 cas d'usages
Pour chaque cas d'usage, propose un titre court et explicite.
Format: JSON

IMPORTANT: 
- Génère le nombre de cas d'usage demandés par l'utilisateur, sinon génère 10 cas d'usages
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur les tendances IA dans ce domaine
- Base-toi sur des exemples concrets et des technologies actuelles

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "useCases": [
    {"titre: "titre court 1", "description": "Description cas d'usage 1", "ref": "références 1 en liste markdown avec liens web vers des références "},
    {"titre: "titre court 2", "description": "Description cas d'usage 2", "ref": "références 1 en liste markdown avec liens web vers des références "},
    ...
  ]
}`,
    variables: ['user_input', 'company_info']
  },
  {
    id: 'use_case_detail',
    name: 'Détail de cas d\'usage',
    description: 'Prompt pour générer un cas d\'usage détaillé avec scoring',
    content: `Génère un cas d'usage détaillé pour "{{use_case}}" dans le contexte suivant: {{user_input}}. 
Utilise la matrice valeur/complexité fournie: {{matrix}} pour évaluer chaque axe de valeur et complexité.

IMPORTANT: 
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur ce type de cas d'usage
- Base-toi sur des exemples concrets, des technologies actuelles et des retours d'expérience réels
- Inclus des données chiffrées et des tendances du marché quand c'est pertinent

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
