# Feature: Print - docx base + one-page usecase

## Objective
Replace the print pipeline with docx-templates and deliver the one-page usecase template.

## Scope / Guardrails
- Scope limited to print/export generation and the one-page usecase template.
- One migration max in `api/drizzle/*.sql` (not expected).
- Make-only workflow, no direct Docker commands.
- All new text in English.

## Scoping Decisions
- **Coexistence**: docx export coexists with CSS print initially. If successful, CSS print will be removed later.
- **Architecture**: API-based docx generation (server-side).
- **Ctrl+P flow**: Ctrl+P should trigger docx generation → PDF → print (à la Google Docs).
- **Labels**: English by default (from object field names), content in original language.
- **File naming**: `usecase-{id}-{name-slug}.docx`

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- Rationale: Grouped base + one-page template to keep waves at four branches.

## UAT Management (in orchestration context)
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Confirm scope and guardrails.
  - [x] Scoping decisions confirmed by user.

- [x] **Lot 1 — docx-templates base**
  - [x] Add `docx-templates` dependency to API (`make install-api docx-templates`).
  - [x] Create `api/src/services/docx-service.ts` — docx generation service.
  - [x] Create `api/src/routes/api/docx.ts` — docx export endpoint.
  - [x] Create `api/templates/README.md` — template variables documentation (actual .docx template to be created manually).
  - [x] Register docx router in `api/src/routes/api/index.ts`.
  - [ ] Lot gate: `make typecheck-api` + `make lint-api`

- [x] **Lot 2 — One-page usecase template + UI integration**
  - [x] Add "Download DOCX" option in `FileMenu.svelte` (new `onDownloadDocx` prop + `FileDown` icon).
  - [x] Wire docx download in use case detail page (`/cas-usage/[id]/+page.svelte`).
  - [ ] Implement Ctrl+P interception: generate docx → convert to PDF → trigger browser print (deferred).
  - [ ] Lot gate: `make typecheck-ui` + `make lint-ui`
  - [ ] UAT: verify one-page export and Ctrl+P flow

- [ ] **Lot N — Final validation**
  - [ ] Sub-lot gate: `make test-api`
  - [ ] Sub-lot gate: `make test-ui`
  - [ ] Prepare E2E build: `make build-api build-ui-image`
  - [ ] Sub-lot gate: `make clean test-e2e`
  - [ ] Final gate: Create PR with BRANCH.md content & verify CI
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
