# Feature: Lot A — Mise à jour ciblée d'un objet (Chatbot)

> **Référence** : Spécification complète dans `spec/SPEC_CHATBOT.md` (source de vérité). Ce document (`BRANCH.md`) suit l'implémentation du Lot A.

## Objective
Implémenter la fonctionnalité de base du chatbot permettant à l'IA de proposer et d'appliquer une amélioration ciblée sur un use case existant avec reasoning en temps réel et traçabilité complète. Le parcours folder sera ajouté ultérieurement.

**Valeur métier** : Démonstration client dès le premier incrément. L'IA propose et applique une amélioration ciblée sur un objet métier existant avec reasoning temps réel et traçabilité.

**Portée fonctionnelle** : Mise à jour de `use_cases.data.*` via tool `update_usecase_field` (use case uniquement). Extension aux autres objets (folder, company, executive_summary) prévue dans les Lots suivants.

**Couverture CU** : CU-001 (use case), CU-002 (partiel), CU-003, CU-004, CU-005 (use case), CU-010 (partiel), CU-015 (partiel), CU-016 (partiel), CU-019 (partiel), CU-020 (partiel), CU-021 (partiel)

## Plan / Todo

### Phase 1 : Modèle de données et migrations ✅
- [x] Créer les tables nécessaires dans le schéma Drizzle :
  - [x] `chat_sessions` (sessions de chat utilisateur)
  - [x] `chat_messages` (messages de conversation avec reasoning)
  - [x] `chat_contexts` (liaison sessions ↔ objets métier)
  - [x] `chat_stream_events` (événements de streaming)
  - [x] `context_modification_history` (historique des modifications)
- [x] Générer les migrations Drizzle (`make db-generate`) → `0011_past_drax.sql`
- [x] Appliquer les migrations (`make db-migrate`)
- [x] Vérifier le schéma - toutes les tables créées avec succès

### Phase 2 : API Backend - Architecture streaming et chat

#### Phase 2A - Streaming complet pour génération d'entreprise (POC)
**Objectif** : Implémenter le streaming complet (OpenAI + DB + NOTIFY) sur un seul cas simple (entreprise) pour valider l'architecture avant généralisation.

**Flux actuel** :
- `POST /api/v1/companies/ai-enrich` → appelle directement `enrichCompany` (sans queue)
- Queue `processCompanyEnrich` → appelle `enrichCompany` puis met à jour DB

**Flux cible** :
- Même comportement final (résultat JSON parsé, DB mise à jour)
- **+ Streaming** : événements écrits dans `chat_stream_events` pendant l'exécution
- **+ NOTIFY** : PostgreSQL NOTIFY pour temps réel
- **+ Queue compatible** : la queue attend toujours le résultat final de `enrichCompany`

**Tâches** :
- [ ] **2A.1 - Couche OpenAI Streaming** :
  - Créer `callOpenAIStream` dans `api/src/services/openai.ts` :
    - Retourne `AsyncIterable<StreamEvent>` où `StreamEvent` = `{ type: 'reasoning_delta' | 'content_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_result' | 'done', data: any }`
    - Gère reasoning, content, tool_calls en streaming
    - Mutualise les valeurs par défaut du modèle (via `settingsService.getAISettings().defaultModel`)
    - Garde `callOpenAI` pour compatibilité (générations classiques actuelles)
  
- [ ] **2A.2 - Service Stream Partagé (base)** :
  - Créer `api/src/services/stream-service.ts` :
    - Fonction `writeStreamEvent(streamId, eventType, data, sequence)` :
      - Écrit dans `chat_stream_events` (avec `message_id=null` pour générations classiques)
      - PostgreSQL NOTIFY avec payload minimal (`stream_id`, `sequence`)
      - Gestion des séquences (auto-incrément par `stream_id`)
    - Fonction `generateStreamId(promptId?, jobId?)` : génère `stream_id` unique
      - Pour générations classiques : `prompt_id` + timestamp (ou `job_id` si disponible)
      - Pour chat : `message_id` (sera utilisé plus tard)
  
- [ ] **2A.3 - Adapter enrichCompany pour streaming** :
  - Modifier `api/src/services/context-company.ts` :
    - `enrichCompany` accepte un paramètre optionnel `streamId?: string`
    - Utilise `callOpenAIStream` au lieu de `executeWithTools` → `callOpenAI`
    - **Collecte le résultat final** : agrège tous les `content_delta` pour reconstruire le JSON complet
    - **Écrit les événements** : appelle `writeStreamEvent` pour chaque événement de streaming
    - **Retourne le résultat final** : parse le JSON comme avant (compatibilité)
    - Gère les tool calls (web_search, web_extract) en streaming
  
- [ ] **2A.4 - Intégration queue** :
  - Modifier `queue-manager.ts` → `processCompanyEnrich` :
    - Génère un `streamId` (ex: `company_enrich_${jobId}_${timestamp}`)
    - Passe le `streamId` à `enrichCompany`
    - La queue attend toujours le résultat final (comportement inchangé)
    - Met à jour la DB comme avant
  
- [ ] **2A.5 - Endpoint SSE pour générations classiques** (optionnel pour cette phase) :
  - Créer `GET /api/v1/stream/:stream_id` (SSE) :
    - Lecture des événements depuis `chat_stream_events`
    - Support du paramètre `?since=seq` pour rehydratation
    - Abonnement PostgreSQL NOTIFY pour temps réel
  - **Note** : Cet endpoint servira aussi pour le chat plus tard

- [ ] **2A.6 - Tests et validation** :
  - Test unitaire : `callOpenAIStream` retourne bien un AsyncIterable
  - Test unitaire : `writeStreamEvent` écrit bien en DB et NOTIFY
  - Test intégration : `enrichCompany` avec streaming retourne le même résultat qu'avant
  - Test intégration : événements écrits dans `chat_stream_events` avec `message_id=null`
  - Test queue : `processCompanyEnrich` fonctionne toujours (résultat final + DB mise à jour)
  - Test E2E : enrichissement d'entreprise fonctionne (endpoint `/ai-enrich` et via queue)

**Critères de validation Phase 2A** :
- ✅ Les générations d'entreprise fonctionnent toujours (comportement final identique)
- ✅ Les événements de streaming sont écrits dans `chat_stream_events`
- ✅ PostgreSQL NOTIFY fonctionne
- ✅ La queue continue de fonctionner normalement
- ✅ Un seul test UAT complet suffit

#### Phase 2B - Généralisation aux autres générations classiques
- [x] Adapter `generateUseCaseList` pour utiliser le streaming
- [x] Adapter `generateUseCaseDetail` pour utiliser le streaming
- [x] Adapter `generateExecutiveSummary` pour utiliser le streaming
- [x] Tous utilisent le même tronc commun (orchestrateur `executeWithToolsStream`) + persistance dans `chat_stream_events`
- [x] Intégration UI sur les vues dossiers / cas d'usage (SSE, sans polling)

#### Phase 2C - Service Chat
- [x] Créer `api/src/services/chat-service.ts` :
  - Gestion des sessions (création, récupération, mise à jour)
  - Création de messages (user et assistant)
  - Intégration avec streaming (via job `chat_message` en queue pour préparer le scaling / workers dédiés)
  - Utilisation du modèle par défaut depuis settings

#### Phase 2D - Endpoints Chat
- [x] Créer le router `/api/v1/chat` dans `api/src/routes/api/chat.ts`
- [x] Implémenter `POST /api/v1/chat/messages` :
  - Création de session si nécessaire
  - Enregistrement du message utilisateur
  - Enfile un job `chat_message` (prépare le scaling / workers dédiés)
  - Enregistrement du message assistant avec reasoning
- [x] Implémenter `GET /api/v1/chat/sessions` et `GET /api/v1/chat/sessions/:id/messages`
- [x] Option C (historique complet tools/reasoning) :
  - API : `GET /api/v1/chat/messages/:id/stream-events` (lecture `chat_stream_events`, `streamId = messageId`)
  - UI : rehydratation des étapes tools/reasoning des derniers messages assistant lors du chargement d'une session
  - Optimisation : endpoint batch `GET /api/v1/chat/sessions/:id/stream-events` (1 call/session au lieu de N calls/message)
- [x] **Streaming** : pas d'endpoint dédié `GET /api/v1/chat/stream/:stream_id`.
  - Le client utilise le **SSE global** `GET /api/v1/streams/sse` et filtre par `streamId`
  - `streamId` du chat = `assistantMessageId` (retourné par `POST /chat/messages`)
- [x] Monter le router dans `api/src/routes/api/index.ts`
- [x] Mettre à jour OpenAPI (`api/src/openapi/`) (minimal : endpoints chat)

#### Phase 2E - Tool Service
- [x] Créer `api/src/services/tool-service.ts` :
  - Exécution d'un tool **générique** `update_usecase_field` (usecase uniquement, champs `use_cases.data.*`)
  - Validation des modifications
  - Écriture dans `context_modification_history`
  - Snapshots avant/après dans `chat_contexts`
  - Feature d'annulation du dernier changement au niveau de l'objet

### Phase 3 : UI SvelteKit - Composants de base
- [x] **Unifier le widget flottant global (1 seule bulle)** :
  - Créer `ui/src/lib/components/ChatWidget.svelte`
    - Contient **la bulle** (bouton fixed) + **le panneau** (drawer)
    - Header avec switch de vue: **Chat** ↔ **QueueMonitor**
    - La bulle reflète un état global (jobs en cours/failed + conversations en cours/erreurs)
  - Remplacer l’injection de `QueueMonitor` dans `ui/src/routes/+layout.svelte` par ce widget unique
- [x] **Ergonomie de la bulle & du panneau (itérations)** :
  - Bulle = **icône chat** (toujours visible), avec **badge montre** si jobs IA actifs (`pending/processing`)
  - Le statut “montre” se **réinitialise** automatiquement dès qu’il n’y a plus de jobs actifs (fin/purge)
  - Fenêtre plus haute (**~70vh**), ancrée en bas à droite, et **recouvre** l’emplacement de la bulle (bulle cachée pendant l’ouverture)
  - Fix layout: wrapper en `flex flex-col` + content `flex-1 min-h-0` pour conserver le composer visible en bas
  - Optimisation perf: le panneau est **monté une seule fois**, puis on fait **hide/show** (pas de remount → pas d’appels API à chaque ouverture/fermeture)
  - Optimisation perf: switch **Jobs IA ↔ Chat** en hide/show (ChatPanel + QueueMonitor restent montés)
  - Anti-reload: retour depuis “Jobs IA” vers **la même session** ne relance pas `selectSession()` (évite “Chargement du détail…”)
  - Nettoyage: suppression de `StreamMessageLegacy.svelte` (plus de variant legacy, `StreamMessage` couvre chat + job)
  - UI: scrollbar **uniformisée** (classe globale `.slim-scroll`) sur ChatPanel + Jobs IA + zones de détail StreamMessage
  - Fix réactivité: clé composite dans `{#each}` de QueueMonitor (`${job.id}-${job.status}-${job.completedAt || ''}`) pour forcer la mise à jour de l'UI quand le status change (Svelte recrée les blocs DOM)
  - Fix UX: correction de `showDetailLoader` dans StreamMessage pour exclure les jobs (évite d'afficher "Chargement du détail..." pour les jobs pending)
- [x] **QueueMonitor réutilisé comme panel** (sans requalifier) :
  - `QueueMonitor` conserve le contenu existant, mais **sans bulle/wrapper fixed/header**
  - Le titre et le bouton poubelle sont déplacés dans le header du widget
- [x] **UI Chat (vue dans le widget)** :
  - [x] `ChatPanel.svelte` : liste sessions + messages + composer (envoi `POST /chat/messages`)
  - [x] Streaming côté UI : résumé en gris (durée + nb d'outils) + chevron + détail (raisonnement/outils sans résultat), stream du résultat dans la bulle, puis refresh messages au `done/error` (**scroll collé en bas**)
  - [x] UX: dès `status: started`, afficher un loader "En cours…" dans la zone grise (avant reasoning/outils/réponse)
  - [x] Déplacer la sélection de session dans le header du widget (`ChatWidget`) + actions **+** (nouvelle session locale) et **🗑️** (supprimer conversation)
  - [x] API : `DELETE /api/v1/chat/sessions/:id` (cascade DB)
  - Streaming: réutiliser `streamHub` + `StreamMessage` (pas de 2ᵉ composant de rendu)
    - `streamId` = `assistantMessageId`
    - `StreamMessage` est la brique unique pour afficher l’avancement (reasoning/tools/content) + historique
- [x] **Data fetch (non-streaming)** :
  - `GET /chat/sessions` + `GET /chat/sessions/:id/messages` pour recharger l'historique après refresh
  - SSE global `/streams/sse` seulement pour les messages en cours / nouveaux events (cache/replay = confort UX)
- [x] **Chat global (pas page-scoped)** :
  - Le chat est disponible **partout** (ChatWidget disponible via `+layout.svelte`)
  - Le contexte est automatiquement détecté depuis l'URL (route + id le cas échéant), pas besoin de sélecteur UI dédié
  - Le diff (Avant/Après) sera implémenté dans le Lot D

#### Convergence StreamMessage (Chat vs Jobs) — analyse de rétrofit
- **Constat** :
  - Le `ChatPanel` a aujourd'hui **l'ergonomie cible** (zone grise steps, résumé “Raisonnement X, N outils”, chevron + détail).
  - `StreamMessage.svelte` existe déjà, mais il est plutôt “job progress compact” (étape + historique), et ne porte pas l'UX Chat.
- **Différences réelles Chat vs Job (faibles)** :
  - **Chat**: rendu du **résultat** dans une bulle + remplacement par le contenu final quand `done`.
  - **Jobs**: pas de bulle de réponse (ou pas toujours), mais on veut **la même lecture** des steps (reasoning/tools) + historique.
  - **Hydratation historique**:
    - Chat: scopes user/session (endpoints `/chat/*`).
    - Jobs: scope “streamId” (ex: `job_<id>`, `company_<id>`), nécessite un endpoint générique `/streams/*`.
- **Plan (5 étapes)** :
  - [x] (1) Documenter cette convergence (section actuelle).
  - [x] (2) Remplacer `StreamMessage` par une version unifiée qui reprend l'UX du chat (backup: `StreamMessageLegacy.svelte`).
  - [x] (3) API: permettre la relecture d'historique par `streamId` (jobs inclus) avec `limit/since` (`GET /api/v1/streams/events/:streamId`).
  - [x] (4) Adapter `StreamMessage` au besoin QueueMonitor (variant `job`: steps + historique, sans bulle chat).
  - [x] (5) Adapter `QueueMonitor` pour utiliser `StreamMessage` (live SSE + historique API via `historySource="stream"`).

### Phase 4 : Intégration tool call dans le chat
- [x] **4.1 - UI : Détection automatique du contexte depuis la route** :
  - Dans `ChatPanel.svelte`, détecter la route actuelle via `$page.route.id` et `$page.params`
  - Mapper les routes aux contextes :
    - `/cas-usage/[id]` → `primaryContextType: 'usecase'`, `primaryContextId: $page.params.id`
    - `/dossiers/[id]` → `primaryContextType: 'folder'`, `primaryContextId: $page.params.id`
    - `/entreprises/[id]` → `primaryContextType: 'company'`, `primaryContextId: $page.params.id`
  - Modifier `sendMessage()` pour inclure `primaryContextType` et `primaryContextId` dans l'appel `POST /chat/messages`
  - Gérer le cas où on n'est pas sur une route avec contexte (pas de tool disponible)
- [ ] **4.2 - API : Passage des tools à OpenAI** :
  - [x] **4.2.1 - Créer le tool `read_usecase`** :
    - Créer `readUseCaseTool` dans `tools.ts` (paramètre `useCaseId`, retourne le use case complet)
    - Créer `readUseCase()` dans `tool-service.ts` pour lire le use case depuis la DB
    - Retourner la structure `use_cases.data` complète
  - [x] **4.2.2 - Passer les tools à OpenAI** :
    - Dans `chat-service.ts` → `runAssistantGeneration()`, récupérer le contexte depuis la session (`primaryContextType`, `primaryContextId`)
    - Importer `readUseCaseTool`, `updateUseCaseFieldTool`, `webSearchTool` et `webExtractTool` depuis `tools.ts`
    - Conditionner le passage des tools : ne passer `tools: [readUseCaseTool, updateUseCaseFieldTool, webSearchTool, webExtractTool]` que si `primaryContextType === 'usecase'`
    - Passer les tools à `callOpenAIResponseStream()` dans les options
    - Enrichir le system prompt avec le contexte usecase pour guider l'IA
  - [x] **4.2.3 - Intégration des tools web (web_search, web_extract)** :
    - `web_search` : Recherche d'informations récentes sur le web pour trouver de nouvelles URLs ou obtenir des résumés
    - `web_extract` : Extraction du contenu complet d'une ou plusieurs URLs existantes (références du use case)
    - Correction du parsing de la réponse Tavily : utiliser `raw_content` au lieu de `markdown`/`content` dans la structure `results[]`
    - Support de l'appel groupé : `web_extract` accepte un array d'URLs pour extraire plusieurs URLs en un seul appel
    - Workflow guidé dans le system prompt : lire le use case → extraire les URLs depuis `data.references` → appeler `web_extract` une seule fois avec toutes les URLs
- [x] **4.3 - API : Gestion des tool calls dans le stream** :
  - Dans `runAssistantGeneration()`, gérer les événements `tool_call_start`, `tool_call_delta`, `done`
  - Pour `tool_call_start` : initialiser un objet pour stocker les arguments du tool call
  - Pour `tool_call_delta` : accumuler les arguments JSON (comme pour `content_delta`)
  - Boucle itérative pour gérer plusieurs rounds de tool calls (max 10 itérations)
  - Collecter tous les tool calls avant de les exécuter
- [x] **4.4 - API : Exécution des tools** :
  - Après avoir collecté tous les tool calls dans un round, exécuter chaque tool :
    - **Pour `read_usecase`** :
      - Parser les arguments accumulés (`useCaseId`)
      - Vérifier que `useCaseId` correspond au `primaryContextId` de la session (sécurité)
      - Appeler `toolService.readUseCase()` avec `useCaseId`
      - Écrire l'événement `tool_call_result` dans le stream
      - Construire le résultat au format OpenAI (message `role: 'tool'` avec le use case complet)
    - **Pour `update_usecase_field`** :
      - Parser les arguments accumulés (`useCaseId`, `updates`)
      - Vérifier que `useCaseId` correspond au `primaryContextId` de la session (sécurité)
      - Appeler `toolService.updateUseCaseFields()` avec :
        - `useCaseId` depuis les arguments
        - `updates` depuis les arguments
        - `sessionId` et `assistantMessageId` pour l'historique
        - `toolCallId` pour la traçabilité
      - Écrire l'événement `tool_call_result` dans le stream
      - Construire le résultat au format OpenAI (message `role: 'tool'`)
    - **Pour `web_search`** :
      - Parser les arguments accumulés (`query`)
      - Appeler `searchWeb()` depuis `tools.ts` (API Tavily)
      - Écrire l'événement `tool_call_result` dans le stream avec les résultats de recherche
      - Construire le résultat au format OpenAI (message `role: 'tool'`)
    - **Pour `web_extract`** :
      - Parser les arguments accumulés (`urls` - array d'URLs)
      - Appeler `extractUrlContent()` pour chaque URL (en parallèle via `Promise.all`)
      - Écrire l'événement `tool_call_result` dans le stream avec les contenus extraits
      - Construire le résultat au format OpenAI (message `role: 'tool'`)
  - Ajouter tous les résultats des tools à la conversation pour continuer le stream dans le round suivant
- [x] **4.5 - API : Transmission du contexte au modèle** :
  - Enrichir le `systemPrompt` dans `runAssistantGeneration()` pour inclure le contexte :
    - Si `primaryContextType === 'usecase'` : "Tu travailles sur le use case {primaryContextId}. Tu peux utiliser le tool `read_usecase` pour lire son état actuel, puis `update_usecase_field` pour modifier ses champs."
    - Ajout des tools web : `web_search` pour rechercher de nouvelles informations, `web_extract` pour extraire le contenu des références existantes
    - Workflow guidé pour l'analyse des références : lire le use case → extraire URLs depuis `data.references` → appeler `web_extract` une seule fois avec toutes les URLs
    - Instructions explicites pour regrouper les URLs dans un seul appel `web_extract` (évite les appels multiples)
  - Alternative : inclure le contexte dans les messages de conversation (moins recommandé)

- [x] **4.6 - Tests et validation (manuels)** :
  - [x] Test manuel : sur `/cas-usage/[id]`, demander une modification du use case et vérifier que le tool est appelé
  - [x] Vérifier que les modifications sont bien écrites en DB (`use_cases.data`)
  - [x] Vérifier que l'historique est créé (`context_modification_history`, `chat_contexts`)
  - [x] Vérifier que le modèle continue la conversation après l'exécution du tool
  - **Note** : Tests automatisés détaillés dans Phase 5

**Critères de validation Phase 4** :
- ✅ Le contexte est automatiquement détecté depuis la route
- ✅ Le tool est passé à OpenAI uniquement quand le contexte est `usecase`
- ✅ Les tool calls sont gérés dans le stream
- ✅ Le tool est exécuté et les modifications sont appliquées en DB
- ✅ Le modèle continue la conversation après l'exécution du tool
- ✅ L'historique des modifications est tracé

### Phase 5 : Tests

> **Référence** : Stratégie de test définie dans `.cursor/rules/testing.mdc` (pyramide : 70% unit, 20% intégration, 10% E2E)

#### 5.0 - Vérifications préliminaires (Typecheck & Lint) ✅

> **Note** : Avant de commencer les tests fonctionnels, s'assurer que le code compile et respecte les règles de lint.

- [x] **Typecheck API** :
  - [x] `make typecheck-api` : Vérifier que TypeScript compile sans erreurs
  - [x] Corriger toutes les erreurs de type avant de continuer
  - Corrections effectuées :
    - Fix type `currentMessages` pour accepter `role: 'tool'` dans `chat-service.ts`
    - Suppression des imports `executeWithTools` obsolètes dans `context-company.ts` et `executive-summary.ts`

- [x] **Typecheck UI** :
  - [x] `make typecheck-ui` : Vérifier que SvelteKit compile sans erreurs
  - [x] Aucune erreur de type (0 errors, 0 warnings)

- [x] **Lint API** :
  - [x] `make lint-api` : Vérifier que le code API respecte les règles ESLint
  - [x] Corriger tous les warnings/erreurs de lint avant de continuer
  - Corrections effectuées :
    - `maxIterations` changé en `const` dans `chat-service.ts`
    - Variable `streamDone` supprimée (non utilisée) dans `chat-service.ts`
    - Variable `nextData` supprimée (non utilisée) dans `tool-service.ts`
    - Fonction `setAtPath` supprimée (non utilisée) dans `tool-service.ts`
    - Import `callOpenAI` non utilisé supprimé dans `tools.ts`

- [x] **Lint UI** :
  - [x] `make lint-ui` : Vérifier que le code UI respecte les règles ESLint/Svelte
  - [x] Aucune erreur de lint

**Commandes** :
- `make typecheck-api`
- `make typecheck-ui`
- `make lint-api`
- `make lint-ui`

#### 5.1 - Tests unitaires API (70% de la couverture) ✅

> **Note** : Dans ce projet, les tests unitaires testent soit des **fonctions pures** (sans dépendances), soit des **services isolés** (logique métier d'un service, même s'ils utilisent DB PostgreSQL de test via Docker). La distinction clé : **pas d'endpoints HTTP** (`app` de Hono). Les services qui utilisent la DB PostgreSQL de test sont considérés comme unitaires s'ils testent la logique métier isolée (ex: `session-manager.test.ts`, `challenge-manager.test.ts`).

**Fichiers à créer** : `api/tests/unit/stream-service.test.ts`, `api/tests/unit/tool-service.test.ts`

- [x] **Stream Service** (`api/tests/unit/stream-service.test.ts`) ✅ :
  - [x] Setup : `beforeEach`/`afterEach` pour cleanup DB PostgreSQL de test
  - [x] `writeStreamEvent()` : écriture dans `chat_stream_events` avec séquence correcte (DB PostgreSQL de test)
  - [x] `writeStreamEvent()` : PostgreSQL NOTIFY avec payload minimal (test vérifie que la fonction s'exécute sans erreur)
  - [x] `getNextSequence()` : incrémentation séquentielle par `stream_id` (DB PostgreSQL de test)
  - [x] `readStreamEvents()` : lecture avec filtres `sinceSequence` et `limit` (DB PostgreSQL de test)
  - [x] `generateStreamId()` : génération déterministe pour différents contextes (fonction pure)
  - [x] Gestion des séquences : unicité, ordre strict, déduplication (DB PostgreSQL de test)

- [x] **Tool Service** (`api/tests/unit/tool-service.test.ts`) ✅ :
  - [x] Setup : `beforeEach` → créer use case de test en DB PostgreSQL, `afterEach` → cleanup
  - [x] `readUseCase()` : lecture depuis DB avec validation `useCaseId` (DB PostgreSQL de test)
  - [x] `updateUseCaseFields()` : validation des arguments (useCaseId, updates array)
  - [x] `updateUseCaseFields()` : utilisation de `jsonb_set` pour mises à jour partielles (DB PostgreSQL de test)
  - [x] `updateUseCaseFields()` : écriture dans `context_modification_history` (DB PostgreSQL de test)
  - [x] `updateUseCaseFields()` : snapshots avant/après dans `chat_contexts` (DB PostgreSQL de test)
  - [x] `updateUseCaseFields()` : PostgreSQL NOTIFY `usecase_update` (test vérifie que la fonction s'exécute sans erreur)
  - [x] Gestion des erreurs : paths invalides, valeurs invalides, limites (max 50 updates)

- [x] **Tools (web_extract)** (`api/tests/unit/tools.test.ts`) ✅ :
  - [x] `extractUrlContent()` : appel avec une seule URL (compatibilité, mock Tavily API)
  - [x] `extractUrlContent()` : appel avec array d'URLs (un seul appel Tavily, mock Tavily API)
  - [x] `extractUrlContent()` : parsing correct de `raw_content` depuis `results[]` (mock Tavily response)
  - [x] `extractUrlContent()` : gestion erreur HTTP (mock fetch avec `resp.ok = false`)
  - [x] `extractUrlContent()` : gestion contenu vide (warning log, retour structure correcte)
  - [x] Validation array vide dans `executeWithToolsStream` : rejet avec erreur claire (mock tool call avec `{"urls":[]}`) - Note: Testé indirectement via tests d'intégration

- [ ] **Utilitaires purs** (si fonctions utilitaires créées) :
  - [ ] Fonctions de parsing/formatage : tests sans DB (fonctions pures)
  - [ ] Fonctions de validation : tests sans DB (fonctions pures)

> **Note sur Chat Service et OpenAI Service** : `chat-service.ts` et `openai.ts` contiennent de la logique qui nécessite des appels OpenAI réels ou des mocks complexes. Ces services seront testés en **intégration** via les endpoints HTTP (`api/tests/api/chat.test.ts`, `api/tests/ai/chat-tools.test.ts`) plutôt qu'en unitaire.

**Commandes** :
- `make test-api-unit SCOPE=tests/unit/stream-service.test.ts`
- `make test-api-unit SCOPE=tests/unit/tool-service.test.ts`
- `make test-api-unit SCOPE=tests/unit/tools.test.ts`

#### 5.2 - Tests d'intégration API (20% de la couverture)

> **Note** : Les tests d'intégration testent les **endpoints HTTP complets** avec `app` de Hono. Ils utilisent DB PostgreSQL de test (via Docker) et testent le flux complet : requête HTTP → authentification → service → DB → réponse HTTP. Utiliser `createAuthenticatedUser()` et `authenticatedRequest()` depuis `api/tests/utils/auth-helper.ts`. Pattern : `beforeEach` pour créer user, `afterEach` pour `cleanupAuthData()`.

**Fichiers à créer** : `api/tests/api/chat.test.ts`, `api/tests/api/streams.test.ts`, `api/tests/ai/chat-tools.test.ts`

> **Note sur Chat Service** : `chat-service.ts` contient à la fois de la logique métier (création sessions/messages) ET de la génération IA (appels OpenAI). Les tests de logique métier pure peuvent être unitaires (DB SQLite), mais `runAssistantGeneration()` avec appels OpenAI réels sera testé en intégration (endpoints HTTP).

- [x] **Endpoints Chat** (`api/tests/api/chat.test.ts`) ✅ :
  - [x] Setup : `beforeEach` → `createAuthenticatedUser('editor')`, `afterEach` → `cleanupAuthData()`
  - [x] `POST /api/v1/chat/messages` : création session si nécessaire (via `authenticatedRequest`)
  - [x] `POST /api/v1/chat/messages` : enregistrement message user
  - [x] `POST /api/v1/chat/messages` : job `chat_message` enfilé en queue
  - [x] `POST /api/v1/chat/messages` : retour `sessionId`, `userMessageId`, `assistantMessageId`, `streamId`
  - [x] `GET /api/v1/chat/sessions` : liste sessions pour user (filtrée par user_id)
  - [x] `GET /api/v1/chat/sessions/:id/messages` : liste messages ordonnée
  - [x] `GET /api/v1/chat/sessions/:id/stream-events` : batch events pour session
  - [x] `GET /api/v1/chat/messages/:id/stream-events` : events pour message
  - [x] `DELETE /api/v1/chat/sessions/:id` : suppression avec cascade
  - [x] Validation : contexte automatique depuis `primaryContextType`/`primaryContextId` (dans body POST)
  - [ ] Validation : erreurs (session non trouvée → 404, user non autorisé → 403, pas d'auth → 401)

- [ ] **Endpoints Streams** (`api/tests/api/streams.test.ts`) :
  - [ ] Setup : `beforeEach` → `createAuthenticatedUser('editor')`, `afterEach` → `cleanupAuthData()`
  - [ ] `GET /api/v1/streams/sse` : connexion SSE avec filtrage par `streamId` (query param)
  - [ ] `GET /api/v1/streams/sse` : réception événements en temps réel (NOTIFY) - mock EventSource ou test manuel
  - [ ] `GET /api/v1/streams/events/:streamId` : historique avec `limit` et `sinceSequence` (via `authenticatedRequest`)
  - [ ] Validation : événements `reasoning_delta`, `content_delta`, `tool_call_*`, `done`, `error`
  - [ ] Validation : ordre séquentiel, déduplication
  - [ ] Validation : 401 sans authentification

- [ ] **Tool Calls Intégration** (`api/tests/ai/chat-tools.test.ts`) :
  - [ ] Setup : `beforeEach` → `createAuthenticatedUser('editor')`, créer use case de test via endpoint, `afterEach` → `cleanupAuthData()`
  - [ ] Parcours complet : `POST /api/v1/chat/messages` avec `primaryContextType: 'usecase'` → job enfilé → tool call `read_usecase` → résultat dans stream
  - [ ] Parcours complet : `POST /api/v1/chat/messages` → tool call `update_usecase_field` → DB mise à jour (vérifier `use_cases.data` via `GET /api/v1/use-cases/:id`)
  - [ ] Parcours complet : `POST /api/v1/chat/messages` → tool call `web_search` → résultats dans stream (mock Tavily API si nécessaire pour éviter coûts)
  - [ ] Parcours complet : `POST /api/v1/chat/messages` → tool call `web_extract` (array URLs) → contenus extraits (mock Tavily API, vérifier un seul appel Tavily pour plusieurs URLs)
  - [ ] Validation `web_extract` array vide : tool call avec `{"urls":[]}` → erreur claire dans stream (pas d'appel Tavily)
  - [ ] Vérification : `context_modification_history` créé avec bonnes valeurs (lecture DB directe via `db.select()`)
  - [ ] Vérification : `chat_contexts` avec snapshots avant/après (lecture DB directe)
  - [ ] Vérification : `chat_stream_events` contient tous les événements (reasoning, content, tools) - lecture via `GET /api/v1/streams/events/:streamId`
  - [ ] Vérification : `use_cases.data` mis à jour avec `jsonb_set` (partiel, vérifier que seuls les champs modifiés changent) - lecture via endpoint
  - [ ] Vérification : PostgreSQL NOTIFY `usecase_update` émis (test manuel ou vérification via SSE si applicable)
  - [ ] Validation sécurité : `useCaseId` doit correspondre au contexte de session (test avec `useCaseId` différent → erreur 403/400)
  - [ ] Validation : boucle itérative (plusieurs rounds de tool calls) - test avec prompt demandant plusieurs modifications
  - [ ] Validation : continuation conversation après tool call (envoyer un 2e message via `POST /api/v1/chat/messages`, vérifier historique via `GET /api/v1/chat/sessions/:id/messages`)

- [x] **Chat AI complet** (`api/tests/ai/chat-sync.test.ts`) ✅ :
  - [x] Setup : `beforeEach` → `createAuthenticatedUser('editor')` + cleanup, `afterEach` → `cleanupAuthData()`
  - [x] Génération assistant response avec IA (test simple, timeout 15s, max 10 tentatives * 1s)
  - [x] Génération avec tool calls (`read_usecase`) dans contexte usecase
  - [x] Validation `web_extract` : pas d'appel avec array vide (test avec prompt simple)
  - [x] Maintien contexte conversation : plusieurs messages dans même session
  - [x] Vérification contenu final : message assistant mis à jour en DB après complétion job
  - [x] Vérification stream events : structure correcte après génération

- [ ] **Générations classiques - Mise à jour tests existants** :
  - [x] Vérifier que les services utilisent bien `executeWithToolsStream` (pas `executeWithTools`) ✅
    - [x] `executive-summary.ts` : utilise `executeWithToolsStream` avec `streamId` optionnel
    - [x] `context-usecase.ts` : utilise `executeWithToolsStream`
    - [x] `context-company.ts` : utilise `executeWithToolsStream`
  - [ ] **Ajouter vérifications dans tests existants** :
    - [ ] `api/tests/ai/executive-summary-sync.test.ts` : vérifier que les événements sont écrits dans `chat_stream_events` après génération
      - [ ] Vérifier `streamId` déterministe : `job_<jobId>` (via `generateStreamId` avec `jobId`)
      - [ ] Vérifier `message_id=null` pour générations classiques
      - [ ] Vérifier présence d'événements `content_delta`, `done` (et `tool_call_*` si `web_extract`/`web_search` utilisés)
    - [ ] `api/tests/ai/usecase-generation-*.test.ts` : ajouter vérifications `chat_stream_events`
    - [ ] `api/tests/ai/company-enrichment-sync.test.ts` : ajouter vérifications `chat_stream_events`
  - [x] Validation : `web_extract` avec array d'URLs → un seul appel Tavily ✅ (testé dans `tools.test.ts`)
  - [x] Validation : `web_extract` avec array vide → erreur claire ✅ (testé dans `chat-sync.test.ts`)

**Commandes** :
- `make test-api SCOPE=tests/api/chat.test.ts`
- `make test-api SCOPE=tests/api/streams.test.ts`
- `make test-api-ai SCOPE=tests/ai/chat-tools.test.ts`
- `make test-api-ai SCOPE=tests/ai/classic-generations.test.ts`

#### 5.3 - Tests E2E Playwright (10% de la couverture)

> **Note** : Les tests E2E testent les composants Svelte via l'UI réelle. Pas d'auth explicite (utilisent l'auth réelle de l'app). Pattern : `test.describe()` pour grouper, `test()` pour chaque scénario. Utiliser `page.goto()`, `page.locator()`, `expect().toBeVisible()`.

**Fichier à créer** : `e2e/tests/chat.spec.ts`

- [ ] **Parcours Chat de base** :
  - [ ] Ouvrir ChatWidget depuis n'importe quelle page
  - [ ] Créer une nouvelle session
  - [ ] Envoyer un message utilisateur
  - [ ] Vérifier affichage reasoning en streaming (si disponible)
  - [ ] Vérifier affichage réponse assistant
  - [ ] Vérifier scroll automatique en bas
  - [ ] Fermer et rouvrir le widget : session conservée

- [ ] **Parcours Tool Call sur Use Case** :
  - [ ] Naviguer vers `/cas-usage/[id]` (use case existant)
  - [ ] Ouvrir ChatWidget (clic sur bulle chat en bas à droite)
  - [ ] Vérifier que le contexte est détecté (pas de sélecteur visible)
  - [ ] Envoyer message : "Reformule le problème en bullet points"
  - [ ] Vérifier affichage reasoning en streaming (si disponible)
  - [ ] Vérifier tool `read_usecase` appelé (dans détail dépliable de `StreamMessage`)
  - [ ] Vérifier tool `update_usecase_field` appelé (dans détail dépliable)
  - [ ] Vérifier modification appliquée en DB (refresh page, vérifier contenu)
  - [ ] Vérifier historique visible dans `StreamMessage` (accordéon déplié)
  - [ ] Vérifier refresh automatique UI après modification (SSE, pas besoin de refresh)

- [ ] **Parcours Tool Call Web** :
  - [ ] Naviguer vers `/cas-usage/[id]` avec références (use case avec `data.references` rempli)
  - [ ] Ouvrir ChatWidget
  - [ ] Envoyer message : "Analyse les références en détail"
  - [ ] Vérifier tool `read_usecase` appelé (dans détail dépliable)
  - [ ] Vérifier tool `web_extract` appelé avec array d'URLs (un seul appel, vérifier dans détail)
  - [ ] Vérifier contenus extraits affichés dans réponse assistant (texte visible)
  - [ ] Cas sans références : use case sans `data.references` → vérifier que `web_extract` n'est pas appelé avec array vide (ou erreur claire si appelé)

- [ ] **Parcours Multi-sessions** :
  - [ ] Créer plusieurs sessions pour le même use case
  - [ ] Basculer entre sessions
  - [ ] Vérifier messages conservés par session
  - [ ] Supprimer une session
  - [ ] Vérifier autres sessions intactes

- [ ] **Parcours QueueMonitor intégré** :
  - [ ] Basculer Chat ↔ Jobs IA dans ChatWidget
  - [ ] Vérifier jobs affichés avec streaming
  - [ ] Vérifier `StreamMessage` pour jobs (variant `job`)
  - [ ] Vérifier historique stream pour jobs

- [ ] **Gestion erreurs** :
  - [ ] Message avec erreur OpenAI : vérifier affichage erreur
  - [ ] Tool call avec arguments invalides : vérifier message d'erreur
  - [ ] Tool call avec `useCaseId` ne correspondant pas au contexte : vérifier rejet
  - [ ] Tool call `web_extract` avec array vide : vérifier erreur claire affichée (pas d'erreur 400 Tavily)

**Commande** :
- `make test-e2e E2E_test=tests/chat.spec.ts`

#### 5.4 - Tests UI (unitaires SvelteKit - stores et utilitaires uniquement)

> **Note** : Les tests UI testent uniquement les **stores** et **utilitaires**, pas les composants Svelte. Les composants (`ChatWidget`, `ChatPanel`, `StreamMessage`) sont testés en E2E uniquement. Utiliser `mockFetchJsonOnce()` depuis `ui/tests/test-setup.ts` pour mocker les appels API.

**Fichiers à créer** : `ui/tests/stores/streamHub.test.ts`, `ui/tests/utils/stream.test.ts` (si utilitaires spécifiques)

- [ ] **streamHub Store** (`ui/tests/stores/streamHub.test.ts`) :
  - [ ] Connexion SSE (mock EventSource)
  - [ ] Agrégation deltas (reasoning/content)
  - [ ] Cache/replay des événements
  - [ ] Abonnements ciblés par `streamId`
  - [ ] Gestion des erreurs de connexion

- [ ] **Utilitaires stream** (`ui/tests/utils/stream.test.ts`) (si utilitaires créés) :
  - [ ] Parsing des événements SSE
  - [ ] Formatage des données stream
  - [ ] Helpers de transformation

**Commandes** :
- `make test-ui SCOPE=tests/stores/streamHub.test.ts`
- `make test-ui SCOPE=tests/utils/stream.test.ts` (si applicable)

#### 5.5 - Critères de validation Phase 5

- [x] **Prérequis** : Typecheck et lint passent (`make typecheck-api`, `make typecheck-ui`, `make lint-api`, `make lint-ui`) ✅
- [ ] Tous les tests unitaires passent (`make test-api-unit`, `make test-ui-unit`)
- [ ] Tous les tests d'intégration passent (`make test-api`, `make test-api-ai`)
- [ ] Tous les tests E2E passent (`make test-e2e`)
- [ ] Couverture minimale : 70% unit, 20% intégration, 10% E2E (selon pyramide)
- [ ] Tests isolés et répétables
- [ ] Pas de dépendances externes pour tests unitaires (mocks)
- [ ] Tests d'intégration avec DB SQLite de test
- [ ] Tests E2E avec Docker Compose complet

### Phase 6 : UndoBar (après validation des tests)
- [ ] **UndoBar** :
  - Bouton "Annuler" + preview de la dernière modification (via `context_modification_history` + `chat_contexts`)
  - Option: confirmation humaine pour actions ⚠️
  - **Note** : À implémenter après validation complète des tests (Phase 5) pour garantir la stabilité de l'annulation

### Phase 7 : Documentation et finalisation
- [ ] Mettre à jour la documentation OpenAPI
- [ ] Vérifier que tous les tests passent (`make test`)
- [ ] Vérifier le build (`make build`)
- [ ] Exécuter les tests E2E (`make test-e2e`)
- [ ] Vérifier CI GitHub Actions

## Décisions techniques

- **Parcours implémenté** : Use case uniquement (folder sera ajouté ultérieurement)
- **Modèle OpenAI** : `gpt-4.1-nano` par défaut, récupéré via `settingsService.getAISettings().defaultModel`
- **Interface utilisateur** : Popup flottant similaire à `QueueMonitor.svelte`, avec la queue en accordéon dans le même conteneur
- **Validation** : Pas de confirmation intermédiaire. Feature d'annulation du dernier changement au niveau de l'objet (à terme à la maille du sous-objet `data.description`)

## Architecture & Incohérences identifiées avec le plan initial

### Incohérences identifiées

1. **Phase 2 vs Phase 3** : Le plan initial met "Service de streaming" en Phase 3, mais la couche streaming doit être prête AVANT les endpoints chat (Phase 2), car ils en dépendent.

2. **Queue pour chat** : le plan initial disait "direct sans queue", mais on a choisi un job `chat_message` pour préparer le scaling (workers dédiés). Le streaming reste en temps réel via `chat_stream_events` + SSE global.

3. **Architecture streaming** : Il faut une **couche streaming partagée** qui sert :
   - Les générations classiques (via queue) - qui deviendront plus transparentes pour tools/réflexion
   - Le chat (via queue `chat_message`, scalable)
   - Méthodes partagées pour éviter la duplication

### Approche progressive validée

**Phase 2A - POC sur génération d'entreprise** :
- Cas le plus simple (pas de tool calls complexes, pas de multi-étapes)
- Permet de valider l'architecture complète (streaming + DB + NOTIFY + queue)
- **Un seul test UAT complet** suffit avant généralisation
- Généralisation ensuite (Phase 2B) aux autres générations classiques

**Gestion de la queue** :
- La queue continue de fonctionner normalement
- Elle attend toujours le résultat final de `enrichCompany` (comportement inchangé)
- Le streaming est transparent : événements écrits pendant l'exécution, résultat final collecté et retourné

**Récupération du résultat final** :
- `enrichCompany` agrège tous les `content_delta` pour reconstruire le JSON complet
- Parse le JSON comme avant (compatibilité totale)
- Retourne le résultat final (comme avant)
- La queue met à jour la DB avec ce résultat (comportement inchangé)

## Commits & Progress

- [x] **Phase 1** : Ajout des tables chat dans le schéma Drizzle
  - Tables créées : `chat_sessions`, `chat_messages`, `chat_contexts`, `chat_stream_events`, `context_modification_history`
  - Migration générée : `0011_past_drax.sql`
  - Migration appliquée avec succès
  - Vérification : toutes les tables présentes en base

- [x] **Phase 2A (POC streaming entreprise + UI monitoring)** : Streaming end-to-end + affichage temps réel
  - **API**
    - SSE global : `GET /api/v1/streams/sse` (flux unique) + `LISTEN/NOTIFY` (`stream_events`, `job_events`, `company_events`)
    - `generateStreamId` déterministe pour jobs (`job_<jobId>`) + **enrich entreprise streamId** : `company_<companyId>`
    - `NOTIFY job_events` (queue) + `NOTIFY company_events` (CRUD + transitions de statut)
    - Typage “safe” sur `executeWithToolsStream` (`event.data` = `unknown`) pour éviter les régressions TS/ESLint
    - Compat OpenAI : désactivation de `reasoning.summary` pour les modèles `gpt-4.1-*` (ex: `gpt-4.1-nano-*`) pour éviter un 400
  - **UI**
    - Nouveau composant `StreamMessage` (prop `streamId`) : dernière étape + historique dépliable, deltas cumulés, auto-scroll bas, placeholder sans waiter
    - `streamHub` : connexion SSE unique + abonnements ciblés (`setStream`, `setJobUpdates`) + cache/replay + agrégation des deltas
    - `QueueMonitor` : bouton toujours à jour (job_update même replié) + suivi de stream via `StreamMessage`
    - Liste entreprises : remplacement du waiter en mode `enriching` par `StreamMessage` sur `company_<id>`
    - Raffinements `StreamMessage` : chevron sur la ligne du titre + scrollbar discrète (zones scrollables)

- [x] **Phase 2A.1** : Couche OpenAI Streaming
  - Créé `callOpenAIStream` dans `openai.ts`
  - Retourne `AsyncIterable<StreamEvent>`
  - Gère content_delta, tool_call_start, tool_call_delta, status, error, done
  - Mutualise les valeurs par défaut du modèle via `settingsService.getAISettings().defaultModel`

- [x] **Phase 2A.2** : Service Stream Partagé
  - Créé `stream-service.ts` avec `writeStreamEvent`, `generateStreamId`, `getNextSequence`, `readStreamEvents`
  - Écriture dans `chat_stream_events` avec `message_id=null` pour générations classiques
  - PostgreSQL NOTIFY pour temps réel (payload minimal)

- [x] **Phase 2A.3** : Adapter enrichCompany pour streaming
  - Créé `enrichCompanyStream` qui utilise `callOpenAIStream`
  - Collecte le résultat final (agrège content_delta)
  - Gère les tool calls (web_search, web_extract) en streaming
  - Écrit tous les événements dans `chat_stream_events`
  - `enrichCompany` accepte maintenant `streamId?` optionnel

- [x] **Phase 2A.4** : Intégration queue
  - Modifié `processCompanyEnrich` pour générer un `streamId` et le passer à `enrichCompany`
  - La queue attend toujours le résultat final (comportement inchangé)

- [x] **Phase 2B (streaming dossiers + cas d'usage + synthèse)** : Généralisation aux générations classiques
  - **API**
    - Jobs : `use_case_list`, `use_case_detail`, `executive_summary` passent par `executeWithToolsStream`
    - `streamId` déterministes par entité : `folder_<folderId>`, `usecase_<useCaseId>`
    - Événements temps réel : `NOTIFY folder_events/usecase_events` + SSE `folder_update/usecase_update`
  - **UI**
    - Vues `/dossiers` et `/cas-usage` (liste + détail) : suivi via SSE + `StreamMessage` (plus de polling)
    - Ergonomie cartes : suppression des badges jaunes “Génération…”, `StreamMessage` placé aux bons endroits
    - Dossiers : masque le compteur “0 cas d’usage” pendant la génération, et “Sélectionné” affiché dans le footer (pas dans le corps)

## Status
- **Progress**: Phase 1 + Phase 2A (POC entreprise) + Phase 2B + Phase 2C + Phase 2D + Phase 2E (Tool Service) + Phase 3 (Widget global Chat/Queue + UI chat) + Phase 4 (Intégration tool call) ✅
- **Current**: Phase 5 - Tests (unitaires, intégration, E2E)
- **Next**:
  - Tests : Phase 5 (détaillée ci-dessous)
  - UndoBar : Phase 6 (après validation des tests)
  - Documentation : Phase 7

## Résumé des modifications depuis main

**31 commits** avec **8152 insertions** et **908 suppressions** sur **42 fichiers**.

**Principales fonctionnalités implémentées** :
- ✅ Architecture streaming complète (OpenAI → DB → NOTIFY → SSE)
- ✅ Service chat avec sessions et messages
- ✅ Tools : `read_usecase`, `update_usecase_field`, `web_search`, `web_extract`
- ✅ UI : ChatWidget unifié (Chat + QueueMonitor), ChatPanel, StreamMessage
- ✅ Détection automatique du contexte depuis la route
- ✅ Historique complet (stream-events, modification history, snapshots)
- ✅ Refresh automatique UI après modifications (SSE events)

**Fichiers principaux créés/modifiés** :
- `api/src/services/chat-service.ts` (530 lignes)
- `api/src/services/stream-service.ts` (155 lignes)
- `api/src/services/tool-service.ts` (246 lignes)
- `api/src/services/tools.ts` (376 lignes modifiées)
- `ui/src/lib/components/ChatWidget.svelte` (263 lignes)
- `ui/src/lib/components/ChatPanel.svelte` (380 lignes)
- `ui/src/lib/components/StreamMessage.svelte` (412 lignes)
- `ui/src/lib/stores/streamHub.ts` (268 lignes)

## Scope
- **API** : Nouveaux endpoints chat, streaming SSE, tools
- **UI** : Nouveaux composants chat-stream, intégration dans vues existantes
- **DB** : Nouvelles tables pour chat, streaming, historique
- **Tests** : Unit, intégration, E2E pour le parcours complet
- **CI** : Vérification que les tests passent dans GitHub Actions

## Références
- **Spécification complète** : `spec/SPEC_CHATBOT.md` (source de vérité pour les Lots A, B, C, D, E)
- **Stratégie de test** : `.cursor/rules/testing.mdc` (pyramide : 70% unit, 20% intégration, 10% E2E)
- **Lot A détaillé** : `spec/SPEC_CHATBOT.md` lignes 703-723
- **Modèle de données** : `spec/SPEC_CHATBOT.md` lignes 185-571
- **Architecture streaming** : `spec/SPEC_CHATBOT.md` lignes 120-138
- **Composants UI** : `spec/SPEC_CHATBOT.md` lignes 149-160
