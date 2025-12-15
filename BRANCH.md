# Feature: Lot A — Mise à jour ciblée d'un objet (Chatbot)

## Objective
Implémenter la fonctionnalité de base du chatbot permettant à l'IA de proposer et d'appliquer une amélioration ciblée sur un use case existant avec reasoning en temps réel et traçabilité complète. Le parcours folder sera ajouté ultérieurement.

**Valeur métier** : Démonstration client dès le premier incrément. L'IA propose et applique une amélioration ciblée sur un objet métier existant avec reasoning temps réel et traçabilité.

**Portée fonctionnelle** : Mise à jour de `use_cases.data.description` uniquement pour cette première itération (le parcours folder sera ajouté ultérieurement).

**Couverture CU** : CU-001, CU-003, CU-004 (minimal), CU-002 (basique), CU-010, CU-016

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
  - `GET /chat/sessions` + `GET /chat/sessions/:id/messages` pour recharger l’historique après refresh
  - SSE global `/streams/sse` seulement pour les messages en cours / nouveaux events (cache/replay = confort UX)

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

### Phase 4 : Intégration UI dans les vues existantes
- [ ] **Chat global (pas page-scoped)** :
  - Le chat doit être disponible **partout** (comme la bulle QueueMonitor)
  - Ajout d’un sélecteur de contexte (company/folder/usecase) dans le header du widget (optionnel au début)
- [ ] **ContextBadge** :
  - Badge indiquant le contexte courant (folder/usecase/company) + lien vers l’objet
  - Visible dans le header du ChatPanel (et dans les messages si besoin)
- [ ] **UndoBar** :
  - Bouton "Annuler" + preview de la dernière modification (via `context_modification_history` + `chat_contexts`)
  - Option: confirmation humaine pour actions ⚠️
- [ ] **Avant/Après** :
  - Afficher diff (JSON patch / champ ciblé) dans le ChatPanel ou une modale

### Phase 5 : Tests
- [ ] Tests unitaires API :
  - Agrégation SSE (deltas reasoning/content)
  - Application de deltas
- Tool-call `update_usecase_field`
  - Validation des modifications
- [ ] Tests d'intégration API :
  - POST message → SSE → update description → lecture DB
  - Vérification `context_modification_history`
  - Vérification snapshots dans `chat_contexts`
- [ ] Tests E2E Playwright :
  - Parcours "demande d'amélioration" sur un use case puis annulation
  - Vérification description mise à jour
  - Vérification historique visible
  - Test de l'annulation du dernier changement

### Phase 6 : Documentation et finalisation
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
- **Progress**: Phase 1 + Phase 2A (POC entreprise) + Phase 2B ✅
- **Current**: Phase 3 - Widget global Chat/Queue + UI chat
- **Next**:
  - UI : compléter `ChatPanel` (sessions/messages/composer) + branchement aux endpoints `/api/v1/chat/*`
  - UI : afficher le stream chat via `StreamMessage` (streamId = assistantMessageId)
  - Intégrer le tool `update_usecase_field` dans la boucle chat (tool calling) + UndoBar
  - Garder la SSE globale unique + filtrage côté UI (pas de polling)

## Scope
- **API** : Nouveaux endpoints chat, streaming SSE, tools
- **UI** : Nouveaux composants chat-stream, intégration dans vues existantes
- **DB** : Nouvelles tables pour chat, streaming, historique
- **Tests** : Unit, intégration, E2E pour le parcours complet
- **CI** : Vérification que les tests passent dans GitHub Actions

## Références
- Spécification complète : `spec/SPEC_CHATBOT.md`
- Lot A détaillé : `spec/SPEC_CHATBOT.md` lignes 800-818
- Modèle de données : `spec/SPEC_CHATBOT.md` lignes 228-426
- Architecture streaming : `spec/SPEC_CHATBOT.md` lignes 119-138
- Composants UI : `spec/SPEC_CHATBOT.md` lignes 146-203
