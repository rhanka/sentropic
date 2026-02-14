# Spec: Organization-Aware Matrix Generation (Lot 2.2)

## Goal
When generating use cases from `Folder New`, matrix behavior must be organization-aware and deterministic:
- Reuse an existing organization matrix by default when available.
- Generate a new organization matrix by default when none exists.
- Run matrix generation in parallel with `usecase_list`.
- Block generation in strict mode if matrix generation fails (no fallback to default matrix).

## Existing Generation Patterns (Baseline Analysis)

This lot must follow the same implementation pattern as existing generation flows.

### Current pattern used in the codebase

1) API trigger route validates payload and enqueues a background job:
- Use cases generation trigger: `api/src/routes/api/use-cases.ts` (`POST /api/v1/use-cases/generate`)
- Organization enrich trigger: `api/src/routes/api/organizations.ts` (`POST /api/v1/organizations/:id/enrich`)

2) Queue worker resolves default model from AI settings:
- `settingsService.getAISettings()` in `api/src/services/queue-manager.ts`
- If no model provided by caller, worker uses `defaultModel`.

3) Worker builds contextual input and calls a context service:
- Use cases list/detail: `api/src/services/context-usecase.ts`
- Organization enrich: `api/src/services/context-organization.ts`
- Executive summary: `api/src/services/executive-summary.ts`
- Documents summary: `api/src/services/context-document.ts`

4) Context service resolves prompt from `defaultPrompts` and calls OpenAI wrapper:
- Prompt source: `api/src/config/default-prompts.ts` via `defaultPrompts.find(...)`
- Execution wrapper: `executeWithToolsStream(...)`
- Prompt tracking: explicit `promptId` is passed
- Streaming: explicit `streamId` is passed
- Structured output is used where deterministic JSON is required (notably use-case list/detail).

5) Worker persists result in DB and emits events:
- Domain rows updated (`folders`, `use_cases`, `organizations`, etc.)
- SSE notifications via `notify*Event(...)`.

### Important note on prompt source of truth

For these generation flows, the effective prompt source is currently `defaultPrompts` in code.
`/api/v1/prompts` is not yet wired as runtime source for generation services in this branch.
Therefore, Lot 2.2 must use `defaultPrompts` as canonical prompt source to remain consistent with existing generation behavior.

## Lot 2.2 Pattern Parity Requirements

The matrix generation implementation must mirror the pattern above:

1) API route (`/use-cases/generate`) remains entry point and decides matrix mode.
2) Queue adds/handles a dedicated `matrix_generate` job type.
3) Worker resolves model through `settingsService.getAISettings()` (same defaulting logic).
4) Matrix context service resolves prompt from `defaultPrompts` and uses `executeWithToolsStream`.
5) `promptId` and `streamId` are always provided for observability and consistency.
6) Deterministic JSON contract via structured output for generated level descriptions.
7) Persist generated organization template and folder effective matrix, then notify events.

## Scope
- UI flow: `ui/src/routes/folder/new/+page.svelte`
- API trigger: `POST /api/v1/use-cases/generate`
- Queue orchestration: `api/src/services/queue-manager.ts`
- Prompt/service for matrix generation: new context service + new default prompt
- Data persistence: organization template + folder effective matrix

## Functional Requirements

### 1) Folder generation options (organization selected)
- If selected organization has a matrix template:
  - Show one checkbox option: `Use organization matrix`.
  - Checked by default.
  - User can uncheck it.
- If selected organization has no matrix template:
  - Show one checkbox option: `Generate organization matrix`.
  - Checked by default.
- If no organization is selected:
  - Keep current behavior (folder matrix defaults to `defaultMatrixConfig`).

### 2) Matrix generation constraints
- Keep matrix structure unchanged:
  - Same axis IDs, same axis names, same weights, same thresholds.
  - Only adapt `levelDescriptions` text.
- Value axes to adapt:
  - `business_value`
  - `time_criticality`
  - `risk_reduction_opportunity`
- Complexity axes to adapt:
  - `implementation_effort`
  - `data_compliance`
  - `data_availability`
  - `change_management`
- Keep `ai_maturity` unchanged.
- Adaptation context must use organization specifics:
  - challenges
  - KPIs
  - products/services
  - technologies
  - strategic objectives

### 3) Queue orchestration and parallelism
- For `POST /use-cases/generate` with organization + matrix generation mode:
  - enqueue `matrix_generate` job
  - enqueue `usecase_list` job
  - both start in parallel (same global queue scheduler)
- `usecase_detail` must consume the folder matrix actually selected/generated:
  - if generated mode: wait until matrix is ready before detail generation starts
  - if reuse mode: use existing organization matrix copied to folder

### 4) Strict failure policy
- If `matrix_generate` fails:
  - folder generation flow is blocked for this run
  - no fallback to `defaultMatrixConfig`
  - failure is visible in jobs as with other generation failures
  - restart is done through the existing failed-jobs retry/restart mechanism

## Data Model Contract

### Organization
- Persist reusable organization matrix template in:
  - `organizations.data.matrixTemplate` (JSON object matching `MatrixConfig`)
- Optional metadata:
  - `organizations.data.matrixTemplateMeta`
    - `generatedAt`
    - `model`
    - `promptId`
    - `version`

### Folder
- Persist effective matrix in:
  - `folders.matrixConfig` (already used by scoring and detail generation)

## API Contract Changes

### `POST /api/v1/use-cases/generate`
Add optional request field:
- `matrix_mode`: `'organization' | 'generate' | 'default'`

Server behavior:
- If omitted, server computes default:
  - organization selected + matrix template exists -> `organization`
  - organization selected + no matrix template -> `generate`
  - no organization -> current default behavior
- If no organization is selected:
  - effective mode is `default` (including when caller sends `matrix_mode='generate'` in current implementation).

Validation:
- Reject `matrix_mode='organization'` when no organization is selected.
- Reject `matrix_mode='organization'` when selected organization has no matrix template.

## Prompt/Service Design

### New default prompt
- Prompt ID: `organization_matrix_template`
- Input variables:
  - `organization_name`
  - `organization_info`
  - `base_matrix` (serialized `defaultMatrixConfig`)
- Output: JSON object containing only overridden `levelDescriptions` per targeted axis.

### New service
- `api/src/services/context-matrix.ts`
- Follow the same architecture pattern as other generation services:
  - `executeWithToolsStream`
  - structured output
  - normalization/validation

## Non-Goals
- No axis/weight/threshold redesign.
- No bilingual data model changes in this lot.
- No executive DOCX changes in this lot.

## UAT Checklist (Lot 2.2)
- Org with template:
  - `Use organization matrix` is visible and checked by default.
  - Unchecked behavior works and does not silently reuse template.
- Org without template:
  - `Generate organization matrix` is visible and checked by default.
  - Generation creates and persists org matrix template.
- Parallelism:
  - `matrix_generate` and `usecase_list` jobs are both created and processed.
- Detail dependency:
  - `usecase_detail` uses the effective folder matrix from selected mode.
- Strict failure:
  - Fail `matrix_generate` and verify generation is blocked with no fallback matrix.
