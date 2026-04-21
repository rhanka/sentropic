# Feature: BR-16a Google Drive SSO and In-Situ Indexing

## Objective
Implement the Google Drive first slice of document connectors: user-scoped Google OAuth, Drive file selection, in-situ document indexing, and chat retrieval through stored references. Documents must stay in Google Drive; Entropic stores metadata, extracted chunks, embeddings, sync status, and access references.

## Scope / Guardrails
- Scope limited to Google Drive OAuth, Google Drive connector metadata, Drive file picker/listing, in-situ indexing, document chunk references, embedding pipeline hooks, and chat `documents` tool integration.
- SharePoint, OneDrive, and generic connector expansion are deferred to BR-16b.
- One migration max in `api/drizzle/*.sql` if the schema needs connector metadata.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/entropic` is reserved for user work and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-gdrive-sso-indexing-16a`.
- Automated test campaigns must run on dedicated environments (`ENV=test-feat-gdrive-sso-indexing-16a` / `ENV=e2e-feat-gdrive-sso-indexing-16a`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Canonical roadmap branch is `feat/gdrive-sso-indexing`; this active branch is `feat/gdrive-sso-indexing-16a` because the canonical local ref is currently attached to a stale pre-Entropic worktree and must not be moved without explicit cleanup.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/**drive**`
  - `api/src/services/**document**`
  - `api/src/routes/api/**drive**`
  - `api/src/routes/api/**document**`
  - `api/src/db/**`
  - `api/src/schema/**`
  - `api/drizzle/*.sql`
  - `api/tests/api/**drive**`
  - `api/tests/api/**document**`
  - `api/tests/unit/**drive**`
  - `api/tests/unit/**document**`
  - `ui/src/lib/**drive**`
  - `ui/src/lib/**document**`
  - `ui/src/routes/**documents**`
  - `ui/tests/**drive**`
  - `ui/tests/**document**`
  - `e2e/tests/**document**`
  - `e2e/tests/**drive**`
  - `spec/SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md`
  - `spec/SPEC_VOL_CHAT_DOCS_LLM_RAG.md`
  - `spec/SPEC_EVOL_WORKSPACE_TYPES.md`
- **Forbidden Paths (must not change in this branch)**:
  - `README.md`
  - `README.fr.md`
  - `TRANSITION.md`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/**`
  - `spec/SPEC_EVOL_LLM_MESH.md`
  - `plan/14*-BRANCH_*.md`
  - `tmp/feat-llm-mesh-sdk/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `PLAN.md`
  - `TODO.md`
  - `api/package.json`
  - `api/package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `scripts/**`
- **Exception process**:
  - Declare exception ID `BR16a-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [ ] `attention` BR16a-Q1 — Google Cloud app provisioning is required before live OAuth UAT: OAuth client ID, OAuth client secret, redirect URI, consent screen status, test users, and allowed scopes.
- [ ] `attention` BR16a-Q2 — Decide initial OAuth scopes before implementation. Candidate minimum: Drive file metadata/listing and read-only content for selected files. Avoid broad Drive access unless explicitly required.
- [ ] `attention` BR16a-Q3 — Decide token storage policy: encrypted user-scoped refresh token in existing settings/secrets model, or separate connector table with encrypted token fields.
- [ ] `attention` BR16a-Q4 — Decide sync strategy for MVP: manual/on-demand indexing first vs polling/webhooks. Recommendation for MVP: on-demand indexing plus explicit resync action.
- [ ] `attention` BR16a-Q5 — Decide schema handling for non-local documents. Recommendation: add `source_type` and make `storage_key` nullable for Google Drive rows rather than storing a fake S3 key, but this needs focused migration/test coverage.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if Google connector and indexing split into independently validated PRs)
- Rationale: BR-16a is one Google Drive connector slice. BR-16b owns non-Google connectors.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only after OAuth and file indexing paths are implemented.
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow:
  - Develop and run tests in `tmp/feat-gdrive-sso-indexing-16a`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/entropic`, `ENV=dev`) only after branch is pushed and ready.
  - Switch back to `tmp/feat-gdrive-sso-indexing-16a` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & connector scope**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/feat-gdrive-sso-indexing-16a` from current `main`.
  - [x] Copy root `.env` into the branch worktree.
  - [x] Confirm active branch `feat/gdrive-sso-indexing-16a`.
  - [x] Define environment mapping: `API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=feat-gdrive-sso-indexing-16a`.
  - [x] Define test mapping: `API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`.
  - [x] Confirm BR-16a is Google Drive only and BR-16b owns SharePoint/OneDrive.
  - [x] Read current local document upload/index/chat integration files.
  - [x] Read existing auth/settings/secret storage patterns.
  - [x] Create `spec/SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md`.
  - [ ] Finalize BR16a-Q1 to BR16a-Q5 before implementation.

- [ ] **Lot 1 — Google OAuth and connector account**
  - [ ] Define Google connector account data model.
  - [ ] Add OAuth start/callback/disconnect/status API routes.
  - [ ] Store refresh/access token material through encrypted storage.
  - [ ] Add UI account connection surface.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] `make lint-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] **API tests**
      - [ ] Add OAuth route tests for start/callback/status/disconnect.
      - [ ] Add token storage unit tests with encrypted secret behavior mocked.
    - [ ] **UI tests**
      - [ ] Add account connection state tests if UI surface is added.

- [ ] **Lot 2 — Drive file discovery and selection**
  - [ ] Add Drive API client wrapper.
  - [ ] List user-accessible Drive files with metadata.
  - [ ] Filter supported MIME types for Docs, Sheets, Slides, PDFs, and text-like files.
  - [ ] Attach selected file references to existing document/context surfaces.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] `make lint-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] **API tests**
      - [ ] Add Drive client unit tests with mocked Google API responses.
      - [ ] Add document attach API tests for Google Drive refs.
    - [ ] **UI tests**
      - [ ] Add file picker/listing tests if UI surface is added.

- [ ] **Lot 3 — In-situ indexing**
  - [ ] Extract file content through Google APIs without copying source documents into Entropic storage.
  - [ ] Store metadata, chunks, embeddings, sync status, and source references.
  - [ ] Preserve existing local upload behavior.
  - [ ] Add manual resync path.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] `make lint-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] **API tests**
      - [ ] Add indexing service tests for Google Drive source refs.
      - [ ] Add sync status transition tests.
      - [ ] Add chunk storage tests.

- [ ] **Lot 4 — Chat documents tool integration**
  - [ ] Make `documents` tool retrieve indexed Google Drive chunks through existing context document paths.
  - [ ] Surface source metadata and stale/sync status in tool responses.
  - [ ] Ensure permission checks use the connected user/workspace context.
  - [ ] Lot gate:
    - [ ] `make typecheck-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] `make lint-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
    - [ ] **API tests**
      - [ ] Add deterministic chat documents tool tests with Google Drive indexed docs.
      - [ ] Add permission-denied tests for disconnected/unauthorized Google refs.
    - [ ] **AI tests**
      - [ ] Run AI document tool tests only when credentials are available and record flaky signatures if any.

- [ ] **Lot 5 — UAT**
  - [ ] Web app:
    - [ ] Connect Google account.
    - [ ] List/select Drive file.
    - [ ] Index selected file.
    - [ ] Ask chat to retrieve document facts.
    - [ ] Disconnect account and verify access is revoked.
  - [ ] Non-regression:
    - [ ] Local document upload still works.
    - [ ] Existing chat documents tool still works for local docs.

- [ ] **Lot 6 — Docs consolidation**
  - [ ] Consolidate final connector contract into `spec/SPEC_EVOL_GOOGLE_DRIVE_CONNECTOR.md`.
  - [ ] Update existing document connector/RAG specs only if behavior changes.
  - [ ] Update `BRANCH.md` feedback loop before final validation.

- [ ] **Lot 7 — Final validation**
  - [ ] `make typecheck-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] `make lint-api API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] `make test-api-unit API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] `make test-api-endpoints API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] `make typecheck-ui API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] `make lint-ui API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=test-feat-gdrive-sso-indexing-16a`
  - [ ] Create/update PR using `BRANCH.md` text as PR body.
  - [ ] Verify branch CI and resolve blockers.
  - [ ] Once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
