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
- Fais une recherche avec le tool web_search pour trouver des informations précises et les plus récentes sur l'entreprise. Utilise web_extract pour obtenir le contenu détaillé des URLs pertinentes.
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
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur les tendances IA dans ce domaine. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets et des technologies actuelles
- Génère le titre et la description pour chaque cas d'usage
- La description doit être en markdown, avec mise en exergue en gras, et le cas échéant en liste bullet point pour être percutante
- Pour chaque cas d'usage, numérote les références (1, 2, 3...) et utilise [1], [2], [3] dans la description pour référencer ces numéros

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "useCases": [
    {
      "titre": "titre court 1",
      "description": "Description courte (60-100 mots) du cas d'usage",
      "ref": "1. [Titre référence 1](url1)\n2. [Titre référence 2](url2)\n..."
    },
    {
      "titre": "titre court 2",
      "description": "Description courte (60-100 mots) du cas d'usage",
      "ref": "1. [Titre référence 1](url1)\n2. [Titre référence 2](url2)\n..."
    },
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
  "description": "Description courte (60-100 mots) qui résume le cas d'usage.",
  "problem": "Le problème métier à résoudre (40-80 mots)",
  "solution": "La solution IA proposée (40-80 mots)",
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
  "benefits": [ // 60-90 mots pour l'ensemble des bénéfices
    "Bénéfice 1", 
    "Bénéfice 2",
    "Bénéfice 3",
    "Bénéfice 4",
    "Bénéfice 5"
  ],
  "metrics": [ // 30-40 mots pour l'ensemble des métriques
    "KPI ou mesure de succès 1",
    "KPI ou mesure de succès 2",
    "KPI ou mesure de succès 3"
  ],
  "risks": [ // 30-40 mots pour l'ensemble des risques
    "Risque 1",
    "Risque 2",
    "Risque 3"
  ],
  "nextSteps": [ // 40-80 mots pour l'ensemble des prochaines étapes
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
  ],
  "valueScores": [
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg business_value)",
      "rating": 0 (ou 1, 3, 5, 8, 13, 21, 34, 55, 89, 100) (score Fibonnacci, selon l'échelle de la matrice),
      "description": "Justification du score (20-30 mots)"
    },
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg time_criticality)",
      "rating": 0 (ou 1, 3, 5, 8, 13, 21, 34, 55, 89, 100) (score Fibonnacci, selon l'échelle de la matrice),
      "description": "Justification du score (20-30 mots)"
    }
    // Complète pour les autres axes de valeur présents dans la matrice
  ],
  "complexityScores": [
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg ai_maturity)",
      "rating": 5 (ex de score Fibonnacci),
      "description": "Justification du score (20-30 mots)"
    },
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg implementation_effort)",
      "rating": 13 (ex de score Fibonnacci),
      "description": "Justification du score (20-30 mots)"
    }
    // Complète pour les autres axes de complexité présents dans la matrice
  ]
}

OBLIGATOIRE:
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur ce type de cas d'usage. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets (références issues du web_search), des technologies actuelles et des retours d'expérience réels
- Consolide la description au regard des nouvelles informations identifiées dans la réflexion et les recherches
- Inclus dans la description des données chiffrées et des tendances du marché quand c'est pertinent avec citation vers références en utilisant [1], [2], [3]... en bonne articulation avec problem et solution
- Tous les champs non numériques (description, problem, solution, chaque items des bénéfices et mesures de succès, risques, prochaines étapes et descriptions des valeur et complexités) doivent être formattée en markdown, avec mises en exergue en gras des éléments importants
- Ne jamais mettre de titre/header/section dans les markdown, et éviter les listes à un seul item
- Les champs description, problem et solution doivent être formattés en markdown, potentiellement multilignes (listes à puces) pour une meilleure lisibilité
- Respecte strictement le nombre de mots par champ (description, problem, solution)
- Le problème doit être évaluée le plus profondément au regard du contexte (de l'entreprise et du cas d'usage si fourni), prenant en compte des données récentes (entreprise et/ou secteur/processus métier) via web_search et si besoin web_extract (avec des URL valide uniquement)
- La solution solution doit prendre en compte ls informations fournies si une entreprise est fournie, et une recherche de solutions potentielles avec référence doit permettre de fiabiliser l'évaluation de complexité, le cas échénat via web_search et potentiellement web_extract
- Bénéfices mesures de succès doivent être basés sur un véritable rationnel et citation vers références
- Les références du web_search pertinentes sont incluses dans la section "references" (pas de référence fictive, et les liens sont vérifiés)
- Numérote les références dans l'ordre (1, 2, 3...) et utilise ces numéros [1], [2], [3]... dans la description et les autres champs pour référencer les sources
- Ne mets pas les "sources" (systèmes ERP et MES fournissant les données) dans les "références"
- Les axes de valeur et complexité doivent être selon la matrice fournie (id exact), et non improvisés
- Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores
- Pour les scores, utilise UNIQUEMENT les valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
- Justifie chaque score Fibonacci choisi dans la description`,
    variables: ['use_case', 'user_input', 'matrix', 'company_info']
  },
  {
    id: 'executive_summary',
    name: 'Synthèse exécutive',
    description: 'Prompt pour générer une synthèse exécutive complète d\'un dossier de cas d\'usage',
    content: `Génère le rapport pour un dossier de cas d'usage d'IA.

Contexte du dossier: {{folder_description}}

Informations de l'entreprise (si disponibles): {{company_info}}

Cas d'usage prioritaires (top cas):
{{top_cas}}

Liste complète des cas d'usage analysés:
{{use_cases}}

Pour chaque cas d'usage, les informations suivantes sont disponibles:
- Nom et description
- Scores de valeur et complexité (matrice de priorisation)
- Bénéfices attendus
- Risques identifiés
- Prochaines étapes suggérées
- Technologies requises
- Métriques de succès

IMPORTANT:
- La liste des cas d'usage prioritaires (top cas) sont fournis ci-dessus - utilise-les comme référence principale pour les recommandations
- Utilise web_extract (mais pas web_search) uniquement en cas de besoin, avec des URLs valides uniquement. Si les cas d'usage n'ont pas de références ou si tu n'as pas d'URLs valides à extraire, n'utilise pas cet outil.
- Fais une analyse stratégique globale de l'ensemble des cas d'usage
- Identifie les tendances, opportunités et défis communs
- Mets l'accent sur les cas d'usage prioritaires dans l'analyse et les recommandations
- Fournis des recommandations actionnables pour la direction
- Utilise un ton professionnel et adapté à un public exécutif
- Structure la réponse en 4 sections distinctes, chaque section en markdown dans un JSON

OBLIGATOIRE: Réponds UNIQUEMENT avec un JSON valide contenant:
{
  "introduction": "...",
  "analyse": "...",
  "recommandation": "...",
  "synthese_executive": "..."
  "references": [ { "title": "description du lien 1", "url": "url du lien 1" }, { "title": "description du lien 2", "url": "url du lien 2" }, ...]
}

Spécification générale des sections
- format markdown, ne PAS reprendre de titre principal (introduction, analyse, recommandation, synthese executive)
- mises en exerge en gras des éléments importants
- listes à puces pour les éléments de liste (évite les listes au sein d'un paragraphe, préfère les listes à puces ou numérotées)
- citations vers les références en utilisant [1], [2], [3] - reprends soit des citations url des top cas d'usage, soit cite les cas eux même (avec leur intitulé exact, sans url)

Spécification de chaque section:
- introduction: Présente le contexte, l'objectif du rapport, de l'analyse et le périmètre couvert. 2 3 paragraphes, sans titre, avec mises en exerge en gras des éléments importants. Si tu listes les cas d'usage, utilise un mode liste à puces ou numérotées.
- analyse: Section d'analyse en markdown (3-5 paragraphes avec chapitres en ##). Analyse les tendances, opportunités, défis et patterns identifiés dans l'ensemble des cas d'usage. Inclut des insights stratégiques. Paragraphe mettant l'accent sur les cas d'usage prioritaires fournis.
- recommandation: Section de recommandations en markdown (4-6 paragraphes avec chapitres en ##). Fournit des recommandations actionnables pour la direction, incluant: 
    - les prochaines étapes immédiates (en priorisant les cas d'usage prioritaires)
    - Une feuille de route suggérée
    - Les investissements nécessaires
    - Les risques à anticiper
    - Les opportunités à saisir
- synthese_executive: Synthèse exécutive du dossier en markdown (2-3 paragraphes sans titre). Résumé concis et percutant pour les décideurs, mettant en avant les points clés, les recommandations principales et l'impact attendu.
`,
    variables: ['folder_description', 'company_info', 'top_cas', 'use_cases']
  }
];
