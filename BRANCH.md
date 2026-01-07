## Feature: Chatbot Lot B — Context documents (ingestion + summary + consultation)

## Objective
Allow users to attach one or more documents to a business context (organization / folder / use case), automatically generate a short summary via the existing PostgreSQL-backed job queue, and consult metadata + summary from the UI.

This implements **CU-022** as defined in `spec/SPEC_CHATBOT.md` (source of truth).

## Scope
- API:
  - `POST /api/v1/documents` (upload + context_type/id)
  - `GET /api/v1/documents?context_type=&context_id=` (list)
  - `GET /api/v1/documents/:id` (metadata + summary)
  - `GET /api/v1/documents/:id/content` (download)
- DB:
  - `context_documents` (required)
  - `context_document_versions` (optional; only if needed for audit/versioning)
  - `context_modification_history` events: `document_added`, `document_summarized`
- Queue:
  - new job type `document_summary` to summarize the uploaded document and update `context_documents.status`.
- Storage:
  - S3-compatible object storage (local MinIO for dev/test, Scaleway S3 for prod).
- UI:
  - “Documents” block on context pages (folder / use case / organization): upload, list, status, summary.

## Non-goals (for this branch)
- Rich in-browser PDF viewer (download link only).
- Document chunking/search (RAG) and retrieval in prompts.
- Multi-file merge summaries or “ask questions about docs” chat behavior.

## DB note (schema churn avoidance)
- Comme `organizations.data` et `use_cases.data`, les données métier des documents (résumés, métadonnées extraites, traces prompt) sont stockées dans `context_documents.data` (**JSONB**) afin d'éviter la démultiplication de colonnes.

## Design / Architecture decisions (must be validated before deep implementation)
### Storage backend: MinIO (dev/test) vs Scaleway S3 (prod)
- Use a **single S3-compatible client** configured via env:
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_NAME`
  - credentials: `SCW_ACCESS_KEY` / `SCW_SECRET_KEY` (reused for S3-compatible auth)
- Local dev/test:
  - Add a `minio` service to `docker-compose.dev.yml` and `docker-compose.test.yml` (if needed),
  - Provide default credentials and create a bucket at startup (or lazy-create in code).
- Download strategy:
  - For now: API streams bytes from S3 to client (simple, auth-checked).
  - Later optimization: pre-signed URLs (requires careful auth scoping).

### Queue integration
- Reuse `QueueManager` and `job_queue` with a new `type='document_summary'`.
- Job payload includes (MVP):
  - `documentId`, `lang` (default FR) and optional `model`.
- Workspace scoping:
  - `workspaceId` is derived from `context_documents.workspace_id` (source of truth), not from the job payload.
- Status transitions on `context_documents`:
  - `uploaded` → `processing` → `ready` | `failed`
- Streaming:
  - `document_summary` emits stream events using the same SSE infra as other generations, with deterministic `streamId = document_<documentId>`.

### Summary policy (MVP)
- One summary per document, stored in DB:
  - Language default: **FR** (configurable later).
  - Size target: ~0.1k tokens per page (approximation; for MVP use a short capped summary).

## UAT checkpoints (incremental validation)
### UAT 0 — DB + API skeleton (no storage, no job)
- Migration adds `context_documents`.
- `GET /api/v1/documents` returns empty list for a context.

### UAT 1 — Upload + storage + download
- `POST /api/v1/documents` uploads a file and returns document id + status `uploaded`.
- `GET /api/v1/documents/:id/content` downloads the same bytes.

### UAT 2 — Queue summary job
- Upload triggers enqueue `document_summary`.
- Job updates status to `ready` and sets `summary`.
- `GET /api/v1/documents/:id` shows metadata + summary.

### UAT 3 — UI “Documents” block
- Context pages show documents list and summary.
- Upload works end-to-end from UI.

### UAT 4 — Tests + hardening
- API integration tests cover upload/list/get/download + job transition to ready/failed.
- E2E happy path covers UI upload → status change → summary display.

## Plan / Todo
- [x] Confirm storage approach (MinIO local vs Scaleway S3) and env variables to standardize.
- [x] Add DB tables + migration + update `spec/DATA_MODEL.md`.
- [x] Implement storage adapter (S3-compatible) + size/mime validation. ✅ (see commits: `143cf25`, `7430b69`)
- [x] Implement API routes with auth + workspace scoping. ✅ (see commit: `e77b8ff`)
- [x] Implement queue job `document_summary` and modification history events. ✅ (see commit: `e77b8ff`)
- [x] Implement UI “Documents” block with i18n FR-first. ✅ (see commit: `4eee944`)

- [x] Bloc “Documents” (UX)
  - [x] Retirer le bouton “Rafraîchir”
  - [x] Remplacer “Ajouter un document” par l’icône `circle-plus`
  - [x] Table des documents
    - [x] Ajouter 2 colonnes sans titre à gauche:
      - [x] colonne 1: icône `eye` (voir/masquer le résumé)
      - [x] colonne 2: icône `download` (télécharger)
    - [x] Retirer le titre “Actions” et ne garder que l’icône `trash-2` pour supprimer
    - [x] Élargir la colonne “Statut” pour éviter les changements de largeur lors des transitions
  - [x] Partial UAT

- [x] Tool “documents” (pour le chat et les générations par la suite)
  - [x] Implémenter un (et UN SEUL) tool configurable permettant à l’IA de récupérer:
    - [x] la liste des documents attachés à un objet (organization/folder/usecase) + statuts (uploaded/processing/ready/failed)
    - [x] un résumé (si dispo) et/ou le contenu complet (borné; selon autorisation)
  - [x] Brancher le tool dans tous les contextes de chat (organization / folder / usecase)
  - [x] Adapter les prompts pour utiliser le tool **uniquement** si documents disponibles (sinon ne pas l’appeler) — tool non exposé si aucun document

- [x] Amélioration “Organization”
  - [x] Mutualiser `organisations/new` et `organisations/[id]` via un composant (boutons spécifiques selon page)
  - [x] Remplacer les boutons par des icônes:
    - [x] `[id]`: Supprimer = `trash-2`
    - [x] `new`: IA = `brain`, Créer = `save`, Annuler = `trash-2`
  - [x] Sur `new`, rendre le bouton IA disponible dès que le nom est renseigné; indisponible pendant l’upload d’un doc
  - [x] Déplacer le bloc document sous le nom de l'organisation
  - [x] Adapter le prompt de génération de l'organisation
    - [x] Utiliser les documents via tool si disponibles (sinon ne pas appeler le tool)
    - [x] Réutiliser/compléter toute information saisie par l’utilisateur (ne pas l’écraser; reformuler proprement si demandé)
  - [x] migrer le bouton ajouter (vue organization) vers circle-plus (même style sur sur dossiers)
  - [x] sur la vue "new" dans orga, mettre un label "Nom de l'organisation" (le supprimer dans la vue [id])
  - [x] sur les deux vues new et [id] remplacer les valeurs par défaut en utilisant le placehodler nouvellement ajouté pour EditableInput (en profite pour mettre un placehodler aussi pour Secteur, il en manquait un). Préférer "Saisir le nom de l'organisation" (au lieu de Nouvelle organisaiton). Et "Non renseigné" va très bien pour les autres
  - [x] Partial UAT

- Amélioration tool documentaire
  - [x] L'outil `documents` peut faire une requête spécialisée à un sous-agent (contexte autonome) via `action=analyze`:
    - le modèle maître fournit un `prompt` ciblé via l'outil
    - la réponse est bornée à **10000 mots max**
  - [x] Si un document dépasse **10000 mots**:
    - `get_content` ne renvoie **pas** le texte complet
    - l'outil renvoie à la place un **résumé détaillé** (objectif ~10000 mots) + le **résumé général** (si dispo)
  - [x] Générer automatiquement (côté job `document_summary`) le résumé détaillé pour les gros documents et le stocker en DB dans `context_documents.data` (`detailedSummary` / `detailed_summary`).
  - [x] Modèle forcé (temporaire): `gpt-4.1-nano` pour `document_summary` + résumé détaillé + `documents.analyze` (en attendant le versioning DB des prompts/modèles).
  - [x] Queue: la limite de parallélisation est désormais **globale** (somme de tous les types) via une prise atomique (`FOR UPDATE SKIP LOCKED`) + slots calculés depuis le nombre global de jobs `processing`.
  - [x] Queue: pendant qu’un job long tourne, le scheduler se réveille périodiquement (via `processingInterval`) pour démarrer d’autres jobs (jusqu’au quota admin), au lieu d’attendre uniquement la fin d’un job.
  - [x] Partial UAT

- [x] Divers fix
  - [x] Queue: parallélisation réellement effective (le scheduler se réveille périodiquement pendant un job long pour lancer d’autres jobs, tout en respectant `ai_concurrency`)
  - [x] Queue: limite de parallélisation **globale** (somme de tous les types) via claim atomique (`FOR UPDATE SKIP LOCKED`) + slots calculés depuis le nombre global de jobs `processing`
  - [x] Jobs IA: afficher **tous** les jobs (incl. `chat_message`) pour diagnostiquer/purger les jobs “morts”
  - [x] Admin: purge **globale** de la queue (tous workspaces) + sécurité pour ne jamais laisser la queue en pause après une action admin
  - [x] UI paramètres: valeur initiale de `processingInterval` à **1000ms** (sans écraser la valeur existante en base)
  - [x] Documents: modèle forcé temporaire **`gpt-4.1-nano`** (résumé court, résumé détaillé auto, `documents.analyze`)
  - [x] Générations: empêcher les “pseudo tool calls” (JSON collés dans la réponse) en renforçant le prompt système de l’orchestrateur tools
  - [x] Générations: précharger les documents (dossier + organisation) dans le prompt via `DOCUMENTS_CONTEXT_JSON` (liste + résumés) avec un budget unique en **chars** (approx. 100k mots) et une politique d’escalade: si les résumés suffisent ne pas appeler `documents`, sinon `documents.get_content(maxChars=30000)` ou `documents.analyze` (question ciblée).
  - [x] Générations: forcer la réponse finale en `json_schema` strict (Structured Outputs) en phase 2 pour sécuriser le parsing JSON et rapprocher la contrainte de format de la dernière demande.
  - [x] Chat: tracer l’effort de raisonnement **une seule fois** par message (`reasoning_effort_selected`), sans répéter `pass/iteration`.
  - [x] Chat: évaluer `reasoningEffort` via `gpt-4.1-nano` (au lieu de `gpt-5-nano`) pour éviter des `server_error` observés avec `reasoning.effort="minimal"`.
  - [x] OpenAI: propager `request_id` dans les events d’erreur du stream Responses API (diagnostic “Effort de raisonnement (échec)” plus exploitable).
  - [x] UI: en mode chat “docked”, déplacer la scrollbar de la page principale sur le panneau gauche (avant le chat) via un conteneur scroll dédié dans `routes/+layout.svelte`.
  - [x] UI (UseCaseDetail): alignement “Bénéfices” vs “Risques + Mesures du succès” rétabli (stretch), y compris quand Risques/Mesures n'ont qu’un seul item.
  - [x] UI (UseCaseDetail): si la section “Références” est vide (non rendue), “Prochaines étapes” passe en pleine largeur (desktop + print/preview print).
  - [x] Use cases: retry automatique (borné) sur `usecase_list` / `usecase_detail` en cas d’échec “retryable” (parsing JSON / champs manquants / erreurs transitoires)

- [ ] Amélioration “Folder & Use case generation”
  - [x] Remplacer “Nouveau dossier” par un bouton icône `circle-plus`
  - [x] Déplacer `/home` vers `/dossier/new` et retirer la création “modal”
  - [~] Dans `dossier/new`
    - [x] Renommer “Générez vos cas d’usage” → “Créer un dossier”
    - [x] Même set d’icônes que `organization/new`: IA = `brain`, Créer = `save`, Annuler = `trash-2` (même disposition)
    - [x] Ajouter “Nom du dossier” (saisie multiligne)
    - [x] Transformer le contexte en EditableInput (markdown) une fois le brouillon créé
    - [x] Ajouter un champ numérique “nombre de cas d’usage” (défaut: 10) — (prompt à adapter ensuite)
    - [x] Ajouter le bloc documents - permettre l'upload (via dossier brouillon)
    - [x] Les boutons IA/Créer sont disponibles uniquement si contexte renseigné OU document présent
    - [x] Si l’utilisateur a renseigné un nom de dossier, le prompt doit l’utiliser (correction/mise en forme par l'IA OK)
    - [x] Bug: si aucun titre n’est saisi, ne pas laisser “Brouillon” devenir le titre final; laisser l’IA nommer le dossier
  - [x] Déplacer la vue /cas-usage (liste) vers `dossiers/[id]` et afficher le contexte (entre le titre et le bloc documents), et rebrancher la redirection vers /dossiers/ lors de la soumission IA
    - [x] Si l’utilisateur annule ou quitte la vue pendant un new (sans appuyer sur "créer" ou "génération), on reste en mode "draft" et en cliquand dessus on reste sur la vue "new" (avec icones génération etc)
  - [x] Adapter prompts/workflow pour utiliser documents (résumé ou contenu) depuis dossier + organisation (si dispo)
  - [x] Synthèse exécutive: permettre l’accès aux documents (dossier + organisation + cas d’usage) via le tool `documents` si au moins un document existe
  - [x] Dashboard: afficher le ScatterPlot dès qu’un premier cas d’usage est disponible (même si le dossier / la synthèse sont en cours de génération)
  - [x] Dashboard: n’afficher dans le ScatterPlot que les cas d’usage **finalisés** (pas ceux “en cours”)
  - [x] Partial UAT

- [ ] Full UAT (checklist avant tests)
  - [x] UAT-1 (démarrage): en mode dev, l’app démarre et la page cible charge sans erreur.
  - [x] UAT-2 (accès): en tant qu’utilisateur connecté, je vois un bloc “Documents” sur une page contexte (Entreprise / Dossier / Cas d’usage).
  - [x] UAT-3 (upload): je peux sélectionner un fichier et l’uploader; il apparaît dans la liste avec un statut (ex: “En cours”).
  - [x] UAT-4 (statut): le statut évolue automatiquement jusqu’à “Prêt” (ou “Échec” avec un message clair).
  - [x] UAT-5 (résumé): quand “Prêt”, je vois un résumé lisible (FR) directement dans le bloc.
  - [x] UAT-6 (download): je peux télécharger le document et je récupère bien le même fichier.
  - [-] UAT-7 (garde-fous): un fichier trop volumineux ou non supporté affiche une erreur UX (sans casser la page).
  - [x] UAT-8 (multi-docs): je peux ajouter 2+ documents sur le même contexte; la liste reste cohérente (tri, statuts).
  - [x] UAT-9 (droits): un utilisateur sans droits sur le contexte ne voit pas les documents / ne peut pas télécharger.
  - [x] UAT-10 (UX table): la table n’a pas de “refresh”, le bouton add est `circle-plus`, et les colonnes (eye/download) sont à gauche; la colonne statut ne “saute” pas.
  - [x] UAT-11 (suppression): clic `trash-2` → confirmation → le document disparaît; le download/summary n’est plus accessible.
  - [x] UAT-12 (résumé plein large): l’affichage du résumé prend toute la largeur (pas de resize colonnes).
  - [x] UAT-13 (tool docs - disponibilité): en chat (org/folder/usecase), l’IA peut lister les documents + statuts et afficher un résumé si dispo.
  - [x] UAT-14 (tool docs - garde-fous): si aucun document n’est disponible, l’IA ne tente pas d’appeler le tool et explique qu’elle n’a pas de source doc.
  - [-] UAT-15 (tool docs - permissions): en rôle restreint, l’IA ne peut pas accéder au contenu complet; elle peut au mieux lister des métadonnées autorisées.
  - [x] UAT-16 (dossier/new + draft): la création de dossier ne passe plus par une modal; navigation OK; création du brouillon automatique; retour à `/dossiers` conserve le brouillon (pas de suppression).
    - [x] Vérifier affichage: un dossier en `draft` affiche “Brouillon” dans le footer de la carte (pas besoin d’indiquer actif).
    - [x] Vérifier reprise: clic sur une carte `draft` renvoie vers `/dossier/new?draft=<id>` (édition + icônes IA/Créer/Annuler).
  - [x] UAT-17 (routes cas d’usage): `/cas-usage` redirige vers `dossiers/[id]` (ou `/dossiers` si aucun dossier), et `CTRL+R` sur `dossiers/[id]` ne casse pas (fallback SPA).
  - [x] UAT-18 (organization/new): bouton IA activé si nom présent; désactivé pendant upload; icônes conformes.
  - [x] UAT-19 (prompts): si l’utilisateur a rempli des champs (nom/contexte), l’IA réutilise ces infos et ne les écrase pas.
  - [x] UAT-20 (tool docs - analyze / doc complet): `documents.analyze` interroge le **texte intégral extrait** du document (même si >10000 mots), et la réponse est bornée à 10000 mots.
  - [x] UAT-21 (tool docs - 10k words / detailed summary): si un doc >10000 mots, `get_content` renvoie un **résumé détaillé d’environ 10000 mots** (idéalement 8000–10000) — pas de contenu complet.
  - [x] UAT-22 (générations - docs préchargés): si des documents existent sur dossier + organisation, le prompt contient un `DOCUMENTS_CONTEXT_JSON` (liste + résumés) et la génération peut s’appuyer dessus sans appeler `documents` si suffisant.
  - [x] UAT-23 (générations - docs + web): la génération exploite d’abord les documents (et `documents.get_content`/`documents.analyze` si nécessaire) puis effectue **au moins un `web_search`** pour consolider les références externes lorsque la demande le requiert.
  - [x] UAT-24 (générations - JSON strict): la sortie finale `usecase_list` / `usecase_detail` reste un unique JSON conforme (pas de texte avant/après, pas de “JSON parasite”).
    - Préconditions:
      - Avoir au moins 1 document `ready` sur le **dossier** ET au moins 1 document `ready` sur l'**organisation**.
      - Préférer un doc “source de vérité” (ex: rapport interne) avec des éléments vérifiables.
    - Action:
      - Lancer une génération de dossier (`usecase_list`) puis laisser enchaîner 1+ `usecase_detail`.
    - Attendus:
      - UAT-22: le prompt de génération inclut un bloc `DOCUMENTS_CONTEXT_JSON` (liste + résumés, `truncated` possible) couvrant **dossier + organisation**.
      - UAT-23:
        - Cas “résumé suffisant”: aucune utilisation de `documents.*` nécessaire.
        - Cas “résumé insuffisant” (ex: chiffre/section précise): un appel `documents.get_content(maxChars=30000)` ou `documents.analyze` intervient avant consolidation web.
        - En complément (si demandé): au moins un `web_search`; `web_extract` uniquement si besoin de détails complémentaires spécifiques avec URLs valides issues du `web_search`.
      - UAT-24: la réponse finale est **uniquement** un JSON (aucun texte avant/après, pas de pseudo tool calls, pas de JSON parasite).
  - [x] UAT-25 (UseCaseDetail - layout): “Bénéfices” a la même hauteur que “Risques + Mesures du succès” (même si Risques/Mesures n'ont qu’un seul item).
  - [x] UAT-26 (UseCaseDetail - layout): si “Références” est vide (non rendue), “Prochaines étapes” occupe 100% de la largeur (desktop + print/preview print).

- [ ] Add tests (unit/integration/E2E) and run via `make`.
  - [x] **ui (Vitest)** — `make test-ui` (scoper avec `SCOPE=...`)
    - [x] Ajouter/mettre à jour des tests autour des nouveaux flux dossier:
      - [x] `ui/tests/stores/folders.test.ts`: `status` supporte `draft` + sélection/reprise (si applicable)
    - [x] `ui/tests/utils/documents.test.ts`: utils documents (list/upload/download/delete) + gestion `workspace_id`
  - [ ] **api (Vitest – hors IA)** — `make test-api-unit`, `make test-api-endpoints`, `make test-api-queue`, `make test-api-security`, `make test-api-limit`
    - [x] api (unit): `make up-api-test` puis `make test-api-unit` (OK: 20 fichiers / 201 tests)
    - [x] api (endpoints): `make test-api-endpoints` (OK: 19 fichiers / 160 tests)
    - [x] queue: `make test-api-queue` (OK: 1 fichier / 5 tests)
    - [x] security: `make test-api-security` (OK: 5 fichiers / 42 tests)
    - [x] limit: `make test-api-limit` (OK: 1 fichier / 3 tests)
    - [x] api (unit): compléter `tool-service` documents (bornage `get_content`, champs `contentWords/clipped`, auto-repair)
      - [x] `getDocumentContent`: si > 10k mots => `contentMode=detailed_summary` + `contentWords`
      - [x] `getDocumentContent`: auto-repair si `data.detailedSummary` existe mais < 8000 mots (regen + persist)
      - [x] `analyzeDocument`: lit le texte intégral extrait + respecte `maxWords`
      - [x] `analyzeDocument`: cas doc très long (chunking: scan tous les chunks + merge)
      - [x] `listContextDocuments`: `summaryAvailable` cohérent (selon `data.summary`)
      - [x] `getDocumentSummary`: vérification match contexte (contextType/contextId) + `documentStatus`
    - [x] api (endpoints): étendre `documents` endpoints (list/get/content/delete + enqueue job)
      - [x] `POST /documents` (upload): crée `context_documents` + enqueue `document_summary`
      - [x] `GET /documents?context_type=&context_id=`: liste + mapping champs
      - [x] `GET /documents/:id`: metadata
      - [x] `GET /documents/:id/content`: download stream + headers
      - [x] `DELETE /documents/:id`: 204 + suppression objet S3 best-effort
      - [x] Admin scope: `workspace_id` query param pris en compte (si admin workspace scope activé)
    - [x] queue: `document_summary` (statuts + persistance summary/detailed_summary)
      - [x] `document_summary`: `workspaceId` dérivé du document (pas param job)
      - [x] `document_summary`: `streamId=document_<documentId>` + events streaming cohérents
      - [x] `document_summary`: modèle forcé `gpt-4.1-nano`
      - [x] `document_summary`: met à jour `context_documents.data.summary` (+ `summaryLang`, `nbWords`, etc.)
      - [x] `document_summary`: si doc long => génère + persiste `data.detailedSummary` (~8k–10k mots)
      - [x] `document_summary`: en cas d'erreur extraction/S3 => `status=failed` + message exploitable
    - [x] security (RBAC): N/A (pas de rôle restreint aujourd’hui) — à réactiver quand un rôle read-only existe
    - [x] security: scoping workspace (admin_app via `workspace_id` si `shareWithAdmin=true`, sinon 404) — couvert dans `api/tests/api/documents.test.ts`
  - [x] **ai (Vitest – isolés car plus lents)** — `make test-api-ai`
    - [x] Supprimer la catégorie inutile `api/tests/services/documents-tool.service.test.ts` (remplacé par `api/tests/unit/documents-tool-service.test.ts` + `api/tests/api/documents.test.ts` + `api/tests/queue/document-summary.test.ts`).
    - [x] Couvrir `documents.get_content` / `documents.analyze` (bornes + max output tokens) sans appels réseau (mocks OpenAI) — `api/tests/ai/documents-tool.test.ts`
    - [x] `documents.analyze`: possibilité de scanner tout le texte (chunking interne OK tant que tous les chunks sont lus) — `api/tests/ai/documents-tool.test.ts`
    - [x] `documents.get_content`: si doc long => retourner `detailed_summary` trim ~10k mots (pas 2k) + `clipped/contentWords` — `api/tests/ai/documents-tool.test.ts`
  - [x] **e2e (Playwright)** — `make test-e2e` (scoper avec `E2E_SPEC=...`)
    - [x] À mettre à jour (routes): scénarios qui pointaient `/cas-usage` doivent désormais pointer `dossiers/[id]` (liste)
    - [ ] À ajouter:
      - [x] `CTRL+R` (reload) sur `dossiers/[id]` ne casse pas (fallback SPA) — `e2e/tests/dossiers-reload-draft.spec.ts`
      - [x] Draft: créer un draft via `/dossier/new`, revenir à `/dossiers`, cliquer la carte “Brouillon” → retour `/dossier/new?draft=...` — `e2e/tests/dossiers-reload-draft.spec.ts`
      - [x] Résumés documents: upload **court** (README) + **long** (concat `spec/*.md`) → statut `ready` + résumé non vide — `e2e/tests/documents-summary.spec.ts`
      - [ ] Documents long: upload → statut `ready` → affichage résumé court + `get_content` (résumé détaillé) cohérent
      - [x] Documents: ordre icônes (œil → download → poubelle) + styles hover (bg transparent + hover:bg-slate-100) — `e2e/tests/documents-ui-actions.spec.ts`
      - [x] Documents: suppression (poubelle) => disparition ligne + pas de régression sur compteur/état — `e2e/tests/documents-ui-actions.spec.ts`

## Commits & Progress
- [x] **Commit 1** (`7a8eae5`): docs branch setup (this file) + design skeleton
- [x] **Commit 2** (`68e0150`): DB schema + **single migration** + `spec/DATA_MODEL.md` update
- [x] **Commit 3** (`143cf25`, `7430b69`): storage adapter + MinIO wiring (dev + test)
- [x] **Commit 4** (`e77b8ff`): API documents routes + queue job `document_summary` + history events
- [x] **Commit 5** (`4eee944`): UI documents block
- [ ] **Commit 6**: tests + hardening

## Status
- **Progress**: 5/6 commits completed
- **Current**: tests + hardening
- **Next**: tests + hardening

### Notes (branch constraints)
- This branch intentionally uses a **single migration file** for the DB change: `api/drizzle/0017_context_documents.sql`.
  - **Option 2**: compute a reactive boolean map in script with `$:` that explicitly references `$isAuthenticated` / `$currentFolderId`, then use that value in the template.
  - **Option 3**: make `isMenuDisabled` accept plain booleans (e.g. `isMenuDisabled(href, $isAuthenticated, $currentFolderId)`) so the template references the stores directly.
- **Validation plan**:
  - rerun `E2E_SPEC=tests/app.spec.ts make test-e2e` and confirm `error-context.md` shows `/url: /dossiers` (not `#`) and navigation passes.

### P2 — Implemented fix (A + D)
- **A (reactivity)**: compute disabled map in `<script>` using `$isAuthenticated` + `$currentFolderId` so it updates after session hydration on `/`.
- **D (no `href="#"`)**: keep real `href` for links, use `aria-disabled` + `tabindex=-1`, and preventDefault on click when disabled.

### P3 — Context + proposed fixes (tests vs UI)
- **Observed (local repro)**:
  - E2E run: `E2E_SPEC=tests/workflow.spec.ts make test-e2e`
  - evidence: Playwright call log shows `locator('.report-scatter-plot-container, canvas, svg').first()` resolves to the header SVG icon `lucide-menu` and it is `hidden`.
- **Fix proposals**:
  - **Option 1 (test-only)**: change selector to `.report-scatter-plot-container` (no `svg`, no `.first()`).
  - **Option 2 (UI + test)**: add `data-testid="dashboard-scatter-plot"` on the container and assert via `getByTestId`.
  - **Option 3 (test-only)**: scope selector under the dashboard main content (e.g. `main .report-scatter-plot-container`).

### P3 — Implemented fix (UI)
- Change dashboard rendering so the scatter plot container (`.report-scatter-plot-container`) is **not** conditional on executive summary presence.
- This aligns with product expectation: the chart should be available even before / without executive summary.

### Additional tests (proposal)
- **E2E**: burger menu appears on tablet + when chat is docked; opens above chat (z-index).
- **E2E**: Identity menu highlights on `/parametres` and `/auth/devices` (desktop + burger).
- **E2E**: i18n persists across reload (FR → EN → reload → EN).

## Decisions for UI step 3 (confirmed)
- Docked mode **pushes** main content (no overlay).
- Docked panel is shown when opened and can be **closed with the X button** (like current).
- Docked width is responsive:
  - Desktop: **~33%**
  - Tablet / intermediate: **~50%**
  - Mobile: **100%** (full screen)


