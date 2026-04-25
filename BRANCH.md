# Feature: BR-23a Archive Uploads (Download-Only)

## Objective
Allow users to upload `.zip`, `.tar.gz`, and `.tgz` files as context documents. At this stage, those archives are stored and downloadable like other documents, but they must not enter indexing/exploration flows.

## Scope / Guardrails
- Scope limited to document upload/download behavior for local archive files.
- No migration in this branch.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/entropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens only in isolated worktree `tmp/feat-archive-upload-23a`.
- Automated tests run on dedicated environments, never root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/routes/api/documents.ts`
  - `api/src/services/tool-service.ts`
  - `api/tests/api/documents.test.ts`
  - `api/tests/unit/documents-tool-service.test.ts`
  - `ui/src/lib/utils/documents.ts`
  - `ui/src/lib/components/DocumentsBlock.svelte`
  - `ui/src/lib/components/ChatPanel.svelte`
  - `ui/tests/utils/documents.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/drizzle/*.sql`
  - `spec/**`
  - `PLAN.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `ui/src/locales/*.json`
  - `api/src/services/**`
- **Exception process**:
  - Declare exception ID `BR23a-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `clarification` BR23a-D1 — Scope is strictly download-only archive support. No archive extraction, no indexing, no summarization, no archive browsing in this branch.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: this is a micro-slice touching one existing document flow.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only if needed after the slice is locally verified.
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow:
  - Develop and run tests in `tmp/feat-archive-upload-23a`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/entropic`, `ENV=dev`) only if required.
  - Switch back to `tmp/feat-archive-upload-23a` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/feat-archive-upload-23a`.
  - [x] Copy root `.env` into the branch worktree.
  - [x] Confirm active branch `feat/archive-upload-23a`.
  - [x] Define test mapping: `API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Upload/download-only archives**
  - [x] Accept `.zip`, `.tar.gz`, and `.tgz` in document upload surfaces.
  - [x] Normalize archive MIME detection from filename/type.
  - [x] Store archives in document storage and skip `document_summary` enqueue.
  - [x] Keep archive documents downloadable through the existing `/documents/:id/content` route.
  - [x] Prevent `documents` tool exploration for download-only archives.
  - [x] Avoid misleading summary affordances for skipped-index docs in the documents block.
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
    - [x] `make lint-api API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
    - [x] `make typecheck-ui API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
    - [x] `make lint-ui API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
    - [x] **API tests**
      - [x] `api/tests/api/documents.test.ts`
      - [x] `api/tests/unit/documents-tool-service.test.ts`
      - [x] Scoped runs:
        - [x] `make test-api-endpoints SCOPE=tests/api/documents.test.ts API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
        - [x] `make test-api-unit SCOPE=tests/unit/documents-tool-service.test.ts API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
    - [x] **UI tests**
      - [x] `ui/tests/utils/documents.test.ts`
      - [x] Scoped run:
        - [x] `make test-ui SCOPE=tests/utils/documents.test.ts API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`

- [ ] **Lot 2 — Final validation**
  - [ ] `make typecheck-api API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make lint-api API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make typecheck-ui API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make lint-ui API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make test-api-unit API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make test-api-endpoints API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] `make test-ui SCOPE=tests/utils/documents.test.ts API_PORT=9081 UI_PORT=5281 MAILDEV_UI_PORT=1181 ENV=test-feat-archive-upload-23a`
  - [ ] Create/update PR using `BRANCH.md` as PR body.
  - [ ] Verify branch CI and resolve blockers.
