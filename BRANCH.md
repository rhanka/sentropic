# Feature: Chat Tools — Folders / Use Cases / Executive Summary / Companies (CRUD + Batch + AI)

## Objective
Add chat tool-calls so the assistant can operate from key UI views with **read + update** tools (mandatory), plus selected **batch** and **destructive** actions (delete) and **AI-assisted creation/population** where relevant:
- Folders view: list/read, batch actions, delete, add one or many folders, optionally populate with AI.
- Folder context: list/read/update use cases, batch update (e.g., translate all use cases to English), add/delete use cases.
- Executive summary: read/update, optionally grounded on the current folder’s use cases.
- Companies: list/read/update, batch update, batch add (AI-assisted), batch delete, plus company detail read/update.

**Important**: this feature expands beyond “read-only”. Any destructive or high-impact action must follow project guardrails (⚠ human approval on dangerous actions).

## Scope
- API-only unless UI changes are strictly required to display tool calls (prefer none).
- Minimal changes: tool registry + tool handlers + authorization + tests.
- No broad refactors, no unrelated schema changes.

## Views → Tools availability (contract)
- **Folders list view**:
  - Folder tools: read/list, create (single/multi), update (batch allowed), delete (batch allowed).
  - Can access use case tools (list/detail) for any folder selected in context.
- **Use case list view (within a folder)**:
  - Use case tools: read/list, update (batch allowed), create, delete (batch allowed).
  - Executive summary tools are allowed.
  - Constraint: only the **current folder** is in scope for list/batch operations.
- **Use case detail view**:
  - Use case tools: read + update only (no change vs current behavior).
- **Companies list view**:
  - Companies (batch) tools: list/read, create (batch + AI-assisted), update (batch allowed), delete (batch allowed).
- **Company detail view**:
  - Company (detail) tools: read + update for the **current company**.
  - Read-only access to that company’s folders and use cases.
- **Executive summary view**:
  - Executive summary tools: read + update.
  - Can access “use case list” tools for the current folder.
- **Dashboard view (`/dashboard`)**:
  - Folder-scoped when a folder is selected in the dashboard.
  - Must have access to folder + executive summary tools (read/update), use cases list (read), and web tools.
- **Matrix view (`/matrice`)**:
  - Folder-scoped when a folder is selected.
  - Must have access to: folder, company (read-only), use cases list/detail (read), matrix (read/update once implemented), and web tools.

## Tool design principles (based on your additions)
- **Read + update tools exist for each entity**, consistent with the existing use case tools.
- **Field selection**: tools should support either:
  - returning only `ids` (then follow-up with detail tool), or
  - returning selected fields / all fields (same pattern across entities).
- **Workspace-scoped authorization**: tools enforce session + workspace scope. (No extra object-level rules unless already enforced elsewhere.)

## Proposed Tool IDs (explicit detail vs batch)
Tool IDs should be **English-only** and stable. UI text remains FR via i18n.

### Companies (batch / list scope) — `companies_*`
- `companies_list`: list companies (supports `ids_only` or `fields` selection).
- `companies_update_batch`: batch update companies (⚠ high-impact).
- `companies_create_batch`: create one or many companies; optionally AI-assisted (⚠ high-impact).
- `companies_delete_batch`: delete one or many companies (⚠ high-impact).

### Company (detail scope) — `company_*`
- `company_get`: read one company by id (supports `fields` selection).
- `company_update`: update one company by id (⚠ can be high-impact depending on fields).

Note: the same naming split applies to folders/use cases where we have both “single-entity” and “batch/list” operations.

## Naming decision (Option B): `get` / `list` / `update`
We standardize tool names to a REST-like convention:
- **Detail**: `*_get`
- **List/Batch scope**: `*_list`
- **Mutation**: `*_update` (single-entity) / `*_update_batch` (batch)

### Migration plan (from current mixed naming)
Current code already follows Option B for new entities, except **use case detail** which is still `read_usecase`.

**Target naming (Option B)**
- Use case detail:
  - Target: `usecase_get` (detail)
  - Current: `read_usecase` (detail)  → will be migrated
  - Update: keep `update_usecase_field` for now, but consider renaming to `usecase_update` later (or alias).
- Companies:
  - `companies_list` ✅
  - `company_get` ✅
  - `company_update` ✅
- Folders:
  - `folders_list` ✅
  - `folder_get` ✅
  - `folder_update` ✅
- Folder-scoped use cases list:
  - `usecases_list` ✅
- Executive summary:
  - `executive_summary_get` ✅
  - `executive_summary_update` ✅
- Matrix (folder.matrixConfig):
  - Target: `matrix_get` (read matrix for a folder)
  - Target: `matrix_update` (update matrix for a folder)
  - Note: matrix is stored on `folders.matrixConfig` today; the tools are a dedicated façade (vs reusing `folder_get` / `folder_update`).

**Compatibility strategy**
- Add `usecase_get` as an **alias** for `read_usecase` (same handler), keep `read_usecase` temporarily to avoid regressions.
- Update system prompts/docs to prefer `usecase_get`.
- Later: remove `read_usecase` after UAT + CI green + no usage in prompts/tests.

## Implementation Status (what is done vs pending)

### Implemented (already coded in this branch)

#### Tool registry (`api/src/services/tools.ts`)
- [x] Added tool definitions:
  - [x] `companies_list`
  - [x] `company_get`
  - [x] `company_update`
  - [x] `folders_list`
  - [x] `folder_get`
  - [x] `folder_update`
  - [x] `usecases_list`
  - [x] `executive_summary_get`
  - [x] `executive_summary_update`
  - [ ] (Planned) `usecase_get` (alias of `read_usecase`, for Option B consistency)
  - [ ] (Planned) `matrix_get`
  - [ ] (Planned) `matrix_update`

#### Tool handlers (`api/src/services/tool-service.ts`)
- [x] Companies:
  - [x] `listCompanies` (supports `idsOnly` + `select`)
  - [x] `getCompany` (supports `select`)
  - [x] `updateCompanyFields` (writes `chat_contexts` + `context_modification_history` when session info provided; NOTIFY `company_events`)
- [x] Folders:
  - [x] `listFolders` (supports `companyId` filter, `idsOnly` + `select`; parses `matrixConfig` and `executiveSummary`)
  - [x] `getFolder` (supports `select`; parses `matrixConfig` and `executiveSummary`)
  - [x] `updateFolderFields` (writes audit/history; NOTIFY `folder_events`)
- [ ] Matrix (folder.matrixConfig):
  - [ ] `getMatrix` (read-only; returns parsed matrixConfig; supports select if we define it)
  - [ ] `updateMatrix` (update matrixConfig; writes audit/history under contextType `folder`; NOTIFY `folder_events`)
- [x] Executive summary:
  - [x] `getExecutiveSummary` (reads `folders.executiveSummary`, parses JSON, supports `select`)
  - [x] `updateExecutiveSummaryFields` (writes audit/history under contextType `executive_summary`; NOTIFY `folder_events`)
- [x] Folder-scoped use cases:
  - [x] `listUseCasesForFolder` (supports `idsOnly` + `select` on `use_cases.data`)

#### Chat tool wiring (`api/src/services/chat-service.ts`)
- [x] Tool enabling per `primaryContextType`:
  - [x] `usecase`: existing tools kept
  - [x] `company`: enable companies + company detail + folder listing
  - [x] `folder`: enable folder + usecases list + executive summary tools
  - [x] `executive_summary`: enable executive summary + usecases list + folder_get
- [x] Dispatch + security checks:
  - [x] Enforces “context id must match tool arg id” for detail tools (`company_get/company_update`, `folder_get/folder_update`, `executive_summary_*`, `usecases_list`)
  - [x] Keeps read-only workspace restrictions for update tools
- [x] Web tools available in **all** contexts:
  - [x] `web_search`
  - [x] `web_extract`
- [x] Folder-list behavior (context `folder` without id):
  - [x] allow read-only `folder_get(folderId=...)`, `usecases_list(folderId=...)`, `executive_summary_get(folderId=...)` (workspace-scoped)
- [x] Folder → company read-only:
  - [x] allow `company_get` in `folder` / `executive_summary` contexts **only** for the company linked to the current folder (`folders.companyId`)
- [x] System prompt enriched for `company`, `folder`, `executive_summary` contexts (tool list + rules)
  - [ ] (Planned) Update `usecase` system prompt to prefer `usecase_get` naming (keep `read_usecase` as alias during migration)
  - [ ] (Planned) Add matrix tools to contexts:
    - folder (detail + list-with-selected-folder via `/cas-usage`)
    - executive_summary
    - usecase detail (read-only matrix of the parent folder)
  - [ ] (Planned) Extend usecase detail context to allow:
    - read-only matrix of the parent folder
    - read-only company associated to the parent folder (or use case companyId if present)

#### Tests
- [x] Added unit tests for the new ToolService handlers:
  - [x] `api/tests/unit/tool-service-company-folder.test.ts`
  - Covers: list/get/update company (history + chat context), list usecases for folder (select), get/update executive summary (history)

### Not implemented yet (still pending / next iterations)
- [ ] Batch update / batch delete / multi-create tools (the “⚠ high-impact” set):
  - [ ] `companies_update_batch`, `companies_create_batch`, `companies_delete_batch`
  - [ ] folder batch operations (create/update/delete batch)
  - [ ] use case batch operations (translate all, batch delete, etc.)
- [ ] AI-assisted “populate” tools for folders/companies (contract + safeguards + queue integration)
- [ ] E2E coverage (only if we need UI changes; currently avoided)
- [ ] Naming migration work (Option B):
  - [ ] Add `usecase_get` tool + dispatch alias
  - [ ] Update tests to accept either name (transition) and then switch to `usecase_get`
  - [ ] Update prompts/docs to use `usecase_get`
  - [ ] (Later) consider `usecase_update` alias for `update_usecase_field` if we want full Option B purity
- [ ] Matrix tools:
  - [ ] Add `matrix_get` / `matrix_update` tool definitions + handlers + wiring
  - [ ] Enforce view-scope rules:
    - `/cas-usage` (list): matrix must be readable for the **selected folder**
    - `/executive-summary`: matrix must be readable for the **current folder**
    - `/cas-usage/[id]` (use case detail): matrix must be readable for the **parent folder** (derive folderId securely)
  - [ ] Add tests + UAT scenarios

### Files touched (for quick review)
- `api/src/services/tools.ts`
- `api/src/services/tool-service.ts`
- `api/src/services/chat-service.ts`
- `api/tests/unit/tool-service-company-folder.test.ts`
- `ui/src/lib/components/ChatPanel.svelte`
- `ui/src/routes/dashboard/+page.svelte`
- `BRANCH.md`

### Quality gates (already executed)
- [x] `make lint-api`
- [x] `make typecheck-api`

## UAT Test Plan (manual)
Goal: validate the **end-to-end behavior** of the new tool-calls from the UI (and the resulting DB updates), before running automated tests.

### Coverage (what this UAT plan does / does not cover)
- **Covers (implemented in this branch)**:
  - `companies_list`, `company_get`, `company_update`
  - `folders_list`, `folder_get`, `folder_update`
  - `usecases_list` (folder-scoped list)
  - `executive_summary_get`, `executive_summary_update`
  - Security checks (context id mismatch) + read-only blocking for update tools
- **Also re-validates (already existing feature, still active)**:
  - `read_usecase` + `update_usecase_field` + web tools in usecase context (regression guard)
- **Does NOT cover (not implemented yet on this branch)**:
  - any batch create/update/delete tools (`*_create_batch`, `*_update_batch`, `*_delete_batch`)
  - AI-populate tools and their safeguards
  - the Option B naming migration task (`usecase_get` alias) — planned next
  - matrix tools (`matrix_get` / `matrix_update`) — planned next

### General UAT rules
- Use a test workspace with a few sample objects: **2 companies**, **2 folders**, **3–5 use cases**.
- Always open the chat **from the target view** so `primaryContextType` / `primaryContextId` is correct.
- Validate tool call cards in the UI:
  - the expected tool name appears,
  - the result is visible,
  - errors are readable when an action is blocked (read-only / security mismatch).

### Scenario 1 — Company list view: list + cross-link folders ✅
- **Context**: companies list
- **Prompt**: “Liste les entreprises avec juste id + name”
- **Expected tools**: `companies_list` (`select=["id","name"]` or equivalent)
- **Checks**: output contains 2+ companies; no unexpected data dump

- **Prompt**: “Pour l’entreprise ACME, liste ses dossiers”
- **Expected tools**: `folders_list` with `companyId=<acmeId>` (or company context-derived filtering)
- **Checks**: folders belong to that company; no folders from other companies

### Scenario 2 — Company detail view: read + update ✅
- **Context**: company detail
- **Prompt**: “Affiche l’industrie et la taille”
- **Expected tools**: `company_get` with `select=["industry","size"]`
- **Checks**: values match UI fields

- **Prompt**: “Change l’industrie en ‘Tech’”
- **Expected tools**: `company_update`
- **Checks**:
  - DB is updated (refresh company detail view)
  - a company SSE update is emitted (UI refresh if applicable)
  - tool call result shows `applied` changes

### Scenario 3 — Folder list view: list + select folder for context ✅
- **Context**: folders list
- **Prompt**: “Liste les dossiers avec id, name, companyId”
- **Expected tools**: `folders_list` with `select=["id","name","companyId"]`
- **Checks**: minimal payload; parsed fields do not crash tool rendering

### Scenario 4 — Folder detail view: read + use cases list ✅
- **Context**: use case list /cas-usage
- **Prompt**: “Récupère le dossier (name + description)”
- **Expected tools**: `folder_get` with `select=["name","description"]`

- **Prompt**: “Liste les cas d’usage du dossier (ids seulement)”
- **Expected tools**: `usecases_list` with `idsOnly=true`
- **Checks**: returned ids count matches the list view

- **Prompt**: “Donne-moi les infos de l’entreprise associée au dossier (name + industry + size)”
- **Expected tools**:
  - `folder_get` (select `companyId`) if needed
  - `company_get` (select `name/industry/size`)
- **Checks**:
  - if the folder has no company, assistant explains it (no unsafe guess)
  - if company exists, returned values match the company detail view

### Scenario 4bis — Folder context: read + update matrix (planned when `matrix_get/matrix_update` is implemented)
- **Context**: `/cas-usage` (use case list) with a selected folder OR `/dossiers/[id]`
- **Prompt**: “Affiche la matrice (axes + weights)”
- **Expected tools**: `matrix_get` (or, during transition, `folder_get select=["matrixConfig"]`)
- **Checks**: returned matrix matches what the “Matrice” page shows for the folder

- **Prompt**: “Change le poids de l’axe valeur ‘X’ à 0.3”
- **Expected tools**: `matrix_update` (writes folder update history; emits folder_events)
- **Checks**: matrix change is visible after refresh; no crash in scoring UI

### Scenario 5 — Executive summary: read + update ✅
- **Context**: dashboard (folder selected) OR executive summary view (folder selected)
- **Prompt**: “Affiche uniquement l’introduction et la recommandation”
- **Expected tools**: `executive_summary_get` with `select=["introduction","recommandation"]`

- **Prompt**: “Réécris l’introduction en 3 puces”
- **Expected tools**: `executive_summary_update`
- **Checks**:
  - `folders.executiveSummary` updated (refresh view)
  - history entry created under contextType `executive_summary`
  - dashboard UI updates automatically via SSE `folder_update` (no manual refresh needed)

### Scenario 6 — Security: context mismatch must be rejected
- **Context**: company detail (ACME)
- **Prompt**: “Lis l’entreprise <otherCompanyId>”
- **Expected result**: tool call should fail with a **Security** error (context id mismatch)

### Scenario 7 — Read-only mode: updates must be blocked
- **Context**: chat session scoped to a different readable workspace (admin_app read-only)
- **Prompt**: “Change l’industrie en ‘Tech’”
- **Expected result**: tool call result returns error “Read-only workspace … disabled”

### UAT exit criteria (Stop/Go)
- **Go** when:
  - scenarios 1–5 work without errors
  - scenarios 6–7 correctly block unsafe behavior
- **Stop** when:
  - a tool can modify an object outside its context
  - updates are possible in read-only mode
  - tool result payloads are too large / unusable in the UI

### Scenario 8 — Use case detail view regression: read + update (existing feature)
- **Context**: use case detail view
- **Prompt**: “Lis le use case (problem + solution seulement)”
- **Expected tools**: `read_usecase` with `select=["problem","solution"]`

- **Prompt**: “Mets à jour le champ problem en 3 puces”
- **Expected tools**: `update_usecase_field`
- **Checks**:
  - use case updates are visible after refresh
  - context history is created under contextType `usecase`

### Scenario 9 — Use case web tools regression (existing feature)
- **Context**: use case detail view with at least 2 references URLs
- **Prompt**: “Résume les références et cite 2 points clés par URL”
- **Expected tools**:
  - `read_usecase` (to fetch `references`)
  - `web_extract` (single call with all URLs in the `urls` array)
- **Checks**:
  - only **one** `web_extract` call is made for multiple URLs
  - tool results are present and the final answer references extracted content

## Guardrails (MANDATORY)
- Any tool that can **delete**, **batch update**, or **create many objects**, or **trigger AI population** must be treated as **⚠ high-impact**:
  - require explicit user intent confirmation in the chat UX,
  - be logged with full parameters and result counts,
  - implement safe defaults (`dry_run=true` by default where possible),
  - and follow the project rule: never perform destructive actions without human approval.

## Open Questions (still need confirmation)
- What are the **exact tool IDs** you want? (English-only IDs recommended; UI labels remain FR via i18n.)
- For batch operations: do you want a universal `dry_run` + `confirm` pattern, or reuse an existing approval mechanism already in the codebase?
- For “populate with AI”: what is the minimum acceptable contract (inputs, expected outputs, limits, and cost safeguards)?

### Scenario 10 — Use case detail: read-only access to matrix + company (planned)
- **Context**: use case detail view (`/cas-usage/[id]`)
- **Prompt**: “Affiche la matrice du dossier (résumé: axes + poids)”
- **Expected tools** (planned):
  - a secure way to derive folderId from the use case context (no user-provided folderId)
  - then `matrix_get` (read-only)

- **Prompt**: “Affiche l’entreprise associée (name + industry + size)”
- **Expected tools** (planned):
  - derive folderId from use case context, read folder.companyId
  - then `company_get` (read-only) with select

## Plan / Todo
- [x] Inventory existing services/endpoints/queries for folders/use cases/executive summaries/companies (reuse first).
- [x] Align tool contracts with existing “use case” tool patterns (field selection + ids-only mode).
- [x] Implement tools per view contract (read/update subset first, then batch/delete/AI with guardrails).
- [x] Ensure authorization is consistent (session + workspace scope) and add context-id matching checks.
- [x] Add unit tests for new ToolService methods.
- [x] Run `make lint-api` and `make typecheck-api` (pre-UAT quality gate).
- [ ] UAT (manual) by Antoine before running tests.
- [ ] Run required test suite via Make after UAT: `make test-api [SCOPE=...]`.
- [ ] Push branch and verify GitHub Actions status for this branch.

## Atomic commit plan (file-level, no partial staging)
Rule: each commit includes whole files only (no hunk-level staging).

1. **feat(api): add chat tools definitions**
   - `api/src/services/tools.ts`

2. **feat(api): implement tool handlers (companies/folders/executive summary/usecases list)**
   - `api/src/services/tool-service.ts`

3. **feat(api): enable tools per context + security rules + web tools everywhere**
   - `api/src/services/chat-service.ts`

4. **test(api): add unit tests for new ToolService behaviors**
   - `api/tests/unit/tool-service-company-folder.test.ts`

5. **feat(ui): route context detection for chat (companies list, folders list, usecases list, dashboard, matrix)**
   - `ui/src/lib/components/ChatPanel.svelte`

6. **fix(ui): dashboard auto-refresh on tool-driven executive summary updates**
   - `ui/src/routes/dashboard/+page.svelte`

7. **docs: update BRANCH.md (status + UAT + commit plan)**
   - `BRANCH.md`

## Commits & Progress
- [x] **Commit 1**: docs: BRANCH.md (scope + plan + guardrails)
- [ ] **Commit 2**: feat(api): add new chat tools definitions (tools registry)
- [ ] **Commit 3**: feat(api): implement tool handlers in ToolService (companies/folders/executive summary/usecases list)
- [ ] **Commit 4**: feat(api): wire tools into ChatService (enable per context + dispatch + scope checks)
- [ ] **Commit 5**: test(api): add ToolService unit tests for company/folder/executive summary tools
- [ ] **Commit 6**: test(api): run `make test-api` (store result in PR / notes)
- [ ] **Commit 7**: refactor(api): naming migration to Option B for use case detail (`usecase_get` alias)

## Status
- **Progress**: Phase “read + update core tools” implemented; lint/typecheck pending; tests intentionally delayed for UAT
- **Current**: Pre-UAT quality gate (lint/typecheck), then wait for UAT feedback
- **Next**:
  - Run: `make lint-api` and `make typecheck-api`
  - Wait for UAT feedback (no `make test-*` before that)
  - After UAT: run `make test-api SCOPE=tests/unit/tool-service-company-folder.test.ts` then broader `make test-api`
  - Then decide next slice (batch/AI-populate) + guardrails
