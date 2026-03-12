# Feature: BR-16 — Document Connectors (Google Workspace & SharePoint)

## BR-04 dependency note
Low impact: BR-04 renames `use_cases` → `initiatives` which affects `contextType` values in `contextDocuments`. Documents attach by `context_id` (not type name) so impact is limited to type enum values. See `spec/SPEC_EVOL_WORKSPACE_TYPES.md` §15.2.

## Objective
Add connector abstraction for external document sources (Google Workspace: Drive/Docs/Sheets, SharePoint/OneDrive) alongside existing local upload. Documents from any source are accessible in chat via the `documents` tool and attachable to any context (organization, folder, initiative).

## Scope / Guardrails
- Scope limited to: connector abstraction layer, Google Workspace connector, SharePoint/OneDrive connector, `contextDocuments` model extension, document sync pipeline, chat integration.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-document-connectors`.
- Automated test campaigns must run on dedicated environments (`ENV=test-*` / `ENV=e2e-*`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Branch environment mapping: `ENV=feat-document-connectors` `API_PORT=8716` `UI_PORT=5116` `MAILDEV_UI_PORT=1016`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `plan/16-BRANCH_feat-document-connectors.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `spec/**`, `PLAN.md`, `TODO.md` (docs consolidation or roadmap sync only)
  - `scripts/**` (only if strictly required by the branch objective)
- **Exception process**:
  - Declare exception ID `BR16-EXn` in this file before touching conditional/forbidden paths.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

## Questions / Notes
- DC-Q1: OAuth consent and token refresh strategy for Google Workspace and SharePoint.
- DC-Q2: Sync model — real-time (webhook), polling, or on-demand only?
- DC-Q3: Conflict resolution when external doc is modified while attached to a context.
- DC-Q4: Privacy/compliance constraints for external document content storage vs reference-only.

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
- Rationale: Connector work is additive and scoped to document-specific files.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot when UI/plugin surface is impacted).
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-document-connectors`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-document-connectors` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read relevant `.mdc` files, `README.md`, `TODO.md`, and linked specs.
  - [ ] Confirm isolated worktree `tmp/feat-document-connectors` and environment mapping (`ENV=feat-document-connectors`).
  - [ ] Capture Make targets needed for debug/testing and CI parity.
  - [ ] Confirm scope and dependency boundaries with upstream branches.
  - [ ] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR16-EXn` exceptions if needed.
  - [ ] Finalize open questions required before implementation starts.
  - [ ] Design connector abstraction interface and data model extension (`connector_type`, `external_ref`, `sync_status`, `document_connectors` table).

- [ ] **Lot 1 — Connector Abstraction & Google Workspace**
  - [ ] Implement connector abstraction interface (`DocumentConnector`).
  - [ ] Implement Google Workspace connector (Drive API: list, read, metadata, OAuth).
    - <feedback loop if required only>
      - `blocked` / `deferred` / `cancelled` / `attention`: message (requires clarification about ...)
      - `clarification` / `acknowledge` / `refuse`: explanation
  - [ ] Extend `contextDocuments` schema with `connector_type`, `external_ref`, `sync_status`.
  - [ ] UI: connector picker in document panel (alongside local upload).
  - [ ] Lot 1 gate:
    - [ ] `make typecheck-api ENV=test-feat-document-connectors`
    - [ ] `make lint-api ENV=test-feat-document-connectors`
    - [ ] `make test-api ENV=test-feat-document-connectors`
    - [ ] `make typecheck-ui ENV=test-feat-document-connectors`
    - [ ] `make lint-ui ENV=test-feat-document-connectors`
    - [ ] `make test-ui ENV=test-feat-document-connectors`

- [ ] **Lot 2 — SharePoint/OneDrive Connector**
  - [ ] Implement SharePoint/OneDrive connector (Microsoft Graph API).
  - [ ] Document sync pipeline (content extraction from remote sources).
  - [ ] Chat integration — `documents` tool accesses connected docs same as local.
  - [ ] Lot 2 gate:
    - [ ] `make typecheck-api ENV=test-feat-document-connectors`
    - [ ] `make lint-api ENV=test-feat-document-connectors`
    - [ ] `make test-api ENV=test-feat-document-connectors`
    - [ ] `make typecheck-ui ENV=test-feat-document-connectors`
    - [ ] `make lint-ui ENV=test-feat-document-connectors`
    - [ ] `make test-ui ENV=test-feat-document-connectors`
    - [ ] `make build-api build-ui-image API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=e2e-feat-document-connectors`
    - [ ] `make clean test-e2e API_PORT=8716 UI_PORT=5116 MAILDEV_UI_PORT=1016 ENV=e2e-feat-document-connectors`

- [ ] **Lot N-2** UAT
  - [ ] Web app (splitted by sublist for each env)
    - [ ] <Instruction by env before testing>
    - [ ] <Detailed evol tests>
    - [ ] <Detailed non reg tests>

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Consolidate branch learnings into the relevant `spec/*` files.
  - [ ] Update `PLAN.md` status and dependency notes after integration readiness.

- [ ] **Lot N — Final validation**
  - [ ] Re-run full branch gates (typecheck, lint, tests, e2e when impacted).
  - [ ] Verify CI status and attach executed command list in PR notes.
