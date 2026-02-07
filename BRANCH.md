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

- [ ] **Lot 1 — Core i18n scaffolding**
  - [ ] Expand `ui/src/locales/fr.json` and `ui/src/locales/en.json` with ~150+ new keys.
  - [ ] Extract all hardcoded French strings from Svelte components and replace with `$_()` calls.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`

- [ ] **Lot 2 — Technical key conventions (route + API renaming)**
  - [ ] Rename UI routes: `/cas-usage` → `/usecase`, `/dossiers` → `/folders`, `/organisations` → `/organizations`, `/matrice` → `/matrix`, `/parametres` → `/settings`, `/dossier` → `/folder`.
  - [ ] Update all internal links, navigation, and PROTECTED_ROUTES references.
  - [ ] Update API export prefixes in `api/src/routes/api/import-export.ts`.
  - [ ] Update E2E tests route references.
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`

- [ ] **Lot N — Final validation**
  - [ ] Sub-lot gate: `make test-api`
  - [ ] Sub-lot gate: `make test-ui`
  - [ ] Prepare E2E build: `make build-api build-ui-image`
  - [ ] Sub-lot gate: `make clean test-e2e`
  - [ ] Final gate: Create PR with BRANCH.md content & verify CI
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
