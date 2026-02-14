// Configuration des prompts par défaut
export const defaultPrompts = [
  {
    id: 'chat_reasoning_effort_eval',
    name: 'Chat — Évaluer le besoin d’effort de raisonnement',
    description: 'Sous-prompt interne: estimer (none/low/medium/high/xhigh) le reasoningEffort nécessaire pour répondre à la dernière question utilisateur, à partir du contexte récent',
    content: `Tu es un classificateur. Objectif: estimer l'effort de raisonnement nécessaire pour répondre correctement à la DERNIÈRE question utilisateur.

Définitions:
- none: ne pas produire de reasoning (réponse immédiate/évidente, ou simple exécution). IMPORTANT: c'est plus faible que low.
- low: question simple, réponse directe, peu d'ambiguïté, faible risque d'erreur.
- medium: nécessite synthèse/raisonnement modéré, un type de tool appelé, mais reste maîtrisable.
- high: question complexe ou à fort enjeu; nécessite raisonnement poussé, vérifications, ou d'organiser l'orchestration de plusieurs tools (cas d'usage, recherche web, documents).
- xhigh: demande explicite de l'utilisateur de faire un effort de raisonnement (suite à première réponse ou erreur); question très complexe/à très fort enjeu; nécessite raisonnement maximal, attention aux erreurs, et validations supplémentaires.

Dernière question utilisateur:
---
{{last_user_message}}
---

Contexte récent (extrait):
---
{{context_excerpt}}
---

Répondre avec EXACTEMENT UN SEUL TOKEN (sans guillemets, sans JSON, sans ponctuation, sans nouvelle ligne):
none|low|medium|high|xhigh`,
    variables: ['last_user_message', 'context_excerpt']
  },
  {
    id: 'chat_system_base',
    name: 'Chat — System prompt (base)',
    description: 'Base prompt for the chat assistant with injected context/documents blocks',
    content: `Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.

{{CONTEXT_BLOCK}}

{{DOCUMENTS_BLOCK}}

{{AUTOMATION_BLOCK}}`,
    variables: ['CONTEXT_BLOCK', 'DOCUMENTS_BLOCK', 'AUTOMATION_BLOCK']
  },
  {
    id: 'chat_conversation_auto',
    name: 'Chat — Automatisation conversation',
    description: 'Mini-règles pour guider l’automatisation de la conversation',
    content: `Mini-règles d’automatisation :
- Si l’utilisateur donne un objectif clair, propose une action directe et exécute-la.
- Si des infos manquent, pose une seule question ciblée avant d’agir.
- Évite les réponses vagues, privilégie des étapes concrètes.`,
    variables: []
  },
  {
    id: 'chat_session_title',
    name: 'Chat — Titre de session',
    description: 'Générer un titre court pour une session de chat',
    content: `Génère un titre court (3 à 6 mots) pour cette conversation.
Contexte: {{primary_context_label}}
Message utilisateur: {{last_user_message}}

Contraintes:
- Sans guillemets, sans markdown
- Pas de ponctuation finale
- Pas d’identifiants (UUID, ids)
- Si le message est vide, retourne "Conversation"

Réponds uniquement avec le titre.`,
    variables: ['primary_context_label', 'last_user_message']
  },
  {
    id: 'comment_resolution_assistant',
    name: 'Comment resolution assistant',
    description: 'Generate a structured proposal to resolve comment threads',
    content: `You are a comment resolution assistant.

Context label: {{context_label}}
Current user: {{current_user_id}} (role={{current_user_role}})
Max actions: {{max_actions}}

You receive:
- THREADS_JSON: list of comment threads scoped to the current context.
- USERS_JSON: list of user labels for reference (id, displayName, email).

Your job:
1) Analyze open threads and propose the minimal set of resolution actions.
2) Return a JSON object with:
{
  "summary_markdown": "A concise French summary of the proposal (bullet list preferred)",
  "actions": [
    {
      "thread_id": "thread id from THREADS_JSON",
      "action": "close|reassign|note",
      "reassign_to": "user id from USERS_JSON (optional, only for reassign)",
      "note": "short note to post in the thread (optional, only for note)"
    }
  ],
  "confirmation_prompt": "A short French confirmation prompt asking to proceed",
  "confirmation_options": ["Confirmer", "Annuler"]
}

Rules:
- Only use thread_id values present in THREADS_JSON.
- Only propose actions for open threads.
- Do not exceed Max actions.
- Prefer close + optional note when the thread looks resolved.
- If reassignment is needed, use a user id from USERS_JSON.
- Keep summary_markdown and confirmation_prompt in French.
- Return ONLY valid JSON, no extra text.

THREADS_JSON:
{{threads_json}}

USERS_JSON:
{{users_json}}`,
    variables: [
      'context_label',
      'current_user_id',
      'current_user_role',
      'max_actions',
      'threads_json',
      'users_json'
    ]
  },
  {
    id: 'organization_info',
    name: 'Enrichissement d\'organisation',
    description: 'Prompt pour enrichir les informations d\'une organisation',
    content: `Recherchez et fournissez des informations complètes sur l'organisation {{organization_name}}.
Informations déjà renseignées (peuvent être partielles / vides): {{existing_data}}
ID d'organisation (si connu): {{organization_id}}

Les secteurs d'activité disponibles sont: {{industries}}.
Normalisez le nom de l'organisation selon son usage officiel.
La date actuelle est ${new Date().toISOString()}.

Réponds UNIQUEMENT avec un JSON valide contenant:
{
  "name": "Nom officiel de l'organisation",
  "industry": "Secteur d'activité principal",
  "size": "Taille en nombre d'employés et chiffre d'affaires si disponible",
  "products": "Description détaillée des principaux produits ou services",
  "processes": "Description des processus métier clés",
  "kpis": "Indicateurs de performance (une string markdown, idéalement en liste à puces) — mélange sectoriel + spécifique à l'organisation",
  "challenges": "Défis principaux auxquels l'organisation est confrontée actuellement",
  "objectives": "Objectifs stratégiques connus de l'organisation",
  "technologies": "Technologies ou systèmes d'information déjà utilisés",
  "references": [
    { "title": "titre court", "url": "url web_search", "excerpt": "extrait factuel (1-2 phrases)" }
  ]
}

IMPORTANT:
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après
- Assure-toi que le JSON est valide et complet
- Ne jamais mettre de titre/header/section dans les markdown, et éviter les listes à un seul item
- Si l'outil \`documents\` est disponible, commence par l'utiliser UNIQUEMENT ainsi:
  1) \`documents\` action=list (contextType=organization, contextId={{organization_id}}) pour voir les documents.
  2) Pour chaque document pertinent, appelle \`documents\` action=get_summary (évite get_content sauf nécessité).
  3) Utilise ensuite ces informations documentaires comme source prioritaire (plus fiable que le web).
- Fais une recherche avec le tool web_search pour compléter (ou si aucun document n'est disponible).
- Utilise web_extract pour obtenir le contenu détaillé des URLs pertinentes s'il le faut
- Chacun des champs, en particulier taille (nombre employés et chiffre d'affaires), technologies IT (regarder les recrutements) et kpis doivent être fondés sur des informations référencées (web) et récentes, et peuvent chacun faire l'objet d'une recherche web_searchspécifique.
- Quand le texte est long dans les valeurs string du JSON, formatte en markdown et préfère les listes (markdown) aux points virgules`,
    variables: ['organization_name', 'industries', 'organization_id', 'existing_data']
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
    variables: ['user_input', 'organization_info']
  },
  {
    id: 'organization_matrix_template',
    name: 'Matrice organisationnelle (template)',
    description: 'Prompt pour adapter les descriptions de niveaux de la matrice à une organisation, sans modifier les axes/poids/seuils',
    content: `Tu dois adapter les descriptions de niveaux d'une matrice de priorisation IA pour l'organisation suivante:
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
    variables: ['organization_name', 'organization_info', 'base_matrix']
  },
  {
    id: 'use_case_list',
    name: 'Liste de cas d\'usage',
    description: 'Prompt pour générer une liste de cas d\'usage',
    content: `Génère une liste de cas d'usage d'IA innovants selon la demande suivante:
    - la demande utilisateur spécifique suivante: {{user_input}},
    - le nom de dossier fourni par l'utilisateur (si non vide): {{folder_name}},
    - les informations de l'organisation: {{organization_info}},
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
    variables: ['user_input', 'folder_name', 'organization_info', 'use_case_count']
  },
  {
    id: 'use_case_detail',
    name: 'Détail de cas d\'usage',
    description: 'Prompt pour générer un cas d\'usage détaillé avec scoring',
    content: `Génère un cas d'usage détaillé pour le cas d'usage suivant: {{use_case}}"

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
  "prerequisites": "Prérequis pour la mise en œuvre du cas d'usage (ex: Datalake, Historien IoT, Senseurs, etc.)",
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
  "constraints": [ // 60-90 mots pour l'ensemble des contraintes (techniques, business, réglementaires, etc.). IMPORTANT: chaque item doit etre une phrase non vide, sans puce/marker ("-", "—", "•") et sans texte placeholder.
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
    variables: ['use_case', 'user_input', 'matrix', 'organization_info']
  },
  {
    id: 'executive_summary',
    name: 'Synthèse exécutive',
    description: 'Prompt pour générer une synthèse exécutive complète d\'un dossier de cas d\'usage',
    content: `Génère le rapport pour un dossier de cas d'usage d'IA.

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
    variables: ['folder_description', 'organization_info', 'top_cas', 'use_cases']
  }
  ,
  {
    id: 'document_summary',
    name: 'Résumé de document',
    description: 'Prompt pour résumer un document attaché à un contexte (Lot B)',
    content: `Tu es un assistant qui extrait l’essentiel de documents métiers pour alimenter la génération de cas d’usage, tout en produisant des métadonnées permettant un réexamen ultérieur du document.

Contraintes:
- Réponds en {{lang}}.
- Concis et structuré (markdown).
- N’invente rien. Si le texte est insuffisant, dis-le clairement.
- Si possible, cite la source (p.X ou titre/section). Sinon, omets.
- Le titre du document peut être “-” : dans ce cas, indique “Non précisé”.

Règle de classification (obligatoire):
- [succès] = cas réalisé / résultat mesuré / déployé sur des projets
- [capacité] = compétence, outil, standard, certification ou programme existant (réutilisable)
- [opportunité] = intention, ambition, plan, cible ou piste non démontrée par un cas

Limites (en mots, hors titres):
- Résumé: 100–200 mots
- Éléments exploitables: 8–14 puces, 6–18 mots par puce
- Contraintes / inconnues: 4–10 puces, 6–18 mots par puce

Règles de qualité (obligatoires):
- Quand des chiffres existent dans le texte, les inclure (avec unités) dans le Résumé et/ou les Éléments exploitables.
- Chaque puce “Éléments exploitables” doit, si possible, contenir un ordre de grandeur ou une valeur chiffrée (%, €, volumes, effectifs, délais, etc.) ou préciser qu’aucun chiffre n’est donné.

Format attendu:
## Fiche document (réexamen)
- Titre: {{doc_title}} (si “-” => “Non précisé”)
- Taille: {{nb_pages}} pages ; {{full_words}} mots (sinon “Non précisé”)
- Nature: rapport / politique / procédure / etc. (si explicite, sinon “Non précisé”)

## Résumé
(500-1000 mots, inclure 3–8 faits chiffrés si disponibles)

## Sommaire
Titres niveau 1: 6–12 puces max (reprendre les titres existants ; sinon “Non précisé”


## Éléments exploitables pour cas d’usage
- [besoin] …
- [acteur] …
- [processus] …
- [donnée] …
- [système] …
- [succès] …
- [capacité] …
- [opportunité] …

## Contraintes / dépendances (faits)
- [contrainte] …
- [dépendance] …

## Autres informations
- [information] informations supplémentaires, contextuelles, etc. …

Texte du document:
---
{{document_text}}
---`,
    variables: ['lang', 'doc_title', 'nb_pages', 'full_words', 'document_text']
  },
  {
    id: 'document_detailed_summary',
    name: 'Résumé détaillé de document (long)',
    description: 'Prompt de référence (ex-tool-service) pour produire une contraction (résumé détaillé) linéaire à partir du texte intégral extrait',
    content: `Document: {{filename}}
Source: {{source_label}}
Portée: {{scope}}

TEXTE:
<source>
{{document_text}}
</source>

TÂCHE:
- Produire une contraction (résumé détaillé) LINÉAIRE exhaustive qui suit l'ordre du document, section par section par section.
- Objectif de longueur: minimum {{max_words}} - c'est une contraction pour fournir à un LLM un résumé détaillé linéaire sans explosion de contexte et perdre le minimum de contenu.

CONTRAINTES:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention, uniquement les informations du texte source.
- Respecte les numero de sections du document source.
- Respecter une longueur minimale {{max_words}} (si le contenu le permet)
- Conserver les informations chiffrées.`,
    variables: ['filename', 'source_label', 'scope', 'document_text', 'lang', 'max_words']
  },
  {
    id: 'documents_analyze',
    name: 'Documents — Analyze',
    description: 'Template pour documents.analyze (outil): analyser un document à partir du texte intégral extrait, selon une instruction fournie',
    content: `Tu es un sous-agent d'analyse documentaire.

Objectif: répondre à une instruction spécialisée à partir du TEXTE (intégral ou extrait) fourni.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si l'information n'apparaît pas dans le texte, le dire explicitement.
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Document: {{filename}}
- Pages (si dispo): {{pages}}
- Titre (si dispo): {{title}}
- Taille (estimée): ~{{full_words}} mots ;
- Portée du texte fourni: {{scope}}

TEXTE:
---
{{document_text}}
---

INSTRUCTION (du modèle maître):
---
{{instruction}}
---

Répondre uniquement avec l'analyse demandée.`,
    variables: ['lang', 'max_words', 'filename', 'pages', 'title', 'full_words', 'est_tokens', 'scope', 'document_text', 'instruction']
  },
  {
    id: 'documents_analyze_merge',
    name: 'Documents — Analyze (merge)',
    description: 'Template pour fusionner les notes par extrait en une réponse unique et bornée pour documents.analyze',
    content: `Tu es un sous-agent d'analyse documentaire.

Objectif: consolider une réponse finale unique et fidèle à partir de notes factuelles produites sur des extraits du document.

Contraintes:
- Réponds en {{lang}}.
- Format: markdown.
- Pas d'invention: si une information n'apparaît dans aucun extrait, le dire explicitement.
- Longueur: maximum {{max_words}} mots.

Métadonnées:
- Document: {{filename}}
- Pages (si dispo): {{pages}}
- Titre (si dispo): {{title}}
- Taille (estimée): ~{{full_words}} mots ; ~{{est_tokens}} tokens (heuristique)

NOTES PAR EXTRAIT (scan complet, sans retrieval):
---
{{notes}}
---

INSTRUCTION (du modèle maître):
---
{{instruction}}
---

Consolider une réponse finale unique, structurée, et bornée.`,
    variables: ['lang', 'max_words', 'filename', 'pages', 'title', 'full_words', 'est_tokens', 'notes', 'instruction']
  }
];
