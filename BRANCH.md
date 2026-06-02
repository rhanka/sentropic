# Feature: chat-ui app retrofit — ModelSelector (P1) + MessageActions (P2)

## Objective
Retrofit `AppChatPanel.svelte` to consume `@sentropic/chat-ui`'s `ModelSelector` (P1) and `MessageActions` (P2), deleting the now-duplicated inline copies, zero dual-path. Preserve 1:1 UX. Wire the app's existing `chat.*` / `common.*` i18n labels via the label resolver prop. Add two missing i18n keys (`chat.message.edit`, `chat.model.selector.label`) to both locales.

## Scope / Guardrails
- Scope limited to `ui/src/lib/components/chat/AppChatPanel.svelte` + `ui/src/locales/en.json` + `ui/src/locales/fr.json` + `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) — must remain stable.
- No make build/test/dev/compose run (orchestrator runs Tier-1 gate after PR).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/chat/AppChatPanel.svelte`
  - `ui/src/locales/en.json`
  - `ui/src/locales/fr.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.github/**`
  - Anything outside `ui/src/lib/components/chat/AppChatPanel.svelte` and the two locale files (except `BRANCH.md`)
- **Conditional Paths**: none required
- **Exception process**: none needed

## Feedback Loop
- (none)

## AI Flaky tests
- N/A (no AI tests in this branch)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single-file app retrofit; single test cycle by orchestrator)
- Rationale: single orthogonal task; no service stack needed; Tier-1 gate runs externally.

## UAT Management (in orchestration context)
- Mono-branch: UAT performed by orchestrator after PR via Tier-1 gate (build + chat e2e + visual).

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules files (workflow, MASTER, subagents, components, design-system).
  - [x] Confirm worktree on `feat/chatui-app-retrofit` (off `origin/main` b117de6c).
  - [x] Re-derive exact line ranges for ModelSelector (P1) and MessageActions (P2) inline code.
  - [x] Inspect lib component APIs: `ModelSelector.svelte`, `MessageActions.svelte`, `model-selection.ts`, `message-actions.ts`.
  - [x] Confirm i18n keys needed: `chat.message.edit` (missing), `chat.model.selector.label` (missing).
  - [x] Confirm excluded: `startEditComment`/`editingCommentId` (comment-owned), checkpoint/restore, P3/ContextProvider.
  - [x] Confirm icons no longer needed after replacement: `ThumbsUp`, `ThumbsDown`, `RotateCcw`.

- [x] **Lot 1 — P1: ModelSelector retrofit**
  - [x] Add imports: `ModelSelector` from `@sentropic/chat-ui/components/ModelSelector.svelte`; `groupModelsByProvider`, `computeModelSelectorWidthCh`, `coerceSelectionToValidEntry`, types from `@sentropic/chat-ui/utils/model-selection`.
  - [x] Remove local type declarations for `ModelProviderId`, `ModelCatalogProvider`, `ModelCatalogModel`, `ModelCatalogGroup` (now imported from lib).
  - [x] Remove `parseModelSelectionKey`, `handleModelSelectionChange`, `providerGroupLabel`, `fallbackSelectedModelOption`, `getSelectedModelLabel`, `getLongestVisibleModelLabelLength` functions.
  - [x] Replace `$: modelCatalogGroups = modelCatalogProviders.map(...).filter(...)` with `groupModelsByProvider(...)`.
  - [x] Replace inline coercion reactive block with `coerceSelectionToValidEntry(...)`.
  - [x] Replace `$: selectedModelWidthCh = Math.max(getLongestVisibleModelLabelLength() + 4, 18)` with `computeModelSelectorWidthCh(...)`.
  - [x] Replace `<select id="chat-model-selection">` markup with `<ModelSelector bind:value ... onChange ... labels={$_} />`.
  - [x] Add `chat.model.selector.label` to `ui/src/locales/en.json` and `fr.json`.

- [x] **Lot 2 — P2: MessageActions retrofit**
  - [x] Add import: `MessageActions` from `@sentropic/chat-ui/components/MessageActions.svelte`.
  - [x] Remove `ThumbsUp`, `ThumbsDown`, `RotateCcw` from lucide imports (no longer used after replacement; `Check`, `Copy`, `Pencil` kept for comment copy/edit).
  - [x] Remove `{@const isUp = ...}` / `{@const isDown = ...}` from assistant snippet (no longer used).
  - [x] Replace user action row copy+edit buttons with `<MessageActions role="user" isCopied onCopy onEdit labels={$_} />` inside the existing outer flex div (checkpoint button kept).
  - [x] Replace assistant action row copy+retry+feedback buttons div with `<MessageActions role="assistant" streamStatus isLastAssistantSegment isCopied feedbackVote onCopy onRegenerate onFeedback labels={$_} />`.
  - [x] Keep all handler implementations: `startEditMessage`, `cancelEditMessage`, `saveEditMessage`, `retryMessage`, `retryFromAssistant`, `markCopied`, `isCopied`, `setFeedback` (unchanged).
  - [x] Add `chat.message.edit` to `ui/src/locales/en.json` and `fr.json`.

- [ ] **Lot N — Final validation**
  - [ ] PR opened (NOT merged), title prefixed `[Tier-1 — orchestrator runs build+e2e+visual gate before merge]`.
  - [ ] Orchestrator runs Tier-1 gate: build-ui-image + chat e2e + visual.
  - [ ] Once UAT + CI green: commit removal of `BRANCH.md`, push, merge.
