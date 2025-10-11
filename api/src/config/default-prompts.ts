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
- Fais une recherche avec le tool web_search pour trouver des informations précises et les plus récentes sur l'entreprise
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
    - le nombre de cas d'usage demandés par l'utilisateur, sinon génère {{use_case_count}} cas d'usages
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
    {"titre": "titre court 1", "description": "Description cas d'usage 1", "ref": "références 1 en liste markdown avec liens web vers des références "},
    {"titre": "titre court 2", "description": "Description cas d'usage 2", "ref": "références 2 en liste markdown avec liens web vers des références "},
    ...
  ]
}`,
    variables: ['user_input', 'company_info', 'use_case_count']
  },
  {
    id: 'use_case_detail',
    name: 'Détail de cas d\'usage',
    description: 'Prompt pour générer un cas d\'usage détaillé avec scoring',
    content: `Génère un cas d'usage détaillé pour le cas d'usage suivant: {{use_case}}"

    Le contexte initial du cas d'usage était le suivant: {{user_input}}.

Les informations de l'entreprise sont les suivantes: {{company_info}}

Utilise la matrice valeur/complexité fournie pour évaluer chaque axe de valeur et complexité : {{matrix}}


La réponse doit impérativement contenir tous les éléments suivants au format JSON:
{
  "name": "{{use_case}}",
  "description": "Description détaillée en markdown du cas d'usage sur 5-10 lignes",
  "domain": "Le domaine d'application principal (industrie ou processus)",
  "technologies": [
    "technologie 1 (e.g IA / NLP, computer vision, etc.)",
    "technologie 2 (e.g IA / NLP, computer vision, etc.)",
    "technologie 3 (e.g IA / NLP, computer vision, etc.)",
    ...
  ],
  "leadtime": "Estimation du délai de mise en œuvre relativement à la complexité du cas d'usage (ex: 3 mois, 6 mois, 36 mois...)",
  "prerequisites": "Prérequis pour la mise en œuvre du cas d'usage (ex: Datalake, Historien IoT, Senseurs, etc.)",
  "contact": "Nom du responsable suggéré (rôle ex responsable opérations)",
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
  "dataSources": [
    "Source de données 1 (ex ERP ou MES)",
    "Source de données 2"
  ],
  "dataObjects": [
    "Donnée associée 1 ex Ordre de production",
    "Donnée associée 2",
    "Donnée associée 3"
  ],
  "references": [
    { "title": "description du lien 1", "url": "url web_search du lien 1" },
    { "title": "description du lien 2", "url": "url web_search du lien 2" },
    ...
  ]
  "valueScores": [
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg business_value)",
      "rating": 0 (ou 1, 3, 5, 8, 13, 21, 34, 55, 89, 100) (score Fibonnacci, selon l'échelle de la matrice),
      "description": "Justification du score"
    },
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg time_criticality)",
      "rating": 0 (ou 1, 3, 5, 8, 13, 21, 34, 55, 89, 100) (score Fibonnacci, selon l'échelle de la matrice),
      "description": "Justification du score"
    }
    // Complète pour les autres axes de valeur présents dans la matrice
  ],
  "complexityScores": [
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg ai_maturity)",
      "rating": 5 (ex de score Fibonnacci),
      "description": "Justification du score"
    },
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg implementation_effort)",
      "rating": 13 (ex de score Fibonnacci),
      "description": "Justification du score"
    }
    // Complète pour les autres axes de complexité présents dans la matrice
  ]
}

OBLIGATOIRE:
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur ce type de cas d'usage
- Base-toi sur des exemples concrets (références issues du web_search), des technologies actuelles et des retours d'expérience réels
- Inclus dans la description des données chiffrées et des tendances du marché quand c'est pertinent avec citation vers références
- La description doit être formattée en markdown
- Bénéfices mesures de succès doivent être basé sur un véritable rationnel et citation vers références
- Les références du web_search pertinentes sont incluses dans la section "references" (pas de référence fictive, et les liens sont vérifiés)
- Ne mets pas les "sources" (systèmes ERP et MES fournissant les données) dans les "références"
- Les axes de valeur et complexité doivent être selon la matrice fournie (id exact), et non improvisés
- Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores
- Pour les scores, utilise UNIQUEMENT les valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
- Justifie chaque score Fibonacci choisi dans la description`,
    variables: ['use_case', 'user_input', 'matrix', 'company_info']
  }
];
