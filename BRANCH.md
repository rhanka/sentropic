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
- [ ] Adapter `generateUseCaseList` pour utiliser le streaming
- [ ] Adapter `generateUseCaseDetail` pour utiliser le streaming
- [ ] Adapter `generateExecutiveSummary` pour utiliser le streaming
- [ ] Tous utilisent le même `stream-service.ts` (méthodes partagées)
- [ ] Tests de régression sur tous les cas

#### Phase 2C - Service Chat
- [ ] Créer `api/src/services/chat-service.ts` :
  - Gestion des sessions (création, récupération, mise à jour)
  - Création de messages (user et assistant)
  - Intégration avec streaming (direct, SANS queue)
  - Utilisation du modèle par défaut depuis settings

#### Phase 2D - Endpoints Chat
- [ ] Créer le router `/api/v1/chat` dans `api/src/routes/api/chat.ts`
- [ ] Implémenter `POST /api/v1/chat/messages` :
  - Création de session si nécessaire
  - Enregistrement du message utilisateur
  - Appel OpenAI streaming (direct, sans queue)
  - Enregistrement du message assistant avec reasoning
- [ ] Implémenter `GET /api/v1/chat/stream/:stream_id` (SSE) :
  - Réutilise l'endpoint créé en 2A.5 ou crée un endpoint dédié
  - Lecture des événements depuis `chat_stream_events`
  - Support du paramètre `?since=seq` pour rehydratation
  - Abonnement PostgreSQL NOTIFY pour temps réel
- [ ] Monter le router dans `api/src/routes/api/index.ts`
- [ ] Mettre à jour OpenAPI (`api/src/openapi/`)

#### Phase 2E - Tool Service
- [ ] Créer `api/src/services/tool-service.ts` :
  - Exécution du tool `update_description` (usecase uniquement)
  - Validation des modifications
  - Écriture dans `context_modification_history`
  - Snapshots avant/après dans `chat_contexts`
  - Feature d'annulation du dernier changement au niveau de l'objet

### Phase 3 : UI SvelteKit - Composants de base
- [ ] Créer le module `ui/src/lib/chat-stream/` :
  - `createStreamController` (store Svelte pour agrégation)
  - Types d'événements (reasoning_delta, content_delta, tool_call_*, status, error, done)
- [ ] Créer `ui/src/lib/components/MessageStream.svelte` :
  - Affichage reasoning en cours
  - Affichage contenu généré
  - Support markdown
- [ ] Créer `ui/src/lib/components/UndoBar.svelte` :
  - Bouton "Annuler le dernier changement" au niveau de l'objet
  - Affichage du dernier changement annulable
  - Utilisation des snapshots pour restaurer l'état précédent
- [ ] Créer `ui/src/lib/components/ContextBadge.svelte` :
  - Badge indiquant le contexte (folder/usecase)
  - Lien vers l'objet
- [ ] Créer l'intégration SSE :
  - Abonnement EventSource
  - Gestion des reconnexions
  - Resync depuis la base si perte d'événements

### Phase 4 : Intégration UI dans les vues existantes
- [ ] Créer un composant popup chat similaire à `QueueMonitor.svelte` :
  - Popup flottant en bas à droite (ou intégré dans le même conteneur que la queue)
  - La queue reste en accordéon dans le même conteneur
  - Bouton pour ouvrir/fermer le chat
- [ ] Intégrer le chat dans `/cas-usage/[id]` :
  - Affichage du chat pour un use case via le popup
  - Création de session si nécessaire
  - Affichage du flux SSE dans le popup
- [ ] Intégrer `UndoBar` pour annuler le dernier changement
- [ ] Afficher la vue avant/après (champ description uniquement)
- [ ] Note : Le parcours folder sera ajouté ultérieurement

### Phase 5 : Tests
- [ ] Tests unitaires API :
  - Agrégation SSE (deltas reasoning/content)
  - Application de deltas
  - Tool-call `update_description`
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

2. **Queue pour chat** : Le plan mentionne "Intégrer avec la queue existante" pour le chat, mais **le chat NE passe PAS par la queue** (générations classiques uniquement via queue).

3. **Architecture streaming** : Il faut créer une **couche streaming partagée** qui sert :
   - Les générations classiques (via queue) - qui deviendront plus transparentes pour tools/réflexion
   - Le chat (direct, sans queue)
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

## Status
- **Progress**: 1/6 phases complétées
- **Current**: Phase 1 terminée ✅
- **Next**: Phase 2A - Streaming complet pour génération d'entreprise (POC)

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
