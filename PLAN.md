# Multi-Branch Orchestration Plan

## Objective
Coordinate multi-branch, multi-agent work for the TODO items in `TODO.md` (128–143) with UAT per lot and clear ownership of UAT environments.

## Scope / Guardrails
- Make-only workflow (no direct Docker or npm).
- One need per branch, one capability per PR.
- `BRANCH.md` required per branch.
- English-only for code/comments/docs/commits/PR content.
- No destructive actions without ⚠ approval.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (this one is the merge)
- Rationale: Multi-need split with orthogonal branches and parallel waves.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Wave setup (planning)**
  - [x] Create `PLAN.md` and define waves (max 4 per wave).
  - [x] Create `tmp/<branch-slug>/BRANCH.md` for each active branch.
  - [x] Collect scoping decisions and confirm with user.

- [x] **Lot 1 — Wave 1 (independent bases)**
  - [x] **Environment**: Run UAT in the corresponding tmp workspace:
    - `tmp/feat-print-docx-usecase-onepage` → `ENV=feat-print-docx-usecase-onepage`
    - `tmp/feat-i18n-core-and-tech-keys` → `ENV=feat-i18n-core-and-tech-keys`
    - `tmp/feat-usecase-constraints` → `ENV=feat-usecase-constraints`

  - [x] **feat/print-docx-usecase-onepage** (BRANCH.md: `tmp/feat-print-docx-usecase-onepage/BRANCH.md`)
    - [x] Implement DOCX export endpoint/service based on `dolanmiu/docx`.
    - [x] Integrate one-page DOCX template and UI download action from use case detail.
    - [x] Stabilize markdown rendering, loop expansion, style preservation, spacing, links, stars/crosses.
    - [x] UAT: Download DOCX from use case detail (File menu)
    - [!] UAT: Ctrl+P flow (deferred; validate when implemented)

  - [x] **feat/i18n-core-and-tech-keys** (BRANCH.md: `tmp/feat-i18n-core-and-tech-keys/BRANCH.md`)
    - [x] Add FR/EN locale keys and wire header/layout labels to i18n.
    - [x] Rename routes and technical keys to English conventions.
    - [x] Update API import/export prefixes and E2E route references.
    - [x] UAT: Header labels show FR/EN and language switch works
    - [x] UAT: Navigate to renamed routes (usecase, folders, folder, organizations, matrix, settings)

  - [x] **feat/usecase-constraints** (BRANCH.md: `tmp/feat-usecase-constraints/BRANCH.md`)
    - [x] Add `constraints` in API validation/types and AI schema/prompt.
    - [x] Add constraints in UI store/detail and print layout (2x2 grid).
    - [x] UAT: Use case detail shows 2x2 grid with Constraints (edit + print preview)
    - [x] UAT: Chat IA update bullet list fields live in UI (benefits, constraints, ...)

  - [x] **Wave 1 integration merge on `feat/i18-print`**
    - [x] Merge `feat/i18n-core-and-tech-keys`
    - [x] Merge `feat/usecase-constraints`
    - [x] Merge `feat/print-docx-usecase-onepage`
    - [x] Resolve merge conflicts (`BRANCH.md`) with integration-oriented content

- [x] **Lot 1.5 — Integration UAT (post-merge)**
  - [x] Applied integration fixes:
    - [x] Compact reference links in template via `{{$ref.link}}` (title linked to URL).
    - [x] Bottom background image anchoring fixed (page-fixed, full-width, bottom-aligned).
  - [x] Run UAT on integration environment: `feat/i18-print`.
    - [x] Retest route and navigation consistency:
      - [x] Open `/usecase`, `/folders`, `/folder/new`, `/organizations`, `/matrix`, `/settings`.
    - [X] Retest use case detail UI (constraints + editing):
      - [x] Validate 2x2 grid (Benefits | Constraints / Success Metrics | Risks).
      - [x] Validate live updates from chat for list fields (including constraints).
    - [x] Retest print/docx flow:
      - [x] Download DOCX from Use Case detail File menu.
      - [x] Validate DOCX content rendering: markdown emphasis, lists, links, stars/crosses, matrix tables.
      - [x] Confirm no extra blank line above matrix iteration tables.

- [ ] **Lot 2 — Wave 2 (dependent branches)**
  - [ ] **Environment**: Run UAT in the corresponding tmp workspace:
    - `tmp/feat-print-exec-synthesis-multipage` → `ENV=feat-print-exec-synthesis-multipage`
    - `tmp/feat-i18n-prompts-bilingual` → `ENV=feat-i18n-prompts-bilingual`
    - `tmp/feat-i18n-bilingual-modeling` → `ENV=feat-i18n-bilingual-modeling`
    - `tmp/feat-usecase-matrix-generation` → `ENV=feat-usecase-matrix-generation`

  - [ ] **feat/print-exec-synthesis-multipage** (BRANCH.md: `tmp/feat-print-exec-synthesis-multipage/BRANCH.md`)
    - [ ] UAT: TBD (define once implementation starts)

  - [ ] **feat/i18n-prompts-bilingual** (BRANCH.md: `tmp/feat-i18n-prompts-bilingual/BRANCH.md`)
    - [ ] UAT: TBD (define once implementation starts)

  - [ ] **feat/i18n-bilingual-modeling** (BRANCH.md: `tmp/feat-i18n-bilingual-modeling/BRANCH.md`)
    - [ ] UAT: TBD (define once implementation starts)

  - [ ] **feat/usecase-matrix-generation** (BRANCH.md: `tmp/feat-usecase-matrix-generation/BRANCH.md`)
    - [ ] UAT: TBD (define once implementation starts)

- [ ] **Lot N — Final validation (after integration)**
  - [ ] Consolidated test backlog from Wave 1 BRANCH files:
    - [ ] API: `api/tests/api/import-export.test.ts` (i18n/export prefixes)
    - [ ] API: `api/tests/api/docx.test.ts` (docx generation)
    - [ ] UI: none explicitly required by Wave 1 scopes
    - [ ] E2E: route/i18n regression pack (from `feat/i18n-core-and-tech-keys`)
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
    - [ ] E2E: `e2e/tests/05-usecase-detail.spec.ts` docx download assertions (print branch)
    - [ ] E2E: `e2e/tests/05-usecase-detail.spec.ts` constraints live update via chat/SSE (constraints branch)
    - [ ] E2E: Ctrl+P docx->pdf->print flow (when implemented)
  - [ ] `make test-api`
  - [ ] `make test-ui`
  - [ ] `make build-api build-ui-image`
  - [ ] `make clean test-e2e`
  - [ ] Final gate: Create PRs using `BRANCH.md` content and verify CI
  - [ ] Before merge to `main`: delete branch-level `BRANCH.md` files (integration complete)
