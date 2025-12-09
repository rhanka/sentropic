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

### Phase 2 : API Backend - Endpoints de base
- [ ] Créer le router `/api/v1/chat` dans `api/src/routes/api/chat.ts`
- [ ] Implémenter `POST /api/v1/chat/messages` :
  - Création de session si nécessaire
  - Enregistrement du message utilisateur
  - Appel OpenAI avec streaming
  - Enregistrement du message assistant avec reasoning
- [ ] Implémenter `GET /api/v1/chat/stream/:message_id` (SSE) :
  - Lecture des événements depuis `chat_stream_events`
  - Support du paramètre `?since=seq` pour rehydratation
- [ ] Implémenter le tool `update_description` :
  - Support pour `usecase` uniquement (folder sera ajouté ultérieurement)
  - Écriture dans `context_modification_history`
  - Snapshots avant/après dans `chat_contexts`
  - Feature d'annulation du dernier changement au niveau de l'objet
- [ ] Monter le router dans `api/src/routes/api/index.ts`
- [ ] Mettre à jour OpenAPI (`api/src/openapi/`)

### Phase 3 : Service de streaming et queue
- [ ] Créer `api/src/services/chat-service.ts` :
  - Gestion des sessions
  - Création de messages
  - Intégration avec OpenAI streaming
  - Utilisation du modèle par défaut depuis `settingsService.getAISettings().defaultModel` (gpt-4.1-nano par défaut)
- [ ] Créer `api/src/services/stream-service.ts` :
  - Écriture dans `chat_stream_events`
  - PostgreSQL NOTIFY pour temps réel
  - Agrégation des deltas (reasoning/content)
- [ ] Intégrer avec la queue existante (`job_queue`) :
  - Priorité différente pour générations chat
  - Support de l'annulation via `job_id`
- [ ] Créer `api/src/services/tool-service.ts` :
  - Exécution du tool `update_description`
  - Validation des modifications
  - Écriture dans `context_modification_history`

### Phase 4 : UI SvelteKit - Composants de base
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

### Phase 5 : Intégration UI dans les vues existantes
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

### Phase 6 : Tests
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

## Commits & Progress

- [x] **Phase 1** : Ajout des tables chat dans le schéma Drizzle
  - Tables créées : `chat_sessions`, `chat_messages`, `chat_contexts`, `chat_stream_events`, `context_modification_history`
  - Migration générée : `0011_past_drax.sql`
  - Migration appliquée avec succès
  - Vérification : toutes les tables présentes en base

## Status
- **Progress**: 1/7 phases complétées
- **Current**: Phase 1 terminée ✅
- **Next**: Phase 2 - API Backend - Endpoints de base

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

