# Feature: i18n - Core + tech keys

## Objective
Establish the bilingual i18n core (FR/EN) and ensure technical keys remain in English.

## Scope / Guardrails
- Scope limited to i18n scaffolding and technical key naming.
- Prompts localization is deferred to `feat/i18n-prompts-bilingual` (Wave 2).
- One migration max in `api/drizzle/*.sql` (not expected).
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Scoping Decisions
- **Routes**: Clean break — rename French routes to English (no redirects).
- **API export prefixes**: Clean break — rename `cas-usage` → `usecase`, `dossier` → `folder`, etc.
- **Prompts**: Deferred to Wave 2 (`feat/i18n-prompts-bilingual`).
- **Missing key fallback**: Display the key itself (there should be no missing keys).

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- Rationale: Grouped core + tech keys to keep waves at four branches.

## UAT Management (in orchestration context)
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Confirm scope and guardrails.
  - [x] Scoping decisions confirmed by user.

- [x] **Lot 1 — Core i18n scaffolding**
  - [x] Expand `ui/src/locales/fr.json` and `ui/src/locales/en.json` with header + common keys.
  - [x] Extract hardcoded French strings from Header.svelte and +layout.svelte with `$_()` calls.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`
  - [ ] UAT: Header labels display in FR/EN and language switch works

- [x] **Lot 2 — Technical key conventions (route + API renaming)**
  - [x] Rename UI routes: `/cas-usage` → `/usecase`, `/dossiers` → `/folders`, `/organisations` → `/organizations`, `/matrice` → `/matrix`, `/parametres` → `/settings`, `/dossier` → `/folder`.
  - [x] Update all internal links, navigation, and PROTECTED_ROUTES references.
  - [x] Update API export prefixes in `api/src/routes/api/import-export.ts`.
  - [x] Update E2E tests route references.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`
  - [ ] UAT: Navigate to each renamed route (usecase/folders/folder/organizations/matrix/settings)

- [ ] **Lot N — Final validation**
  - [ ] Tests (by scope, by file)
  - [ ] API: `api/tests/api/import-export.test.ts`
  - [ ] UI: none (no UI unit tests in scope)
  - [ ] E2E:
    - [ ] `e2e/tests/00-access-control.spec.ts`
    - [ ] `e2e/tests/00-ai-generation.spec.ts`
    - [ ] `e2e/tests/01-admin-users.spec.ts`
    - [ ] `e2e/tests/01-app.spec.ts`
    - [ ] `e2e/tests/01-organizations-detail.spec.ts`
    - [ ] `e2e/tests/02-organizations.spec.ts`
    - [ ] `e2e/tests/03-chat.spec.ts`
    - [ ] `e2e/tests/03-chat-mobile-docked-nav.spec.ts`
    - [ ] `e2e/tests/04-dossiers-reload-draft.spec.ts`
    - [ ] `e2e/tests/04-documents-summary.spec.ts`
    - [ ] `e2e/tests/04-documents-ui-actions.spec.ts`
    - [ ] `e2e/tests/04-tenancy-workspaces.spec.ts`
    - [ ] `e2e/tests/05-error-handling.spec.ts`
    - [ ] `e2e/tests/05-folders.spec.ts`
    - [ ] `e2e/tests/05-i18n.spec.ts`
    - [ ] `e2e/tests/05-usecase-detail.spec.ts`
    - [ ] `e2e/tests/06-settings.spec.ts`
    - [ ] `e2e/tests/06-streams.spec.ts`
    - [ ] `e2e/tests/06-usecase.spec.ts`
    - [ ] `e2e/tests/07-import-export.spec.ts`
    - [ ] `e2e/tests/07-matrix.spec.ts`
    - [ ] `e2e/tests/07-workflow.spec.ts`
    - [ ] `e2e/tests/07_comment_assistant.spec.ts`
  - [ ] Sub-lot gate: `make test-api`
  - [ ] Sub-lot gate: `make test-ui`
  - [ ] Prepare E2E build: `make build-api build-ui-image`
  - [ ] Sub-lot gate: `make clean test-e2e`
  - [ ] Final gate: Create PR with BRANCH.md content & verify CI
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
