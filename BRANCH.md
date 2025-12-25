# Feature: Chat Tools — Folders / Use Cases / Executive Summary / Companies (Core Read/Update)

## Objective
Add chat tool-calls so the assistant can operate from key UI views with **core read/update tools**:
- Companies: list/read/update (single-entity update).
- Folders: list/read/update (single-entity update).
- Folder-scoped use cases list: read (ids-only or selected fields).
- Executive summary: read/update.
- Matrix: read/update.
- Web tools (`web_search`, `web_extract`) available in all views.

**Important**: this feature expands beyond “read-only”. Any destructive or high-impact action must follow project guardrails (⚠ human approval on dangerous actions).

## Scope
- API-only unless UI changes are strictly required to display tool calls (prefer none).
- Minimal changes: tool registry + tool handlers + authorization + tests.
- No broad refactors, no unrelated schema changes.

## Views → Tools availability (contract)
- **Companies list view (`/entreprises`)**:
  - List companies (read-only).
- **Company detail view (`/entreprises/[id]`)**:
  - Read/update the current company.
- **Folders list view (`/dossiers`)**:
  - List folders (read-only).
  - Read a folder’s use cases / executive summary / matrix by providing `folderId`.
- **Use case list view (`/cas-usage`)**:
  - Folder-scoped via `currentFolderId` (chat context = `folder`).
  - Read folder, list use cases, read/update executive summary, read/update matrix, read company linked to folder.
- **Use case detail view (`/cas-usage/[id]`)**:
  - Read/update the current use case (existing tools).
- **Executive summary view**:
  - Folder-scoped (read/update executive summary; can list use cases; can read matrix).
- **Dashboard view (`/dashboard`)**:
  - Folder-scoped when a folder is selected in the dashboard.
  - Must have access to folder + executive summary tools (read/update), use cases list (read), and web tools.
- **Matrix view (`/matrice`)**:
  - Folder-scoped when a folder is selected.
  - Must have access to: folder, company (read-only), use cases list (read), matrix (read/update), and web tools.

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
  - Update: migrate `update_usecase_field` → `usecase_update` (alias strategy).
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
  - [x] `matrix_get`
  - [x] `matrix_update`
  - [ ] (Planned) `usecase_get` (alias of `read_usecase`, for Option B consistency)
  - [ ] (Planned) `usecase_update` (alias of `update_usecase_field`, for Option B consistency)

#### Tool handlers (`api/src/services/tool-service.ts`)
- [x] Companies:
  - [x] `listCompanies` (supports `idsOnly` + `select`)
  - [x] `getCompany` (supports `select`)
  - [x] `updateCompanyFields` (writes `chat_contexts` + `context_modification_history` when session info provided; NOTIFY `company_events`)
- [x] Folders:
  - [x] `listFolders` (supports `companyId` filter, `idsOnly` + `select`; parses `matrixConfig` and `executiveSummary`)
  - [x] `getFolder` (supports `select`; parses `matrixConfig` and `executiveSummary`)
  - [x] `updateFolderFields` (writes audit/history; NOTIFY `folder_events`)
- [x] Matrix (folder.matrixConfig):
  - [x] `getMatrix`
  - [x] `updateMatrix`
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
  - [ ] (Planned) Update `usecase` system prompt to prefer `usecase_get` / `usecase_update` naming (keep old names as aliases during migration)

#### Tests
- [x] Added unit tests for the new ToolService handlers:
  - [x] `api/tests/unit/tool-service-company-folder.test.ts`
  - Covers: list/get/update company (history + chat context), list usecases for folder (select), get/update executive summary (history)

### Remaining (kept in this branch scope)
- [ ] Naming migration work (Option B):
  - [ ] Add `usecase_get` (alias of `read_usecase`)
  - [ ] Add `usecase_update` (alias of `update_usecase_field`)
  - [ ] Update prompts/docs/tests to prefer `usecase_get` / `usecase_update`
  - [ ] Deprecate/remove old names after UAT + CI green

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
  - `matrix_get`, `matrix_update`
  - Security checks (context id mismatch) + read-only blocking for update tools
- **Also re-validates (already existing feature, still active)**:
  - `read_usecase` + `update_usecase_field` + web tools in usecase context (regression guard)
- **Does NOT cover (moved to spec/TOOLS.md)**:
  - batch/high-impact tools and AI-populate tools
  - the Option B naming migration work (`usecase_get` / `usecase_update`)

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

### Scenario 4bis — Folder context: read + update matrix ✅
- **Context**: `/cas-usage` (use case list) with a selected folder OR `/dossiers/[id]`
- **Prompt**: “Affiche la matrice (axes + weights)”
- **Expected tools**: `matrix_get`
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
- Naming migration (`usecase_get` / `usecase_update`) timing: do we introduce aliases now or after UAT?

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

## Status
- **Progress**: Core tools implemented; lint/typecheck completed; tests intentionally delayed for UAT
- **Current**: UAT by Antoine (no `make test-*` before that)
- **Next**:
  - Wait for UAT feedback
  - After UAT: run `make test-api SCOPE=tests/unit/tool-service-company-folder.test.ts` then broader `make test-api`
  - Then implement naming migration (`usecase_get` / `usecase_update`)
