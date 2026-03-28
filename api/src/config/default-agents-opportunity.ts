/**
 * Opportunity workspace agents — neutral prompts (§8.4).
 * No mention of "AI", "IA", "use case IA", "cas d'usage d'IA".
 * Uses "opportunity", "initiative", "business opportunity" instead.
 */
import type { DefaultGenerationAgentDefinition } from './default-agents-types';

export const OPPORTUNITY_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "opportunity_orchestrator",
    name: "Opportunity orchestrator",
    description:
      "Orchestrates opportunity identification lifecycle and runtime context handoff.",
    sourceLevel: "code",
    config: {
      role: "orchestrator",
      workflowKey: "opportunity_identification",
    },
  },
  {
    key: "matrix_generation_agent",
    name: "Matrix generation agent",
    description:
      "Generates organization-specific matrix descriptions for opportunity scoring. Supports custom axes when customAxes flag is enabled (D).",
    sourceLevel: "code",
    config: {
      role: "matrix_generation",
      baseMatrixId: "opportunity",
      promptId: "opportunity_matrix_template",
      /**
       * customAxes support (D):
       * When customAxes is true, the prompt template is replaced at runtime by
       * customAxesPromptTemplate which allows the LLM to propose new axis names.
       * When false (default), standard behavior: adapt descriptions only, keep axis IDs.
       */
      customAxes: false,
      promptTemplate: `Tu dois adapter les descriptions de niveaux d'une matrice de priorisation d'opportunités pour l'organisation suivante:
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
- regulatory_compliance
- resource_availability
- change_management

IMPORTANT:
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
      customAxesPromptTemplate: `Tu dois proposer une matrice de priorisation d'opportunités adaptée au domaine spécifique de l'organisation suivante:
- Nom: {{organization_name}}
- Contexte organisation: {{organization_info}}

Matrice de référence (structure de base):
{{base_matrix}}

Objectif:
- Proposer des axes de valeur et de complexité adaptés au domaine d'activité de l'organisation.
- Tu peux renommer les axes (nouveaux axisId en snake_case) et proposer de nouvelles descriptions si le domaine le justifie.
- Conserver la même structure globale (valueAxes + complexityAxes) et les mêmes poids/seuils.
- Fournir exactement 5 niveaux (1..5) pour chaque axe.

Contraintes obligatoires:
- Ne jamais changer les poids ni les seuils de la matrice de base.
- Les axisId doivent être en snake_case, uniques, et refléter le domaine.
- Pour chaque axe, fournir un "axisName" (nom lisible) et une "axisDescription" (description courte de l'axe).
- Descriptions concrètes, orientées métier, 1 phrase par niveau.
- Pas de markdown, pas de liste, pas d'entête.
- Proposer 3 axes de valeur et 3-5 axes de complexité adaptés au domaine.

IMPORTANT:
- Répondre UNIQUEMENT avec un JSON valide, sans texte avant/après.

Format JSON attendu:
{
  "valueAxes": [
    {
      "axisId": "custom_axis_id",
      "axisName": "Nom lisible de l'axe",
      "axisDescription": "Description courte de ce que mesure cet axe",
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
      "axisId": "custom_axis_id",
      "axisName": "Nom lisible de l'axe",
      "axisDescription": "Description courte de ce que mesure cet axe",
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
    key: "opportunity_list_agent",
    name: "Opportunity list agent",
    description:
      "Generates a structured list of candidate opportunities from folder context.",
    sourceLevel: "code",
    config: {
      role: "opportunity_list_generation",
      promptId: "opportunity_list",
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
              },
              required: ['titre', 'description', 'ref'],
            },
          },
        },
        required: ['dossier', 'initiatives'],
      },
      promptTemplate: `Génère une liste d'opportunités business selon la demande suivante:
    - la demande utilisateur spécifique suivante: {{user_input}},
    - le nom de dossier fourni par l'utilisateur (si non vide): {{folder_name}},
    - les informations de l'organisation: {{organization_info}},
    - les organisations disponibles dans le workspace: {{organizations_list}},
    - le nombre d'opportunités à générer: {{use_case_count}}
Pour chaque opportunité, propose un titre court et explicite.
Format: JSON

IMPORTANT:
- Génère exactement {{use_case_count}} opportunités (ni plus, ni moins)
- Si {{folder_name}} est non vide, réutiliser ce nom tel quel dans le champ JSON "dossier" (ne pas inventer un autre nom)
- Si {{folder_name}} est vide, générer un nom de dossier pertinent (ne jamais utiliser "Brouillon")
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur les tendances du marché et les opportunités business dans ce domaine. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets, des analyses de marché et des tendances actuelles
- Génère le titre et la description pour chaque opportunité
- La description doit être en markdown, avec mise en exergue en gras, et le cas échéant en liste bullet point pour être percutante
- Pour chaque opportunité, numérote les références (1, 2, 3...) et utilise [1], [2], [3] dans la description pour référencer ces numéros
- Si des organisations sont listées dans {{organizations_list}}, mappe chaque opportunité à une ou plusieurs organisations pertinentes via le champ "organizationIds" (tableau d'IDs). Une opportunité peut concerner plusieurs organisations si le périmètre le justifie.
- Si aucune organisation n'est disponible, omets le champ "organizationIds"

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "initiatives": [
    {
      "titre": "titre court 1",
      "description": "Description courte (60-100 mots) de l'opportunité business",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": ["org_id_1", "org_id_2"]
    },
    {
      "titre": "titre court 2",
      "description": "Description courte (60-100 mots) de l'opportunité business",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n...",
      "organizationIds": ["org_id_1"]
    },
    ...
  ]
}`,
    },
  },
  {
    key: "opportunity_list_with_orgs_agent",
    name: "Opportunity list with orgs agent",
    description:
      "Generates a structured list of candidate opportunities oriented around selected organizations.",
    sourceLevel: "code",
    config: {
      role: "initiative_list_with_orgs",
      promptId: "use_case_list_with_orgs",
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
              },
              required: ['titre', 'description', 'ref'],
            },
          },
        },
        required: ['dossier', 'initiatives'],
      },
      promptTemplate: `Génère une liste d'opportunités business orientées autour des organisations sélectionnées.

Contexte:
- Demande utilisateur: {{user_input}}
- Nom de dossier (si non vide): {{folder_name}}
- Informations de l'organisation principale: {{organization_info}}
- Nombre d'opportunités à générer: {{use_case_count}}

Organisations sélectionnées (contexte détaillé):
{{organizations_context}}

Pour chaque opportunité, propose un titre court et explicite orienté autour des organisations ci-dessus.
Format: JSON

IMPORTANT:
- Génère exactement {{use_case_count}} opportunités (ni plus, ni moins)
- Si {{folder_name}} est non vide, réutiliser ce nom tel quel dans le champ JSON "dossier" (ne pas inventer un autre nom)
- Si {{folder_name}} est vide, générer un nom de dossier pertinent (ne jamais utiliser "Brouillon")
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur les tendances du marché et les opportunités business pour ces organisations. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets, des analyses de marché et des tendances actuelles
- Oriente chaque opportunité vers une ou plusieurs des organisations sélectionnées
- Génère le titre et la description pour chaque opportunité
- La description doit être en markdown, avec mise en exergue en gras, et le cas échéant en liste bullet point pour être percutante
- Pour chaque opportunité, numérote les références (1, 2, 3...) et utilise [1], [2], [3] dans la description pour référencer ces numéros

Réponds UNIQUEMENT avec un JSON valide:
{
  "dossier": "titre court du dossier",
  "initiatives": [
    {
      "titre": "titre court 1",
      "description": "Description courte (60-100 mots) de l'opportunité business orientée organisation",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n..."
    },
    {
      "titre": "titre court 2",
      "description": "Description courte (60-100 mots) de l'opportunité business orientée organisation",
      "ref": "1. [Titre référence 1](url1)\\n2. [Titre référence 2](url2)\\n..."
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
    key: "opportunity_detail_agent",
    name: "Opportunity detail agent",
    description:
      "Generates one detailed opportunity payload with validated score blocks.",
    sourceLevel: "code",
    config: {
      role: "opportunity_detail_generation",
      promptId: "opportunity_detail",
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
          'references',
          'valueScores',
          'complexityScores',
        ],
      },
      promptTemplate: `Génère une opportunité business détaillée pour l'opportunité suivante: {{use_case}}"

    Le contexte initial de l'opportunité était le suivant: {{user_input}}.

Les informations de l'organisation sont les suivantes: {{organization_info}}

Utilise la matrice valeur/complexité fournie pour évaluer chaque axe de valeur et complexité : {{matrix}}

La réponse doit impérativement contenir tous les éléments suivants au format JSON:
{
  "name": "{{use_case}}",
  "description": "Description courte (60-100 mots) qui résume l'opportunité business.",
  "problem": "Le problème client ou marché que cette opportunité adresse (40-80 mots)",
  "solution": "La solution, le produit ou le service proposé (40-80 mots)",
  "domain": "Le domaine d'application principal (industrie, marché ou segment)",
  "technologies": [
    "technologie ou compétence clé 1",
    "technologie ou compétence clé 2",
    "technologie ou compétence clé 3"
  ],
  "leadtime": "Estimation du délai de mise en œuvre relativement à la complexité de l'opportunité (ex: 3 mois, 6 mois, 36 mois...)",
  "contact": "Nom du responsable suggéré (rôle ex directeur commercial, responsable développement)",
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
  "constraints": [
    "Contrainte 1",
    "Contrainte 2",
    "Contrainte 3"
  ],
  "nextSteps": [
    "Étape 1",
    "Étape 2",
    "Étape 3",
    "Étape 4"
  ],
  "references": [
    { "title": "description du lien 1", "url": "url web_search du lien 1", "excerpt": "extrait factuel (1-2 phrases)" },
    { "title": "description du lien 2", "url": "url web_search du lien 2", "excerpt": "extrait factuel (1-2 phrases)" },
    ...
  ],
  "valueScores": [
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg business_value)",
      "rating": 0,
      "description": "Justification du score (20-30 mots)"
    },
    {
      "axisId": "id de l'axe de valeur (selon la matrice, eg time_criticality)",
      "rating": 0,
      "description": "Justification du score (20-30 mots)"
    }
  ],
  "complexityScores": [
    {
      "axisId": "id de l'axe de complexité (selon la matrice, eg implementation_effort)",
      "rating": 5,
      "description": "Justification du score (20-30 mots)"
    },
    {
      "axisId": "id de l'axe de complexité (selon la matrice, eg regulatory_compliance)",
      "rating": 13,
      "description": "Justification du score (20-30 mots)"
    }
  ]
}

OBLIGATOIRE:
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Fais une recherche avec le tool web_search pour trouver des informations récentes sur ce type d'opportunité. Utilise web_extract pour obtenir le contenu détaillé des URLs qui semblent pertinentes (et uniquement si tu as des URLs valides à extraire).
- Base-toi sur des exemples concrets (références issues du web_search), des analyses de marché actuelles et des retours d'expérience réels
- Consolide la description au regard des nouvelles informations identifiées dans la réflexion et les recherches
- Inclus dans la description des données chiffrées et des tendances du marché quand c'est pertinent avec citation vers références en utilisant [1], [2], [3]... en bonne articulation avec problem et solution
- Tous les champs non numériques (description, problem, solution, chaque items des bénéfices et mesures de succès, risques, prochaines étapes et descriptions des valeur et complexités) doivent être formattée en markdown, avec mises en exerge en gras des éléments importants
- Ne jamais mettre de titre/header/section dans les markdown, et éviter les listes à un seul item
- Les champs description, problem et solution doivent être formattés en markdown, potentiellement multilignes (listes à puces) pour une meilleure lisibilité
- Respecte strictement le nombre de mots par champ (description, problem, solution)
- Le problème doit être évalué le plus profondément au regard du contexte client/marché (de l'entreprise et de l'opportunité si fourni), prenant en compte des données récentes (entreprise et/ou secteur/marché) via web_search et si besoin web_extract (avec des URL valide uniquement)
- La solution doit prendre en compte les informations fournies si une entreprise est fournie, et une recherche de solutions potentielles avec référence doit permettre de fiabiliser l'évaluation de complexité, le cas échéant via web_search et potentiellement web_extract
- Bénéfices et mesures de succès doivent être basés sur un véritable rationnel et citation vers références
- Les références du web_search pertinentes sont incluses dans la section "references" (pas de référence fictive, et les liens sont vérifiés)
- Numérote les références dans l'ordre (1, 2, 3...) et utilise ces numéros [1], [2], [3]... dans la description et les autres champs pour référencer les sources
- Les axes de valeur et complexité doivent être selon la matrice fournie (id exact), et non improvisés
- Veille à ce que chaque axe de la matrice fournie ait bien son score correspondant dans les sections valueScores et complexityScores
- Pour les scores, utilise UNIQUEMENT les valeurs Fibonacci: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100]
- Justifie chaque score Fibonacci choisi dans la description
- Ne pas ajouter de champs qui ne sont pas dans le format JSON ci-dessus`,
    },
  },
  {
    key: "executive_synthesis_agent",
    name: "Executive synthesis agent",
    description:
      "Generates executive summary narrative and prioritization synthesis for opportunities.",
    sourceLevel: "code",
    config: {
      role: "executive_summary_generation",
      promptId: "opportunity_executive_summary",
      promptTemplate: `Génère le rapport pour un dossier d'opportunités business.

Contexte du dossier: {{folder_description}}

Informations de l'organisation (si disponibles): {{organization_info}}

Opportunités prioritaires (top opportunités):
{{top_cas}}

Liste complète des opportunités analysées:
{{use_cases}}

Pour chaque opportunité, les informations suivantes sont disponibles:
- Nom et description
- Scores de valeur et complexité (matrice de priorisation)
- Bénéfices attendus
- Risques identifiés
- Prochaines étapes suggérées
- Métriques de succès

IMPORTANT:
- La liste des opportunités prioritaires (top opportunités) sont fournies ci-dessus - utilise-les comme référence principale pour les recommandations
- Utilise web_extract (mais pas web_search) uniquement en cas de besoin, avec des URLs valides uniquement. Si les opportunités n'ont pas de références ou si tu n'as pas d'URLs valides à extraire, n'utilise pas cet outil.
- Fais une analyse stratégique globale de l'ensemble des opportunités
- Identifie les tendances de marché, les synergies et les défis communs
- Mets l'accent sur les opportunités prioritaires dans l'analyse et les recommandations
- Évalue l'adéquation avec le positionnement de l'organisation et ses capacités
- Fournis des recommandations actionnables pour la direction, orientées création de valeur et positionnement compétitif
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
- citations vers les références en utilisant [1], [2], [3] - reprends soit des citations url des top opportunités, soit cite les opportunités elles-mêmes (avec leur intitulé exact, sans url)

Spécification de chaque section:
- introduction: Présente le contexte, l'objectif du rapport, de l'analyse et le périmètre couvert. 2-3 paragraphes, sans titre, avec mises en exerge en gras des éléments importants. Si tu listes les opportunités, utilise un mode liste à puces ou numérotées.
- analyse: Section d'analyse en markdown (3-5 paragraphes avec chapitres en ##). Analyse les tendances de marché, synergies, défis et patterns identifiés dans l'ensemble des opportunités. Inclut des insights stratégiques sur le positionnement compétitif et l'adéquation marché. Paragraphe mettant l'accent sur les opportunités prioritaires fournies.
- recommandation: Section de recommandations en markdown (4-6 paragraphes avec chapitres en ##). Fournit des recommandations actionnables pour la direction, incluant:
    - les prochaines étapes immédiates (en priorisant les opportunités prioritaires)
    - Une feuille de route suggérée
    - Les investissements nécessaires
    - Les risques à anticiper
    - Les opportunités de marché à saisir
- synthese_executive: Synthèse exécutive du dossier en markdown (2-3 paragraphes sans titre). Résumé concis et percutant pour les décideurs, mettant en avant les points clés, les recommandations principales et l'impact business attendu.
`,
    },
  },
];
