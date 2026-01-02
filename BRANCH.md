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

- [ ] Bloc “Documents” (UX)
  - [x] Retirer le bouton “Rafraîchir”
  - [x] Remplacer “Ajouter un document” par l’icône `circle-plus`
  - [x] Table des documents
    - [x] Ajouter 2 colonnes sans titre à gauche:
      - [x] colonne 1: icône `eye` (voir/masquer le résumé)
      - [x] colonne 2: icône `download` (télécharger)
    - [x] Retirer le titre “Actions” et ne garder que l’icône `trash-2` pour supprimer
    - [x] Élargir la colonne “Statut” pour éviter les changements de largeur lors des transitions
  - [x] Partial UAT

- [ ] Tool “documents” (pour le chat)
  - [ ] Implémenter un (et UN SEUL) tool configurable permettant à l’IA de récupérer:
    - [ ] la liste des documents attachés à un objet (organization/folder/usecase) + statuts (uploaded/processing/ready/failed)
    - [ ] un résumé (si dispo) et/ou le contenu complet (borné; selon autorisation)
  - [ ] Brancher le tool dans tous les contextes de chat (organization / folder / usecase)
  - [ ] Adapter les prompts pour utiliser le tool **uniquement** si documents disponibles (sinon ne pas l’appeler) — tool non exposé si aucun document

- [ ] Amélioration “Organization”
  - [ ] Mutualiser `organisations/new` et `organisations/[id]` via un composant (boutons spécifiques selon page)
  - [ ] Remplacer les boutons par des icônes:
    - [ ] `[id]`: Supprimer = `trash-2`
    - [ ] `new`: IA = `brain`, Créer = `save`, Annuler = `trash-2`
  - [ ] Sur `new`, rendre le bouton IA disponible si un document est uploadé; indisponible pendant l’upload
  - [ ] Adapter le prompt:
    - [ ] Utiliser les documents via tool si disponibles (sinon ne pas appeler le tool)
    - [ ] Réutiliser/compléter toute information saisie par l’utilisateur (ne pas l’écraser; reformuler proprement si demandé)
  - [ ] Partial UAT

- [ ] Amélioration “Folder & Use case generation”
  - [ ] Remplacer “Nouveau dossier” par un bouton icône `circle-plus`
  - [ ] Déplacer `/home` vers `/dossier/new` et retirer la création “modal”
  - [ ] Dans `dossier/new`
    - [ ] Renommer “Générez vos cas d’usage” → “Créer un dossier”
    - [ ] Même set d’icônes que `organization/new`: IA = `brain`, Créer = `save`, Annuler = `trash-2` (même disposition)
    - [ ] Ajouter “Nom du dossier” (EditableInput multiligne)
    - [ ] Transformer le contexte en EditableInput (markdown)
    - [ ] Ajouter un champ numérique “nombre de cas d’usage” (défaut: 10) + adapter prompt
    - [ ] Ajouter le bloc documents - permettre l'upload (sur un id dossier temporaire du coup)
    - [ ] Si l’utilisateur annule ou quitte la vue, supprimer le “to be” folder + ses documents (avec altert pour éviter de quitter et supprimer par erreur)
    - [ ] Les boutons IA/Créer sont disponibles uniquement si contexte renseigné OU document présent
    - [ ] Si l’utilisateur a renseigné un nom, le prompt doit l’utiliser (correction/mise en forme OK)
  - [ ] Déplacer la vue cas-usage vers `dossier/[id]` et afficher le contexte (entre le titre et le bloc documents)
  - [ ] Adapter prompts/workflow pour utiliser documents (résumé ou contenu) depuis dossier + organisation (si dispo)
  - [ ] Partial UAT
- [ ] Full UAT (checklist avant tests)
  - [ ] UAT-1 (démarrage): en mode dev, l’app démarre et la page cible charge sans erreur.
  - [ ] UAT-2 (accès): en tant qu’utilisateur connecté, je vois un bloc “Documents” sur une page contexte (Entreprise / Dossier / Cas d’usage).
  - [ ] UAT-3 (upload): je peux sélectionner un fichier et l’uploader; il apparaît dans la liste avec un statut (ex: “En cours”).
  - [ ] UAT-4 (statut): le statut évolue automatiquement jusqu’à “Prêt” (ou “Échec” avec un message clair).
  - [ ] UAT-5 (résumé): quand “Prêt”, je vois un résumé lisible (FR) directement dans le bloc.
  - [ ] UAT-6 (download): je peux télécharger le document et je récupère bien le même fichier.
  - [ ] UAT-7 (garde-fous): un fichier trop volumineux ou non supporté affiche une erreur UX (sans casser la page).
  - [ ] UAT-8 (multi-docs): je peux ajouter 2+ documents sur le même contexte; la liste reste cohérente (tri, statuts).
  - [ ] UAT-9 (droits): un utilisateur sans droits sur le contexte ne voit pas les documents / ne peut pas télécharger.
  - [x] UAT-10 (UX table): la table n’a pas de “refresh”, le bouton add est `circle-plus`, et les colonnes (eye/download) sont à gauche; la colonne statut ne “saute” pas.
  - [x] UAT-11 (suppression): clic `trash-2` → confirmation → le document disparaît; le download/summary n’est plus accessible.
  - [x] UAT-12 (résumé plein large): l’affichage du résumé prend toute la largeur (pas de resize colonnes).
  - [ ] UAT-13 (tool docs - disponibilité): en chat (org/folder/usecase), l’IA peut lister les documents + statuts et afficher un résumé si dispo.
  - [ ] UAT-14 (tool docs - garde-fous): si aucun document n’est disponible, l’IA ne tente pas d’appeler le tool et explique qu’elle n’a pas de source doc.
  - [ ] UAT-15 (tool docs - permissions): en rôle restreint, l’IA ne peut pas accéder au contenu complet; elle peut au mieux lister des métadonnées autorisées.
  - [ ] UAT-16 (/home → dossier/new): la création de dossier ne passe plus par une modal; navigation OK; retour arrière/annulation ne laisse pas d’artefacts.
  - [ ] UAT-17 (dossier futur): upload documents avant création du dossier → puis création OK; annulation → nettoyage du “to be” folder + documents.
  - [ ] UAT-18 (organization/new): bouton IA activé seulement si document présent; désactivé pendant upload; icônes conformes.
  - [ ] UAT-19 (prompts): si l’utilisateur a rempli des champs (nom/contexte), l’IA réutilise ces infos et ne les écrase pas.
- [ ] Add tests (unit/integration/E2E) and run via `make`.

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


