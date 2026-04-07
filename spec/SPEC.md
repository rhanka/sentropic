# TECHNICAL SPECIFICATION - Top AI Ideas

## Table of Contents

- [0) Design Patterns & Component Lifecycle (directives)](#0-design-patterns--component-lifecycle-directives)
- [1) Functional map and screens](#1-functional-map-and-screens)
  - Workspace type system
  - Neutral workspace
  - Initiative model (universal business object)
  - Extended business objects (solutions, products, bids)
  - Screens (1-14)
- [2) Data model (PostgreSQL 17 + Drizzle + workspaces)](#2-data-model-postgresql-17--drizzle--workspaces)
  - 2.1) Score computation method
  - 2.2) Gate system
- [3) API backend (TypeScript) - Contracts](#3-api-backend-typescript--contracts)
  - Workspaces, folders, initiatives, extended objects, gate review, workflow registry, cross-workspace, analytics, settings, queue
- [4) LLM generation and multi-workflow runtime](#4-llm-generation-and-multi-workflow-runtime)
  - 4.1) Multi-workflow registry
  - 4.2) Agent/prompt architecture
  - 4.3) Prompt and endpoint mapping
  - 4.4) Workspace-type-aware chat tool scoping
- [5) SvelteKit UI (static build, i18n FR/EN)](#5-sveltekit-ui-static-build-i18n-fren)
- [6) DevOps & Tooling (Docker, Make, CI/CD)](#6-devops--tooling-docker-make-cicd)

---

## 0) Design Patterns & Component Lifecycle (directives)

### Core Patterns (API)
- **Routes -> Services -> Data access**: keep routing thin, business logic in services, and database access centralized.
- **Schema-first validation**: validate all inputs with Zod and keep API contracts in sync with OpenAPI.
- **Single source of truth**: server-side calculations remain authoritative (UI mirrors, never redefines).
- **Error contracts**: return structured errors with stable codes for UI handling.
- **Tenancy-first access**: all data access must be workspace-scoped and role-checked at the API boundary.
- **Idempotent mutations**: prefer idempotent updates for retriable actions (especially queue and async flows).

### Core Patterns (UI)
- **State in stores**: Svelte stores are the source of truth; components stay presentational.
- **Container vs presentational**: route pages orchestrate data; components render.
- **Deterministic UI**: avoid hidden side effects in components; keep side effects in stores/services.
- **I18n-first UI**: user-facing strings must be localized; keep technical identifiers in English.
- **Progressive disclosure**: advanced actions live behind menus, not in primary flows.

### Component Lifecycle (API/UI)
- When adding or changing a key component (API service, UI store, major component):
  - Update the relevant spec sections to reflect new behavior.
  - Update tests in the existing structure (`api/tests/**`, `ui/tests/**/*.ts`, `e2e/tests/**`).
  - Document tech debt and refactor needs in `.components/tech-debt-<service>.md`.
  - If a refactor plan is required, add a short "Refactor Plan" subsection in the most relevant spec.

### Upcoming Patterns (TODO-driven)
- **Print templates (docx)**: treat print/export as a template pipeline (data -> template -> render) with strict separation between data mapping and template layout.
- **Bilingual content**: design objects with a master language plus optional translations; avoid cross-language field drift.
- **Initiative ideation constraints**: extend initiative data with structured constraints; keep rendering and print layouts aligned.
- **Matrix generation per organization**: matrix templates are organization-owned with optional per-folder overrides.

## 1) Functional map and screens

Screens and responsibilities are implemented in Svelte with SvelteKit (file-based routing) and Svelte stores for shared state. The TypeScript REST API is the source of truth (no critical persistence in localStorage).

### Workspace type system

The platform supports multiple workspace types, each with its own domain personality:

| Type | Purpose | Default workflow family | Delegable | Auto-created |
|---|---|---|---|---|
| `neutral` | Orchestrator dashboard, cross-workspace tools, task dispatch | None (orchestrator only) | No (non-delegable) | Yes (one per user) |
| `ai-ideas` | AI use case ideation and qualification | `ai_usecase_generation` | Yes | No (user-created) |
| `opportunity` | Commercial opportunity management (demand, bid, contract, delivery) | `opportunity_identification` | Yes | No (user-created) |
| `code` | Developer/code project workspace (VSCode integration) | `code_analysis` | Yes | No (user-created) |

A workspace type is set at creation and cannot be changed (type immutability). The `neutral` workspace is auto-created per user on registration or first login (one per user, cannot be hidden or deleted). All other types are user-created via the workspace creation flow.

### Neutral workspace

The neutral workspace is the user's default landing. It aggregates activity across all owned/accessible workspaces and provides cross-workspace orchestration.

**Landing view**: card-based dashboard showing each owned workspace (name, type, last activity, active initiative count, pending gate reviews). Quick actions include creating a new workspace (type selector) and navigating to a workspace. A cross-workspace activity feed shows recent events (initiative created, gate passed, bid finalized, etc.).

**Cross-workspace tools** (available from neutral workspace chat):
- `workspace_list` — list owned + accessible workspaces with summary stats
- `workspace_create` — create a new typed workspace
- `initiative_search` — search initiatives across workspaces (by name, status, maturity stage)
- `task_dispatch` — create a todo in a target workspace on behalf of the user

**Todo automation**: the neutral workspace auto-creates todos from events in other workspaces (e.g., initiative reaches a gate, bid finalized, comment assigned). Mechanism: event listener on `execution_events` creating normal todos with `metadata.source` tracing the origin.

**Constraints**: non-delegable (no `workspace_memberships` for neutral workspaces), no initiatives directly in neutral workspace, no generation workflows attached.

### Initiative model (universal business object)

"Initiative" is the universal business object (renamed from "use case"). An initiative can be an AI use case idea (`ai-ideas`), a commercial opportunity (`opportunity`), or a code project (`code`). The workspace type determines the initiative's personality (relevant fields, workflows, gates).

**Maturity lifecycle** — initiatives follow a gate review model:

| Stage | Label | Meaning |
|---|---|---|
| `G0` | Idea | Raw idea/demand captured |
| `G2` | Qualified | Feasibility confirmed, scope defined |
| `G5` | Designed | Solution designed, ready for bid/build |
| `G7` | Delivered | Product delivered, in operation |

Gate transitions are governed by the workspace's `gate_config` (free / soft-gate / hard-gate). Gate criteria are evaluated via the `guardrails` table.

**Lineage**: `antecedent_id` creates a directed graph of initiative derivation (e.g., AI idea spawns an opportunity). Lineage is informational, not structural (no cascade delete).

**Template snapshot**: `template_snapshot_id` records which template version produced the initiative for traceability.

### Extended business objects

**Solution** — attached to an initiative (1:N). Represents a proposed technical/business solution. Lifecycle: `draft -> validated -> archived`. Versioned.

**Product** — attached to a solution (1:N) and to an initiative (direct FK). Lifecycle: `draft -> active -> delivered -> archived`. `solution_id` nullable (product may exist independently).

**Proposal / Contract** (DB table: `bids`, renamed to "proposal" at the domain/UI level in BR-04B) — attached to an initiative (1:N). Data-driven object (clauses, profiles, pricing). Lifecycle: `draft -> review -> finalized -> contract`. References N products via `bid_products` junction. A finalized proposal becomes a contract (same row, status = `contract`).

**Business chain** (opportunity workspace):
```
Initiative (demand/opportunity)
  -> Solution (proposed answer)
    -> Product (deliverables)
  -> Proposal (commercial proposal, references products; DB table: bids)
    -> Contract (finalized proposal)
      -> Delivery tracking (via product status)
```

**Portfolio view**: aggregate view across initiatives (no dedicated table). API query + UI dashboard: group by workspace/folder/maturity stage/status.

### Screens

1. Home `Index` (/)
   - CTA to start and redirect to `/home`.
   - No state; UI toasts only.

2. Generation `Home` (/home)
   - Fields: `currentInput` (free text), optional `organization` selection, `createNewFolder` option.
   - Actions: `generateUseCases(input, createNewFolder)` → optionally creates a folder + generates a list of use cases and their details via OpenAI.
   - Dependencies: `organizations`, `currentOrganizationId`, `folders`, `currentFolderId`, toasts.
   - Navigation: redirect to `/folders` on success.

3. Folders `Folders` (/folders)
   - Folder CRUD: `addFolder(name, description)`, `updateFolder`, `deleteFolder`, `setCurrentFolder`.
   - Shows number of use cases per folder, optional association to an `organizationId`.
   - Navigation: selecting a folder redirects to `/usecase`.

4. Use case list `UseCaseList` (/usecase)
   - Filter by `currentFolderId`.
   - Actions: view details, delete (dialog), future manual creation.
   - Shows value/complexity summary notes based on `matrixConfig`.

5. Use case detail `UseCaseDetail` (/usecase/:id)
   - Displays `UseCase` fields and allows editing: description, benefits, metrics, risks, nextSteps, sources, relatedData, process, technology, deadline, contact.
   - Evaluation tables by `valueScores` and `complexityScores` with recomputation of `totalValueScore`/`totalComplexityScore`.
   - Use case deletion.

6. Dashboard `Dashboard` (/dashboard)
   - Scatter visualization Value vs Ease of implementation (inverse of complexity), legend by `process`.
   - Counts/thresholds based on `matrixConfig` and cases in the `currentFolder`.

7. Matrix `Matrix` (/matrix)
   - Configure value/complexity axes (weights), thresholds (points, threshold, cases) and level descriptions (1..5).
   - Updates scores for use cases in the current folder.

8. Organizations `Organizations` (/organizations, /organizations/:id)
   - Organization CRUD, selection of a `currentOrganizationId`.
   - Used to contextualize generation prompts (OpenAI) and folder→organization association.

9. Settings `Settings` (/settings)
   - Stored via backend API: prompts, models (list/detail/folder/organization), advanced settings `maxRetries`, `parallelQueue`. `OPENAI_API_KEY` stays server-side (never client-side).

10. Authentication routes (`/auth/login`, `/auth/register`, `/auth/devices`, `/auth/magic-link/verify`)
    - Session bootstrap and account access flows.

11. 404 `NotFound`
    - Simple error page.

### Header (Main navigation)

- Intent: provide a coherent navigation bar, quick access to main views, auth status, FR/EN language selector.
- Items:
  - Home `/`
  - Folders `/folders`
  - Organizations `/organizations`
  - Use cases `/usecase`
  - Matrix `/matrix`
  - Dashboard `/dashboard`
  - Settings `/settings`
- Behavior:
  - Highlight active tab.
  - Right side: Login button (Google/LinkedIn) when logged out; avatar + menu (Logout) when logged in; FR/EN selector.
  - Responsive (vertical stack on mobile, horizontal on desktop).

### 1.1) Per-screen details: flows, API, and data

1) Home `Index` (/)
- Intent: minimal onboarding; introduces the tool and drives the user to generation.
- UI: Title + CTA "Start" → redirect to `/home`.
- API: no calls.
- State: none.

2) Generation `Home` (/home)
- Intent: business entry point to describe context and trigger a guided generation (folder + use cases) via **job queue**.
- UI:
  - Text area `currentInput` (required).
  - Organization selector (optional) backed by `/organizations`.
  - `createNewFolder` checkbox (default: true).
- Stores used: `organizationsStore`, `foldersStore` (read), `useCasesStore` (no direct writes here).
- API:
  - GET `/api/v1/organizations`
    - Response 200: `{ items: Organization[] }`
  - POST `/api/v1/use-cases/generate`
    - Request JSON: `{ input: string; folder_id?: string; organization_id?: string; matrix_mode?: "organization" | "generate" | "default"; use_case_count?: number; model?: string }`
    - Response 200: `{ success: true; status: "generating"; created_folder_id?: string; matrix_mode: "organization" | "generate" | "default"; jobId: string; matrixJobId?: string }`
    - Server effects: optional folder creation (`folders.status="generating"`), resolve effective `matrix_mode`, optionally enqueue `matrix_generate` in parallel, enqueue `usecase_list` (then `usecase_detail`), persistence, streaming via `chat_stream_events` + global SSE.
  - Errors: 400 if `input` is empty, 429/5xx for OpenAI/server; UI shows error toasts.
- State/UI:
  - Loading during generation; progress toasts.
  - Success → navigate to `/folders` (status/stream tracking), then access `/usecase` list.

3) Folders `Folders` (/folders)
- Intent: organize production by scope; associate a folder to an organization; manage the active folder.
- UI:
  - Folder list with: name, description, date, associated organization (if any), use case count.
  - Actions: Create, Edit, Delete, Select (sets active folder in store).
- Stores: `foldersStore` (list + currentFolderId), `organizationsStore` (for organization name), `useCasesStore` (count per folder on front-end or via optional count API).
- API:
  - GET `/api/v1/folders` → `{ items: Folder[] }`
  - POST `/api/v1/folders` body `{ name, description, organizationId? }` → `{ id, ... }`
  - PUT `/api/v1/folders/{id}` body `{ name?, description?, organizationId?, matrix_config? }` → `{ id, ... }`
  - DELETE `/api/v1/folders/{id}` → 204 (cascade `use_cases`)
  - Optional (count): GET `/api/v1/use-cases/count?folder_id=...` → `{ count: number }`
- State/UI: create/edit/delete modals; confirmations; toasts.

4) Use case list `UseCaseList` (/usecase)
- Intent: quickly view cases in the active folder, access details, basic sorting, prepare prioritization.
- UI:
  - Grid/list of cases filtered by active folder.
  - Actions: View detail, Delete, (future Manual creation).
- Stores: `useCasesStore` (list), `matrixStore` (thresholds for rating rendering), `foldersStore` (active folder).
- API:
  - GET `/api/v1/use-cases?folder_id={currentFolderId}` → `{ items: UseCase[] }`
  - DELETE `/api/v1/use-cases/{id}` → 204
 - State/UI: empty state if no active folder or list is empty; success/error toasts.

5) Use case detail `UseCaseDetail` (/usecase/:id)
- Intent: enable enriched editing and full qualification of a case with score traceability.
- UI:
  - Displays/edits: `name`, `description`, `benefits[]`, `metrics[]`, `risks[]`, `next_steps[]`, `sources[]`, `related_data[]`, `process`, `technology`, `deadline`, `contact`.
  - Rating tables: `value_scores[]`, `complexity_scores[]` with `rating` (1..5) and per-level `description`.
  - Shows `total_value_score`, `total_complexity_score` and aggregated levels as stars/crosses.
  - Actions: Save, Delete, Back to list.
- Stores: `useCasesStore` (read/write after PUT), `matrixStore` (axes/thresholds).
- API:
  - GET `/api/v1/use-cases/{id}` → `UseCase`
  - PUT `/api/v1/use-cases/{id}` body `Partial<UseCase>` → `UseCase`
    - Server: recalculates scores (2.1) based on the linked folder `matrix_config`; returns the final object.
  - DELETE `/api/v1/use-cases/{id}` → 204
 - State/UI: list fields handled via textarea (1 item per line); save/delete toasts.

6) Dashboard `Dashboard` (/dashboard)
- Intent: provide a portfolio view prioritized by value/ease with summary KPIs per folder.
- UI:
  - KPI cards: number of cases, average value, average complexity.
  - Scatter Value (%) vs Ease (% = 100−complexity_norm) colored by `process`.
- Stores: `foldersStore` (active folder), `matrixStore` (for bounds if needed).
- API (server-side aggregation):
  - GET `/api/v1/analytics/summary?folder_id=...`
    - Response: `{ total_use_cases: number; avg_value: number; avg_complexity: number }`
  - GET `/api/v1/analytics/scatter?folder_id=...`
    - Response: `{ items: { id: string; name: string; process: string; value_norm: number; ease: number; original_value: number; original_ease: number }[] }`
 - State/UI: loading; empty state when no cases.

7) Matrix `Matrix` (/matrix)
- Intent: govern the evaluation method (axes, weights, thresholds, descriptions) and recalculate case scores.
- UI:
  - Weight edit tables for value/complexity axes.
  - `thresholds` edit tables (points, threshold) for levels 1..5 (value and complexity).
  - Dialog to edit `level_descriptions` (per axis, 5 levels).
  - Action "Save configuration".
- Stores: `matrixStore`, `foldersStore` (active folder).
- API:
  - GET `/api/v1/folders/{id}/matrix` → `MatrixConfig`
  - PUT `/api/v1/folders/{id}/matrix` body `MatrixConfig` → `MatrixConfig`
- State/UI: editing and save flow on the active folder matrix; success/error toasts.

8) Organizations `Organizations` (/organizations, /organizations/:id)
- Intent: create/maintain rich organization profiles to contextualize generation and analysis.
- UI:
  - Organization list; detail with `name` + profile in `data` (`industry`, `size`, `products`, `processes`, `kpis`, `challenges`, `objectives`, `technologies`, `references`).
  - Actions: Create/Edit/Delete; set "active" in store if needed for `/home`.
  - Option: auto-fill via OpenAI on name input.
- Stores: `organizationsStore` (list + currentOrganizationId).
- API:
  - GET `/api/v1/organizations` → `{ items: Organization[] }`
  - POST `/api/v1/organizations` body `OrganizationInput` → `Organization`
  - GET `/api/v1/organizations/{id}` → `Organization`
  - PUT `/api/v1/organizations/{id}` body `Partial<Organization>` → `Organization`
  - DELETE `/api/v1/organizations/{id}` → 204
  - POST `/api/v1/organizations/{id}/enrich` body `{ model?: string }` → `{ success: true; status: "enriching"; jobId: string }`
  - POST `/api/v1/organizations/ai-enrich` body `{ name: string; model?: string }` → `OrganizationData` (sync enrichment, no persistence)
- State/UI: side sheet for create/edit; toasts.

9) Settings `Settings` (/settings)
- Intent: industrialize generation (prompts, models, limits), separate secrets and tuning server-side.
- UI:
  - Prompt editing: `useCaseListPrompt`, `useCaseDetailPrompt`, `folderNamePrompt`, `organizationInfoPrompt`.
  - Model selection: `listModel`, `detailModel`, `folderModel`, `organizationInfoModel`.
  - Limits: `maxRetries`, `parallelQueue`.
  - Actions: Save, Reset.
- Store: `settingsStore`.
- API:
  - GET `/api/v1/settings` → `Settings`
  - PUT `/api/v1/settings` body `SettingsInput` → `Settings`
 - State/UI: simple validation; toasts.

10) Business configuration (API-only in current UI)
- Intent: control sectors/processes references used by prompts and analysis.
- API:
  - GET `/api/v1/business-config` → `{ sectors: Sector[]; processes: Process[] }`
  - PUT `/api/v1/business-config` body `{ sectors: Sector[]; processes: Process[] }` → same object
- UI note: no dedicated route in current branch; managed through admin/API workflows.

11) 404 `NotFound`
- No calls; back link to `/`.

12) Collaboration — Comments (ChatWidget)
- Scope: comments are scoped to the **current object view** (contextType + contextId), not to the whole workspace.
- Menu: comment menu lists **all threads for the current object view** (no section filter in the menu).
- Threads: flat conversations by `thread_id` (no nested replies).
- Roles:
  - `viewer`: read-only, cannot comment.
  - `commenter`: can comment but cannot edit objects.
  - `editor`/`admin`: can edit objects and comment.
- Resolve flow:
  - Resolve/reopen is **thread-level** (`status=open|closed`).
  - Only the **thread creator** or **workspace admin** can resolve/reopen.
  - On resolve, selection moves to the next open thread (same section → next section → none).
- Resolved visibility:
  - Toggle in comment menu to show resolved items (strikethrough).
  - Resolved threads are **excluded** from badge counts.
  - Comment composer is disabled for resolved threads (distinct placeholder).
- Timestamps:
  - Display uses browser timezone from the ISO timestamp (backend sends timezone offset).
- AI traceability:
  - Comments created by the tool carry `tool_call_id`.
  - UI renders an AI badge on comments with `tool_call_id`.
- Comment resolution tool:
  - Proposes actions (close/reassign/note) and requires explicit confirmation before applying.
  - Context scoping follows existing tool expansion rules (usecase strict; folder/org expand).

12.1) Comment section-key conventions and route/context mapping
- Canonical section keys (no `data.*` prefixes) are used end-to-end for badge counts, auto-comments, and `topai:open-comments` routing.
- `usecase` canonical keys:
  - `name`, `description`, `problem`, `solution`, `benefits`, `constraints`, `metrics`, `risks`, `nextSteps`, `technologies`, `dataSources`, `dataObjects`, `valueScores`, `complexityScores`, `references`, `contact`, `domain`, `deadline`.
- `organization` canonical keys:
  - `name`, `industry`, `size`, `technologies`, `products`, `processes`, `kpis`, `challenges`, `objectives`, `references`.
- `folder` canonical keys:
  - `name`, `description`, `matrixConfig`, `matrixTemplate`.
- `executive_summary` canonical keys:
  - `introduction`, `analyse`, `recommandation`, `synthese_executive`, `references`.
  - Legacy aliases accepted for display compatibility: `analysis`, `recommendations`, `summary`.
- Route/context routing:
  - `/usecase/[id]` -> `contextType=usecase`, `contextId=<useCaseId>`.
  - `/organizations/[id]` -> `contextType=organization`, `contextId=<organizationId>`.
  - `/folders/[id]` -> `contextType=folder`, `contextId=<folderId>`.
  - `/matrix` -> `contextType=folder`, `contextId=<currentFolderId>`.
  - `/dashboard` -> default `contextType=executive_summary`, `contextId=<selectedFolderId>`; folder title badge uses `contextType=folder`, `sectionKey=name`.

13) Collaboration — Import/Export (permissions)
- Workspace export: **admin only**.
- Object export (folder/usecase/organization/matrix): **admin + editor**.
- Workspace import into a **new** workspace: any authenticated user (API creates workspace).
- Workspace import into the **current** workspace: **admin only**.
- Object import into current workspace: **admin + editor**.
- Commenter/viewer: cannot import/export.
- Endpoints:
  - `POST /api/v1/exports` (JSON body, ZIP response)
  - `POST /api/v1/imports/preview` (multipart form-data: `file`)
  - `POST /api/v1/imports` (multipart form-data: `file`, optional `target_workspace_id`)
- Export options:
  - `include[]` controls related data (folders/organizations/usecases/matrix).
  - `export_kind` identifies workspace list exports (organizations/folders) for filenames.
  - Filename pattern: `<scope>_<slug>_YYYYMMDD.zip`.
- Import options:
  - `selected_types` to import only selected object types.
  - `target_folder_id`, `target_folder_create`, `target_folder_source_id` for folder-scoped imports.
- Import UI:
  - Type-based selection (organizations/folders/usecases/matrix).
  - Target workspace selection with "create new workspace".
  - Folder target selection for folder-scoped imports (existing / create new / from imported metadata).

14) Chrome Extension plugin (overlay + side panel)
- Runtime contexts:
  - Overlay ChatWidget injected on external pages.
  - Chrome side panel ChatWidget (docked mode).
- Local tools (extension-only):
  - `tab_read` (`info|dom|screenshot|elements`)
  - `tab_action` (`scroll|click|type|wait`, supports multi-step chains)
- Chat flow integration:
  - UI sends `localToolDefinitions` in `POST /api/v1/chat/messages`.
  - Tool result returns through `POST /api/v1/chat/messages/:id/tool-results`.
  - Assistant generation resumes in the same stream.
- Permissions and safety:
  - Runtime decision gate (`allow_once`, `deny_once`, `allow_always`, `deny_always`) per tool+origin.
  - Persistent allow/deny policies synced with backend (`/api/v1/chat/tool-permissions`).
  - Content script injection excluded on Top AI Ideas app domains and localhost app pages.
- Plugin UX scope:
  - Plugin mode hides `Commentaires` tab for now.
  - New extension sessions use restricted toolset (web tools + local tab tools).

Key backend/API variables:
- Entity management: `Organization`, `Folder`, `Initiative` (renamed from `UseCase`), `MatrixConfig` (axes, weights, thresholds, descriptions), `BusinessConfig` (sectors, processes).
- Extended objects: `Solution`, `Product`, `Proposal` (DB: `Bid`), `BidProduct` (opportunity domain).
- Generation context: `currentOrganizationId`, folder→organization association, prompts/configs.
- Aggregations: counts by level, scoring, normalization for charts.

## 2) Data model (PostgreSQL 17 + Drizzle + workspaces)

Base: **PostgreSQL 17** (Docker volume `pg_data`). ORM: **Drizzle** (`api/src/db/schema.ts`). Migrations: `api/drizzle/`.

Principle: **workspace tenancy** (private-by-default):
- `workspaces` table
- All business objects are scoped by `workspace_id` (`organizations`, `folders`, `initiatives`, `solutions`, `products`, `bids`, `job_queue`, etc.)

Main tables (simplified):
- `workspaces`: `id`, `owner_user_id` (unique nullable), `name`, `type` (`neutral|ai-ideas|opportunity|code`, default `ai-ideas`), `gate_config` (JSONB, nullable), timestamps
- `users`: `id`, `email`, `display_name`, `role`, `account_status`, `approval_due_at`, `email_verified`, timestamps
- `organizations`: `id`, `workspace_id`, `name`, `status` (`draft|enriching|completed`), `data` (**JSONB**: contains `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.)
- `folders`: `id`, `workspace_id`, `name`, `organization_id?`, `matrix_config` (JSON text), `status` (`generating|completed`), `executive_summary` (JSON text)
- `initiatives` (renamed from `use_cases`): `id`, `workspace_id`, `folder_id`, `organization_id?`, `status` (`draft|generating|detailing|completed`), `model?`, `antecedent_id` (self-FK, lineage), `maturity_stage` (`G0|G2|G5|G7`, nullable), `gate_status` (`pending|approved|rejected`, nullable), `template_snapshot_id`, `data` (**JSONB**: contains `name`, `description`, `valueScores`, `complexityScores`, `references`, etc.)
- `solutions`: `id`, `workspace_id`, `initiative_id`, `status` (`draft|validated|archived`), `version`, `data` (JSONB), timestamps
- `products`: `id`, `workspace_id`, `initiative_id`, `solution_id` (nullable), `status` (`draft|active|delivered|archived`), `version`, `data` (JSONB), timestamps
- `bids` (domain name: "proposals", renamed in BR-04B): `id`, `workspace_id`, `initiative_id`, `status` (`draft|review|finalized|contract`), `version`, `data` (JSONB: clauses, profiles, pricing), timestamps
- `bid_products`: `id`, `bid_id`, `product_id`, `data` (JSONB: unit price, conditions), timestamps. Unique on `(bid_id, product_id)`
- `workspace_type_workflows`: `id`, `workspace_type`, `workflow_definition_id`, `is_default`, `trigger_stage`, `config` (JSONB), timestamps. Unique on `(workspace_type, workflow_definition_id)`
- `workflow_task_transitions` (BR-04B): `id`, `workspace_id`, `workflow_definition_id`, `from_task_key`, `to_task_key`, `transition_type` (`sequential|parallel|conditional|join`), `condition` (JSONB), `metadata` (JSONB), timestamps. Indexes on `(workflow_definition_id, from_task_key)`, `(workflow_definition_id, to_task_key)`
- `workflow_run_state` (BR-04B): `run_id` (PK), `workspace_id`, `workflow_definition_id`, `status` (`pending|running|completed|failed|cancelled`), `inputs` (JSONB), `state` (JSONB), `error` (text), timestamps. Indexes on `workspace_id`, `status`, `workflow_definition_id`
- `workflow_task_results` (BR-04B): composite PK `(run_id, task_key, task_instance_key)`, `workspace_id`, `workflow_definition_id`, `status` (`pending|running|completed|failed|skipped`), `inputs` (JSONB), `outputs` (JSONB), `error` (text), `started_at`, `completed_at`, timestamps. Indexes on `workspace_id`, `workflow_definition_id`, `status`
- `job_queue`: `id`, `workspace_id`, `type`, `status`, `data` (JSON string), `result?`, `error?`, timestamps

Auth & sessions:
- `user_sessions`: sessions (hash token + refresh, expiresAt, deviceName, ip/userAgent)
- `webauthn_credentials`: passkeys (credential_id, public_key, counter, uv, etc.)
- `webauthn_challenges`: challenges registration/auth
- `magic_links`: tokens magic link (hash + expiresAt)
- `email_verification_codes`: codes email (hash + verificationToken)

Streaming/chat:
- `chat_sessions` (includes `workspace_id` for standard scoping)
- `chat_messages`
- `chat_stream_events`
- `chat_generation_traces` (debug)
- `extension_tool_permissions` (allow/deny rules per `user_id` + `workspace_id` + `tool_name` + `origin`)

### 2.2) Gate system

Gate behavior is per workspace type (no folder-level override in v1).

`workspaces.gate_config` JSONB structure:
```json
{
  "mode": "free | soft | hard",
  "stages": ["G0", "G2", "G5", "G7"],
  "criteria": {
    "G2": { "required_fields": ["data.description", "data.domain"], "guardrail_categories": ["scope"] },
    "G5": { "required_fields": ["data.solution"], "guardrail_categories": ["scope", "quality"] },
    "G7": { "required_fields": [], "guardrail_categories": ["approval"] }
  }
}
```

**Gate evaluation** — on initiative `maturity_stage` change:
1. `free`: allow transition, no checks.
2. `soft`: evaluate criteria, warn if not met, allow anyway.
3. `hard`: evaluate criteria, block if not met.
4. Criteria: `required_fields` checks initiative `data` JSONB; `guardrail_categories` evaluates active guardrails.
5. Response: `{ gate_passed: boolean, warnings: [], blockers: [] }`.

**Default gate configs per workspace type**:
- `ai-ideas`: `{ "mode": "free", "stages": ["G0", "G2"] }` (lightweight, ideation-focused)
- `opportunity`: `{ "mode": "soft", "stages": ["G0", "G2", "G5", "G7"] }` (full lifecycle with soft gates)
- `code`: `{ "mode": "free", "stages": ["G0", "G2", "G5"] }` (dev lifecycle, free by default)
- `neutral`: no gate config (no initiatives)

### 2.1) Score computation method (server)

Definitions:
- Let `value_axes = [{ name, weight, level_descriptions? }]` and `complexity_axes = [...]`.
- Let `value_thresholds = [{ level ∈ {1..5}, points, threshold }, ...]` and `complexity_thresholds = [...]`.
- Each initiative has `value_scores = [{ axisId: name, rating ∈ {1..5}, description }]` and `complexity_scores = [...]`.

Axis point computation:
- For each value axis `a` with weight `w_a` and rating `r_a`, read `points(r_a)` from `value_thresholds` (the entry where `level = r_a`).
- Value axis contribution: `c_a = points(r_a) × w_a`.
- Total value: `total_value_score = Σ_a c_a`.

- For complexity, same: `d_c = points(r_c) × w_c` and `total_complexity_score = Σ_c d_c`.

Aggregated levels (1..5):
- Determine the aggregated level by finding the largest `level` such that `total_score ≥ threshold(level)` in the thresholds table.

Bounds and normalization (Dashboard):
- `max_possible_value = Σ_a points(level=5) × w_a`.
- `max_possible_complexity = Σ_c points(level=5) × w_c`.
- Value normalization: `value_norm = round(100 × total_value_score / max_possible_value)`.
- Complexity normalization: `complexity_norm = round(100 × total_complexity_score / max_possible_complexity)`.
- Ease of implementation: `ease = 100 − complexity_norm`.

API implementation notes:
- `total_*` columns are no longer stored in DB: aggregated scores are **computed dynamically** in API/UI from `matrix_config` + `use_cases.data.valueScores|complexityScores`.
- AI generation fills scores in `use_cases.data` (JSONB).

## 3) API backend (TypeScript) – Contracts

Base: `/api/v1` (Node + TypeScript; framework: **Hono**; ORM: **Drizzle**; DB: **PostgreSQL 17**; migrations Drizzle Kit)

Auth (passwordless):
- **UI login**: **WebAuthn** (passkeys) via `POST /api/v1/auth/login/options` then `POST /api/v1/auth/login/verify`.
- **Registration / device enrollment**: email proof via **6-digit code** to obtain a `verificationToken` (`/api/v1/auth/email/*`), then `POST /api/v1/auth/register/options|verify`.
- **Magic link (utility, not exposed on login screen)**: endpoints exist (`POST /api/v1/auth/magic-link/request|verify`) + page `/auth/magic-link/verify`, mainly for tests/E2E/ops (not a “product” login method).
- Server sessions (cookie `HttpOnly`, `Secure`, `SameSite=Lax`), sessions stored in PostgreSQL.
- RBAC with role hierarchy (admin_app > admin_org > editor > guest).
- Multi-device management with activation/revocation.
- Required variables: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`, `JWT_SECRET`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`, `ADMIN_EMAIL`.
- For full workflow details, see [WORKFLOW_AUTH.md](WORKFLOW_AUTH.md).

### 3.1) Architecture WebAuthn

WebAuthn authentication is implemented with the following components:

**Database schema:**
- `users`: users with email, role, and email verification status
- `webauthn_credentials`: WebAuthn credentials (devices) linked to users
- `webauthn_challenges`: temporary challenges for WebAuthn ceremonies (TTL)
- `user_sessions`: user sessions with JWT tokens
- `magic_links`: magic link tokens for activation/reset (TTL)

**Backend services:**
- `webauthn-registration.ts`: device enrollment management
- `webauthn-authentication.ts`: device authentication management
- `session-manager.ts`: JWT session management
- `challenge-manager.ts`: WebAuthn challenge management
- `email-verification.ts`: email verification with 6-digit code
- `magic-link.ts`: magic link generation and verification

**WebAuthn configuration:**
- Relying Party (RP) configured via environment variables
- Support for discoverable credentials (passkeys)
- User Verification (UV) required for admins, preferred for other roles
- Default attestation: `none` (configurable)

For more authentication workflow details, see [WORKFLOW_AUTH.md](WORKFLOW_AUTH.md).

### 3.2) Endpoints d'authentification (API v1)

**Email Verification:**
- POST `/api/v1/auth/email/verify-request` → request a 6-digit verification code (body: `{ email: string }`)
- POST `/api/v1/auth/email/verify-code` → verify the code and return a temporary validation token (body: `{ email: string, code: string }`)

**WebAuthn Registration:**
- POST `/api/v1/auth/register/options` → generate WebAuthn registration options (body: `{ email: string, verificationToken: string }`)
- POST `/api/v1/auth/register/verify` → verify enrollment response and create user + device (body: `{ email: string, verificationToken: string, userId: string, credential: RegistrationResponseJSON, deviceName?: string }`)

**WebAuthn Authentication:**
- POST `/api/v1/auth/login/options` → generate WebAuthn auth options (body: `{ email?: string }` - optional for passkeys)
- POST `/api/v1/auth/login/verify` → verify auth response and create a session (body: `{ credential: AuthenticationResponseJSON, deviceName?: string }`)

**Magic Link (Fallback):**
- POST `/api/v1/auth/magic-link/request` → generate and send a magic link (body: `{ email: string }`)
- POST `/api/v1/auth/magic-link/verify` → verify magic link and activate device (body: `{ token: string }`)
- GET `/api/v1/auth/magic-link/verify?token=xxx` → GET version for email redirects

**Session Management:**
- GET `/api/v1/auth/session` → get current session info
- POST `/api/v1/auth/session/refresh` → refresh session token (body: `{ refreshToken: string }`)
- DELETE `/api/v1/auth/session` → logout current session
- DELETE `/api/v1/auth/session/all` → logout all user sessions
- GET `/api/v1/auth/session/list` → list all user sessions

**Credential Management:**
- GET `/api/v1/auth/credentials` → list all registered devices
- PUT `/api/v1/auth/credentials/:id` → update device name (body: `{ deviceName: string }`)
- DELETE `/api/v1/auth/credentials/:id` → revoke a device (delete)

**Health Check:**
- GET `/api/v1/auth/health` → auth service health check

**Security:**
- Rate limiting on all auth endpoints
- CSRF protection via SameSite cookies
- Strict challenge validation (anti-replay)
- Credential counter verification (anti-cloning)
- JWT sessions with configurable expiration

Main endpoints (API v1):
- Health
  - GET `/api/v1/health` → health check

- Organizations
  - GET `/api/v1/organizations` → list
  - POST `/api/v1/organizations` → create (body = Organization sans id)
  - GET `/api/v1/organizations/{id}` → retrieve
  - PUT `/api/v1/organizations/{id}` → update
  - DELETE `/api/v1/organizations/{id}` → delete
  - POST `/api/v1/organizations/{id}/enrich` → async AI enrichment (queue)
  - POST `/api/v1/organizations/ai-enrich` → sync AI enrichment (no persistence)

- Workspaces (type system)
  - POST `/api/v1/workspaces` → create (includes `type` field, required for non-neutral)
  - GET `/api/v1/workspaces` → list (response includes `type`)
  - GET `/api/v1/workspaces/{id}` → retrieve (includes `type`, `gate_config`)

- Folders
  - GET `/api/v1/folders` → list (+ organization_id filter)
  - POST `/api/v1/folders` → create (name, description, organizationId?)
  - GET `/api/v1/folders/{id}` → retrieve (incl. `matrix_config`)
  - PUT `/api/v1/folders/{id}` → update (name, description, organizationId, matrix_config)
  - DELETE `/api/v1/folders/{id}` → delete (cascade initiatives)

- Initiatives (renamed from Use Cases)
  - GET `/api/v1/initiatives?folder_id=...` → list by folder
  - POST `/api/v1/initiatives` → create
  - GET `/api/v1/initiatives/{id}` → retrieve (includes `maturity_stage`, `gate_status`, `antecedent_id`)
  - PUT `/api/v1/initiatives/{id}` → update
  - PATCH `/api/v1/initiatives/{id}` → partial update (supports `maturity_stage` transition with gate evaluation)
  - DELETE `/api/v1/initiatives/{id}` → delete
  - POST `/api/v1/initiatives/generate` → start generation (job queue): body `{ input, folder_id?, organization_id?, orgIds?: string[], createNewOrgs?: boolean, matrix_mode?, use_case_count?, model? }` → returns `{ created_folder_id?, folder_id, matrix_mode, jobId, matrixJobId? }`. Multi-org support (BR-04B): `orgIds` selects multiple organizations, `createNewOrgs` triggers organization creation from LLM list output via workflow fanout/join.
  - Backward-compatible alias: `/api/v1/use-cases/*` forwards to `/api/v1/initiatives/*`

- Extended objects (solutions, products, proposals)
  - GET/POST `/api/v1/initiatives/{id}/solutions` → CRUD solutions for an initiative
  - GET/PUT/DELETE `/api/v1/solutions/{id}`
  - GET/POST `/api/v1/initiatives/{id}/products` → CRUD products
  - GET/POST `/api/v1/solutions/{id}/products` → CRUD products for a solution
  - GET/PUT/DELETE `/api/v1/products/{id}`
  - GET/POST `/api/v1/initiatives/{id}/bids` → CRUD proposals (DB: bids, domain name: proposals since BR-04B)
  - GET/PUT/DELETE `/api/v1/bids/{id}`
  - POST `/api/v1/bids/{id}/products` → attach products to proposal
  - DELETE `/api/v1/bids/{id}/products/{productId}` → detach product from proposal

- Gate review
  - POST `/api/v1/initiatives/{id}/gate-review` → evaluate gate criteria for maturity stage transition. Request: `{ target_stage: "G2" }`. Response: `{ gate_passed, warnings, blockers }`

- Workflow registry (per workspace type)
  - GET `/api/v1/workspace-types/{type}/workflows` → list registered workflows for a type
  - POST `/api/v1/workspace-types/{type}/workflows` → register a workflow for a type
  - DELETE `/api/v1/workspace-types/{type}/workflows/{id}` → unregister

- Cross-workspace (neutral)
  - GET `/api/v1/neutral/dashboard` → aggregated dashboard data across workspaces
  - POST `/api/v1/neutral/dispatch-todo` → create todo in target workspace

- DOCX publishing
  - POST `/api/v1/docx/generate` → enqueue DOCX generation job (`docx_generate`)
  - GET `/api/v1/docx/jobs/{id}/download` → download rendered binary when job is completed
  - GET `/api/v1/initiatives/{id}/docx` → `410 Gone` (legacy synchronous route disabled)

- Analytics
  - GET `/api/v1/analytics/summary?folder_id=...` → summary stats
  - GET `/api/v1/analytics/scatter?folder_id=...` → scatter plot data

- Settings/Prompts
  - GET `/api/v1/settings` → single config (or multi-profile if needed)
  - PUT `/api/v1/settings` → update `prompts`, `openai_models`, `generation_limits`
  - GET `/api/v1/prompts` → list default prompts
  - PUT `/api/v1/prompts` → update prompts

- AI Settings
  - GET `/api/v1/ai-settings` → AI settings
  - PUT `/api/v1/ai-settings` → update AI settings

- Business Config
  - GET `/api/v1/business-config`
  - PUT `/api/v1/business-config`

- Queue Management
  - GET `/api/v1/queue/jobs` → list jobs
  - GET `/api/v1/queue/jobs/{id}` → job status
  - POST `/api/v1/queue/jobs/{id}/cancel` → cancel a job
  - POST `/api/v1/queue/jobs/{id}/retry` → retry a job
  - DELETE `/api/v1/queue/jobs/{id}` → delete a job
  - POST `/api/v1/queue/purge` → purge the queue

- Admin
  - GET `/api/v1/admin/status` → system status

Schemas (Zod/TypeBox) aligned with front-end types, `camelCase` in JSON, `snake_case` in DB.

Computation rules:
- Scores are recalculated server-side per 2.1.
- Aggregation endpoints for the dashboard return `value_norm`, `ease`, and max bounds directly.

## 4) LLM generation and multi-workflow runtime

Dedicated TypeScript services:
- `api/src/services/queue-manager.ts` → **PostgreSQL** queue manager (table `job_queue`) for async jobs. Uses `agentMap: Record<string, string>` (task key to agent definition ID) for generic agent resolution.
- `api/src/services/context-organization.ts` → AI organization enrichment
- `api/src/services/context-initiative.ts` → AI initiative generation (renamed from `context-usecase.ts`)
- `api/src/services/todo-orchestration.ts` → generic workflow dispatch (`startWorkflow(workspaceId, workflowKey)`)
- `api/src/services/docx-generation.ts` → freeform DOCX generation (VM sandbox) + `docx-freeform-helpers.ts` (BR-04B)
- `api/src/services/settings.ts` → settings and configuration management
- `api/src/services/tools.ts` → chat tool definitions and dispatch

AI generation functions:
- `generateFolderNameAndDescription(input, model, organization?)`
- `generateInitiativeList(input, model, organization?)` (renamed from `generateUseCaseList`)
- `generateInitiativeDetail(title, input, matrix_config, model, organization?)` → returns strict JSON; API validates (Zod), computes scores, and persists.

Parameters: prompts, models, limits (retries/parallelism) stored in DB (`/settings`). `OPENAI_API_KEY` server-side only. Concurrency controlled (p-limit) + exponential retries.

### 4.1) Multi-workflow registry

`workspace_type_workflows` maps workspace types to available workflows. Each workspace type has 0..N registered workflows, one marked `is_default`. `trigger_stage` optionally binds a workflow to a maturity gate.

**Open task-key mapping**: `workflow_definition_tasks.task_key` is a free `text` field. Agent resolution: task key -> lookup `agentDefinitionId` on the `workflow_definition_tasks` row. Type safety via Zod validation of workflow structure.

**Generic dispatch**: `startWorkflow(workspaceId, workflowKey)` resolves the workflow from `workspace_type_workflows` -> `workflow_definitions` -> ordered `workflow_definition_tasks`, then dispatches generically. The `GenerationWorkflowRuntimeContext` carries `agentMap: Record<string, string>` (task key to agent definition ID).

**Generic executable workflow runtime (BR-04B)**: The workflow runtime is transition-driven. Task sequencing is defined by `workflow_task_transitions` (not hardcoded `switch` statements or string heuristics). Key components:
- `workflow_task_transitions`: stores `fromTaskKey`, `toTaskKey`, `transitionType` (sequential, parallel, conditional, join), `condition` (JSONB), `metadata` (JSONB).
- `workflow_run_state`: persists the current state of a workflow run (inputs, materialized state, status).
- `workflow_task_results`: persists task outputs per run (inputs, outputs, status, timing).
- The runtime uses a generic executor registry (`executor` / `jobType` / `subworkflowKey` -> implementation). No workflow-specific sequencing hardcoding remains.
- Ready entry nodes are dispatched generically (replaces `switch (task.agentRole)` routing).
- Next-node resolution is transition-driven (replaces `includes("detail")` / `includes("summary")` heuristics).
- Transition + binding driven scheduling replaces workflow-specific matrix waiting / unlock logic.
- Legacy parity: for pre-existing non-multi-org paths, the runtime preserves `main` entry/output semantics and queue-visible work topology.
- See `SPEC_WORKFLOW_RUNTIME.md` for the full runtime specification.

**Seed workflows per type**:

| Workspace type | Default workflow key | Seed tasks |
|---|---|---|
| `ai-ideas` | `ai_usecase_generation` | context_prepare, matrix_prepare, usecase_list, todo_sync, usecase_detail, executive_summary |
| `opportunity` | `opportunity_identification` | context_prepare, matrix_prepare, opportunity_list, todo_sync, opportunity_detail, executive_summary |
| `opportunity` | `opportunity_qualification` | context_prepare, demand_analysis, solution_draft, bid_preparation, gate_review |
| `code` | `code_analysis` | context_prepare, codebase_scan, issue_triage, implementation_plan |

### 4.2) Agent/prompt architecture

Each agent definition carries its prompt in `config.promptTemplate`. No `promptId` pointing to legacy prompt files. Agents are seeded code-based (`sourceLevel: "code"`):

- `default-chat-system.ts` — chat system prompt per workspace type + common chat prompts (reasoning eval, session title)
- `default-agents-ai-ideas.ts` — AI-specific agents with prompts
- `default-agents-opportunity.ts` — opportunity-specific agents with neutral prompts
- `default-agents-code.ts` — code-specific agents with prompts
- `default-agents-shared.ts` — agents available on all workspace types (demand_analyst, solution_architect, bid_writer, gate_reviewer, comment_assistant, history_analyzer, document_summarizer, document_analyzer)

### 4.3) Prompt and endpoint mapping

- `/api/v1/initiatives/generate`:
  - If `folder_id` is not provided: creates a folder `folders.status="generating"` (name/description may be generated via prompt)
  - Resolve `matrix_mode` (`organization` | `generate` | `default`) from payload + organization context
  - If `matrix_mode=generate` and organization is selected: enqueue `matrix_generate` in parallel with `initiative_list`
  - Enqueue `initiative_list` job, then `initiative_detail` jobs
  - Persistence in `initiatives.data` (JSONB) + stream events in `chat_stream_events`
- `/api/v1/organizations/{id}/enrich`: enqueue `organization_enrich` job
- `/api/v1/organizations/ai-enrich`: sync enrichment (returns data, no persistence)

### 4.4) Workspace-type-aware chat tool scoping

Tool availability is a function of `(workspace_type, context_type, role)`:

1. **Base tools** (always available): `web_search`, `web_extract`, `documents`, `history_analyze`
2. **Context-type tools**: `organizations_list`, `folders_list`, `initiatives_list`
3. **Workspace-type tools**:
   - `ai-ideas`: `read_initiative`, `update_initiative_field`, `comment_assistant`, `solutions_list`, `solution_get`, `proposals_list`, `proposal_get`, `products_list`, `product_get`, `gate_review`, `document_generate`, `batch_create_organizations`
   - `opportunity`: same tools as `ai-ideas` (unified in BR-04B): `solutions_list`, `solution_get`, `proposals_list`, `proposal_get`, `products_list`, `product_get`, `gate_review`, `document_generate`, `batch_create_organizations`
   - `code`: `read_initiative`, `update_initiative_field` + code-specific tools
   - `neutral`: cross-workspace tools only (`dispatch_todo`, `workspaces_list`, `initiative_search_cross_workspace`)

Implementation: `workspace_type` parameter added to `buildChatGenerationContext()` tool resolution. Tool definitions in `tools.ts`, selection is workspace-type-aware. Client-side `chat-tool-scope.ts` includes workspace-type filtering.

## 5) SvelteKit UI (static build, i18n FR/EN)

Routing (adapter-static):
- `/` → Index (redirects to neutral workspace landing)
- `/home` → Home (generation)
- `/folder/new` → Folder creation
- `/folders` → Folders
- `/folders/[id]` → Folder detail
- `/initiative` → InitiativeList (renamed from `/usecase`)
- `/initiative/[id]` → InitiativeDetail (renamed from `/usecase/[id]`)
- `/initiative/[id]/gate` → Gate review page
- `/dashboard` → Dashboard
- `/matrix` → Matrix
- `/organizations` (+ `/organizations/new`, `/organizations/[id]`) → Organizations
- `/settings` → Settings
- `/neutral` → Neutral workspace landing (card-based workspace dashboard)
- `/auth/login`, `/auth/register`, `/auth/devices`, `/auth/magic-link/verify` → Authentication
- `+error.svelte` → NotFound

State management:
- Stores Svelte: `organizationsStore`, `foldersStore`, `initiativesStore` (renamed from `useCasesStore`), `matrixStore`, `settingsStore`.
 - Stores sync via the backend API; no critical local persistence. Caches may exist in `sessionStorage` if needed for UX.

Key components:
- Editors (textarea/input) for all `InitiativeDetail` fields with optimistic updates and save on PUT.
- `RatingsTable` tables for value/complexity axes; direct store binding + recompute (server-side API or client-side display only).
- `Matrix` page: weight/threshold forms, dialog to edit level descriptions.
- `Dashboard`: charts (Recharts -> Svelte alternatives: `layercake`, `apexcharts` svelte, or `recharts` via wrapper if needed); backend can provide pre-normalized data.
- `TemplateRenderer.svelte` — JSON-driven generic view template renderer (BR-04B). Reads view template descriptors (tabs, rows, grids, field types) and renders layouts with `FieldCard`, `ScoreTable`, `EditableInput`, `entity-loop`, `printOnly`, component slots, and path-based keys. Supports `pageBreak*` attributes for print layout control. Adds CSS class `template-{objectType}` on root div for scoped print CSS. See `SPEC_EVOL_PRINT_LAYOUT.md` for print contract.
- `FieldCard.svelte` — extracted from InitiativeDetail card pattern (BR-04B). Supports 3 variants: `colored`, `plain`, `bordered`.
- `ScoreTable.svelte` — extracted from score axes rendering (BR-04B).
- `ConfigItemCard.svelte` — shared config UX component for agents, workflows, view templates settings (BR-04B). See `SPEC_EVOL_CONFIG_UX_ALIGNMENT.md`.
- `ContainerView.svelte` — container view sub-component (workspace->folders, folder->initiatives, neutral->workspaces).
- `GateReview.svelte` — gate criteria evaluation view with pass/fail indicators.

## 6) DevOps & Tooling (Docker, Make, CI/CD)

Repo structure (implemented):
- `/ui` (SvelteKit 5) → static UI
- `/api` (Hono + TypeScript) → REST API with Drizzle ORM
- `/e2e` (Playwright) → end-to-end tests
- `Makefile` at root with targets: `make build`, `make test`, `make lint`, `make up`, `make down`, `make db-*`.
- `docker-compose.yml` local dev: services `ui`, `api`, `postgres` (+ `maildev` in test/e2e).
- Separate `Dockerfile`s for `ui/` and `api/` (prod-ready, multi-stage build).
- **To implement**: `.github/workflows/ci.yml` + `deploy.yml` for CI/CD.
- Deployment (to implement):
  - UI: SvelteKit static build.
  - API: build image → push Scaleway Container Registry → deploy Container PaaS (managed PostgreSQL DB or dedicated service).

Variables/Secrets CI:
- `OPENAI_API_KEY` (secret)
- `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_ORGANIZATION_ID`, `SCW_DEFAULT_PROJECT_ID`, `SCW_NAMESPACE_ID` (secrets)
 - `DOC_STORAGE_BUCKET`, `DOC_STORAGE_ENDPOINT`, `DOC_STORAGE_REGION`, `DOC_STORAGE_ACCESS_KEY`, `DOC_STORAGE_SECRET_KEY` (secrets)
