/**
 * AI-Ideas workspace agents (existing 6 agents with embedded prompts).
 */
import type { DefaultGenerationAgentDefinition } from './default-agents-types';

export const AI_IDEAS_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "generation_orchestrator",
    name: "Generation orchestrator",
    description:
      "Orchestrates AI use-case generation lifecycle and runtime context handoff.",
    sourceLevel: "code",
    config: {
      role: "orchestrator",
      workflowKey: "ai_usecase_generation_v1",
    },
  },
  {
    key: "matrix_generation_agent",
    name: "Matrix generation agent",
    description:
      "Generates organization-specific matrix descriptions for use-case scoring.",
    sourceLevel: "code",
    config: {
      role: "matrix_generation",
      promptId: "organization_matrix_template",
      promptTemplate: `Tu dois adapter les descriptions de niveaux d'une matrice de priorisation IA pour l'organisation suivante:
- Nom: {{organization_name}}
- Contexte organisation: {{organization_info}}

Matrice de base (axes, poids, seuils - NE PAS MODIFIER):
{{base_matrix}}

Objectif:
- Conserver STRICTEMENT la structure de la matrice de base (ids d'axes, poids, seuils).
- Adapter UNIQUEMENT les textes des levelDescriptions pour refléter le contexte métier de l'organisation.

Contraintes obligatoires:
- Ne jamais changer les axisId.
- Ne jamais changer les poids.
- Ne jamais changer les seuils.
- Fournir exactement 5 niveaux (1..5) pour chaque axe demandé.
- Descriptions concrètes, orientées métier, 1 phrase par niveau.
- Pas de markdown, pas de liste, pas d'entête.

Axes de valeur à adapter:
- business_value
- time_criticality
- risk_reduction_opportunity

Axes de complexité à adapter:
- implementation_effort
- data_compliance
- data_availability
- change_management

IMPORTANT:
- Ne PAS inclure ai_maturity dans la réponse.
- Répondre UNIQUEMENT avec un JSON valide, sans texte avant/après.

Format JSON attendu:
{
  "valueAxes": [
    {
      "axisId": "business_value",
      "levelDescriptions": [
        { "level": 1, "description": "..." },
        { "level": 2, "description": "..." },
        { "level": 3, "description": "..." },
        { "level": 4, "description": "..." },
        { "level": 5, "description": "..." }
      ]
    }
  ],
  "complexityAxes": [
    {
      "axisId": "implementation_effort",
      "levelDescriptions": [
        { "level": 1, "description": "..." },
        { "level": 2, "description": "..." },
        { "level": 3, "description": "..." },
        { "level": 4, "description": "..." },
        { "level": 5, "description": "..." }
      ]
    }
  ]
}`,
    },
  },
  {
    key: "usecase_list_agent",
    name: "Use-case list agent",
    description:
      "Generates a structured list of candidate use-cases from folder context.",
    sourceLevel: "code",
    config: {
      role: "usecase_list_generation",
      promptId: "use_case_list",
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dossier: { type: 'string' },
          initiatives: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                titre: { type: 'string' },
                description: { type: 'string' },
                ref: { type: 'string' },
                organizationIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Organization IDs this initiative relates to',
                },
              },
              required: ['titre', 'description', 'ref'],
            },
          },
        },
        required: ['dossier', 'initiatives'],
      },
      promptTemplate: `Génère une liste de cas d'usage d'IA innovants selon la demande suivante:
    - la demande utilisateur spécifique suivante: {{user_input}},
    - le nom de dossier fourni par l'utilisateur (si non vide): {{folder_name}},
    - les informations de l'organisation: {{organization_info}},
    - les organisations disponibles dans le workspace: {{organizations_list}},
    - le nombre de cas d'usage à générer: {{use_case_count}}
Pour chaque cas d'usage, propose un titre court et explicite.
Format: JSON

IMPORTANT:
- Génère exactement {{use_case_count}} cas d'usages (ni plus, ni moins)
- Si {{folder_name}} est non vide, réutiliser ce nom tel quel dans le champ JSON "dossier" (ne pas inventer un autre nom)
- Si {{folder_name}} est vide, générer un nom de dossier pertinent (ne jamais utiliser "Brouillon")
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur les tendances IA dans ce domaine. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets et des technologies actuelles
- Génère le titre et la description pour chaque cas d'usage
- La description doit être en markdown, avec mise en exergue en gras, et le cas échéant en liste bullet point pour être percutante
- Pour chaque cas d'usage, numérote les références (1, 2, 3...) et utilise [1], [2], [3] dans la description pour référencer ces numéros
- Si des organisations sont listées dans {{organizations_list}}, mappe chaque cas d'usage à une ou plusieurs organisations pertinentes via le champ "organizationIds" (tableau d'IDs). Un cas d'usage peut concerner plusieurs organisations si le périmètre le justifie.
- Si aucune organisation n'est disponible, omets le champ "organizationIds"

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "initiatives": [
    {
      "titre": "titre court 1",
      "description": "Description courte (60-100 mots) du cas d'usage",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": ["org_id_1", "org_id_2"]
    },
    {
      "titre": "titre court 2",
      "description": "Description courte (60-100 mots) du cas d'usage",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": ["org_id_1"]
    },
    ...
  ]
}`,
    },
  },
  {
    key: "todo_projection_agent",
    name: "TODO projection agent",
    description:
      "Projects generated list outputs to TODO runtime tracking structures.",
    sourceLevel: "code",
    config: {
      role: "todo_projection",
    },
  },
  {
    key: "usecase_detail_agent",
    name: "Use-case detail agent",
    description:
      "Generates one detailed use-case payload with validated score blocks.",
    sourceLevel: "code",
    config: {
      role: "usecase_detail_generation",
      promptId: "use_case_detail",
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          problem: { type: 'string' },
          solution: { type: 'string' },
          domain: { type: 'string' },
          technologies: { type: 'array', items: { type: 'string' } },
          leadtime: { type: 'string' },
          prerequisites: { type: 'string' },
          contact: { type: 'string' },
          benefits: { type: 'array', items: { type: 'string' } },
          metrics: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
          constraints: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 3 },
          },
          nextSteps: { type: 'array', items: { type: 'string' } },
          dataSources: { type: 'array', items: { type: 'string' } },
          dataObjects: { type: 'array', items: { type: 'string' } },
          references: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                excerpt: { type: 'string' },
              },
              required: ['title', 'url', 'excerpt'],
            },
          },
          valueScores: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string' },
                rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
                description: { type: 'string' },
              },
              required: ['axisId', 'rating', 'description'],
            },
          },
          complexityScores: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string' },
                rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
                description: { type: 'string' },
              },
              required: ['axisId', 'rating', 'description'],
            },
          },
        },
        required: [
          'name',
          'description',
          'problem',
          'solution',
          'domain',
          'technologies',
          'leadtime',
          'prerequisites',
          'contact',
          'benefits',
          'metrics',
          'risks',
          'constraints',
          'nextSteps',
          'dataSources',
          'dataObjects',
          'references',
          'valueScores',
          'complexityScores',
        ],
      },
      promptTemplate: `Génère un cas d'usage détaillé pour le cas d'usage suivant: {{use_case}}"

    Le contexte initial du cas d'usage était le suivant: {{user_input}}.

Les informations de l'organisation sont les suivantes: {{organization_info}}

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
  "contact": "Nom du responsable suggéré (rôle ex responsable opérations)",
  "benefits": [ // 60-90 mots pour l'ensemble des bénéfices
    "Bénéfice 1",
    "Bénéfice 2",
    "Bénéfice 3",
    "Bénéfice 4",
    "Bénéfice 5"
  ],
  "metrics": [ // 30-40 mots pour l'ensemble des métriques, alignés avec les kpis de l'organisation si fournis dans le JSON de l'organisation
    "KPI ou mesure de succès 1",
    "KPI ou mesure de succès 2",
    "KPI ou mesure de succès 3"
  ],
  "risks": [ // 30-40 mots pour l'ensemble des risques
    "Risque 1",
    "Risque 2",
    "Risque 3"
  ],
  "constraints": [ // 60-90 mots pour l'ensemble des contraintes et prérequis (techniques, business, réglementaires, etc.). IMPORTANT: chaque item doit etre une phrase non vide, sans puce/marker ("-", "—", "•") et sans texte placeholder.
    "Contrainte 1",
    "Contrainte 2",
    "Contrainte 3"
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
    { "title": "description du lien 1", "url": "url web_search du lien 1", "excerpt": "extrait factuel (1-2 phrases)" },
    { "title": "description du lien 2", "url": "url web_search du lien 2", "excerpt": "extrait factuel (1-2 phrases)" },
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
- Tous les champs non numériques (description, problem, solution, chaque items des bénéfices et mesures de succès, risques, prochaines étapes et descriptions des valeur et complexités) doivent être formattée en markdown, avec mises en exerge en gras des éléments importants
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
    },
  },
  {
    key: "executive_synthesis_agent",
    name: "Executive synthesis agent",
    description:
      "Generates executive summary narrative and prioritization synthesis.",
    sourceLevel: "code",
    config: {
      role: "executive_summary_generation",
      promptId: "executive_summary",
      promptTemplate: `Génère le rapport pour un dossier de cas d'usage d'IA.

Contexte du dossier: {{folder_description}}

Informations de l'organisation (si disponibles): {{organization_info}}

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
    },
  },
];
