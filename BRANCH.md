# Feature: Lot A — Mise à jour ciblée d'un objet (Chatbot) ✅

## Objectif

Implémenter la fonctionnalité de base du chatbot permettant à l'IA de proposer et d'appliquer une amélioration ciblée sur un use case existant avec reasoning en temps réel et traçabilité complète.

**Valeur métier** : Démonstration client dès le premier incrément. L'IA propose et applique une amélioration ciblée sur un objet métier existant avec reasoning temps réel et traçabilité.

**Portée fonctionnelle** : Mise à jour de `use_cases.data.*` via tool `update_usecase_field` (use case uniquement). Extension aux autres objets (folder, company, executive_summary) prévue dans les Lots suivants.

## Résumé des modifications

**31 commits** avec **8152 insertions** et **908 suppressions** sur **42 fichiers**.

### Principales fonctionnalités implémentées

- ✅ Architecture streaming complète (OpenAI → DB → NOTIFY → SSE)
- ✅ Service chat avec sessions et messages
- ✅ Tools : `read_usecase`, `update_usecase_field`, `web_search`, `web_extract`
- ✅ UI : ChatWidget unifié (Chat + QueueMonitor), ChatPanel, StreamMessage
- ✅ Détection automatique du contexte depuis la route
- ✅ Historique complet (stream-events, modification history, snapshots)
- ✅ Refresh automatique UI après modifications (SSE events)
- ✅ Tests complets : unitaires (API + UI), intégration, E2E

### Fichiers principaux créés/modifiés

**Backend (API)** :
- `api/src/services/chat-service.ts` (530 lignes)
- `api/src/services/stream-service.ts` (155 lignes)
- `api/src/services/tool-service.ts` (246 lignes)
- `api/src/services/tools.ts` (376 lignes modifiées)
- `api/src/routes/api/chat.ts` (nouvelles routes)
- `api/src/routes/api/streams.ts` (SSE endpoint)

**Frontend (UI)** :
- `ui/src/lib/components/ChatWidget.svelte` (263 lignes)
- `ui/src/lib/components/ChatPanel.svelte` (380 lignes)
- `ui/src/lib/components/StreamMessage.svelte` (412 lignes)
- `ui/src/lib/stores/streamHub.ts` (268 lignes)

**Database** :
- Nouvelles tables : `chat_sessions`, `chat_messages`, `chat_contexts`, `chat_stream_events`, `context_modification_history`
- Migration : `0011_past_drax.sql`

**Tests** :
- Tests unitaires API : `stream-service.test.ts`, `tool-service.test.ts`, `tools.test.ts`
- Tests d'intégration API : `chat.test.ts`, `streams.test.ts`, `chat-tools.test.ts`
- Tests unitaires UI : `streamHub.test.ts`
- Tests E2E : `chat.spec.ts`, `ai-generation.spec.ts`

## Scope

- **API** : Nouveaux endpoints chat, streaming SSE, tools
- **UI** : Nouveaux composants chat-stream, intégration dans vues existantes
- **DB** : Nouvelles tables pour chat, streaming, historique
- **Tests** : Unit, intégration, E2E pour le parcours complet (pyramide : 70% unit, 20% intégration, 10% E2E)
- **CI** : Vérification que les tests passent dans GitHub Actions

## Statut d'implémentation

✅ **Phase 1** : Modèle de données et migrations
✅ **Phase 2A** : Streaming pour génération d'entreprise (POC)
✅ **Phase 2B** : Généralisation aux autres générations classiques
✅ **Phase 2C** : Service de streaming partagé
✅ **Phase 2D** : Service chat (sessions et messages)
✅ **Phase 2E** : Tool Service (read_usecase, update_usecase_field)
✅ **Phase 3** : Widget global Chat/Queue + UI chat
✅ **Phase 4** : Intégration tool call
✅ **Phase 5** : Tests (unitaires, intégration, E2E)
✅ **Phase 6** : Documentation

## Références

- **Spécification complète** : `spec/SPEC_CHATBOT.md` (source de vérité pour les Lots A, B, C, D, E)
- **Stratégie de test** : `.cursor/rules/testing.mdc` (pyramide : 70% unit, 20% intégration, 10% E2E)
- **Lot A détaillé** : `spec/SPEC_CHATBOT.md` lignes 703-723
- **Modèle de données** : `spec/SPEC_CHATBOT.md` lignes 185-571
- **Architecture streaming** : `spec/SPEC_CHATBOT.md` lignes 120-138
- **Composants UI** : `spec/SPEC_CHATBOT.md` lignes 149-160
- **Documentation détaillée** : `BRANCH.md`

## Couverture des cas d'usage

- CU-001 : Modification d'objets existants via chat (use case uniquement)
- CU-002 : Historique et traçabilité (partiel)
- CU-003 : Affichage du reasoning en streaming
- CU-004 : Rejeu de session (affichage)
- CU-005 : Contexte et historique dans les sessions (use case uniquement)
- CU-010 : Consultation et recherche (partiel)
- CU-015 : Gestion des sessions (partiel)
- CU-016 : Affichage dans les vues existantes (partiel)
- CU-019 : Intégration avec la queue existante (partiel)
- CU-020 : Notifications et feedback (partiel)
- CU-021 : Gestion des erreurs (partiel)

