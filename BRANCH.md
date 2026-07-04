# Feature: chat-ui gold shell extraction (headless-first, Lot A1 of gold-parity program)

## Objective
Extract the sentropic gold chat panel composition (`ui/src/lib/components/chat/AppChatPanel.svelte`, 3931 lines app-local injected via `renderShell`) into `@sentropic/chat-ui` as a turnkey, headless-first shell: framework-neutral controller + thin Svelte view, so sentropic renders pixel-identical through the module and React/Angular/Vue views can later mount the same controller.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**` and the sentropic consumption seam under `ui/src/lib/components/chat/**` + `ui/src/lib/components/ChatPanel.svelte`.
- No migration.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/chatui-goldshell`.
- Automated test campaigns run on `ENV=test-goldshell` (API_PORT=9520 UI_PORT=5620 MAILDEV_UI_PORT=1520), never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Pixel-parity is the acceptance bar: sentropic rendering through the extracted shell must match the QA'd gold reference screenshots (chat-parity program artifact).
- Headless-first: all orchestration state lives in a framework-neutral controller module (no Svelte imports); the Svelte component only renders.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/**`
  - `ui/src/lib/components/chat/**`
  - `ui/src/lib/components/ChatPanel.svelte`
  - `ui/src/lib/components/ChatWidget.svelte`
  - `ui/tests/**`
  - `BRANCH.md`
  - `spec/BRANCH_SPEC_EVOL.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
  - `e2e/**` (only if a parity spec is added)
- **Exception process**:
  - Declare exception ID `BRGS-EXn` in `## Feedback Loop` before touching any conditional/forbidden path, with reason, impact, rollback.

## Feedback Loop
- (none yet)

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- Known baseline: `chat-loop-controller.spec.ts` 11l/11m/11o rotating fake-timer flake (FRZ-FLAKY-1, non-systematic, pre-existing).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, slice-by-slice commits, one final test cycle)
- [ ] **Multi-branch**
- Rationale: single-package extraction with one consumer seam; slices are sequential (controller → view → adoption), no independent CI streams needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT on this branch after the adoption lot (visual parity check by owner on root `ENV=dev` after push).
- Execution flow: develop/test in `tmp/chatui-goldshell`; push before UAT; owner UAT from root workspace; switch back.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create isolated worktree `tmp/chatui-goldshell` (base `origin/main` dbfe919d5).
  - [x] Define environment mapping: ENV=test-goldshell, API_PORT=9520, UI_PORT=5620, MAILDEV_UI_PORT=1520.
  - [x] Confirm scope and guardrails (above).
  - [x] Cartography: inventory AppChatPanel concerns → controller boundary doc (`spec/BRANCH_SPEC_EVOL.md`).

- [ ] **Lot 1 — Headless shell state (chat-ui/state)**
  - [x] S1a: sessions bar (label/menu/new/delete + inline delete-confirm) extracted into `chatWidgetShell.ts` (existing headless home) + 7 unit tests.
  - [x] S1b: session hydration helpers extracted into `chatSessionHydration.ts` (NDJSON splitter/parser, hydration generations, flush predicate, message normalize/ordered-upsert) + 9 unit tests.
  - [x] S2: resolveHydratedModelSelection extracted into `utils/model-selection.ts` (dedup of 2 app copies; dead catalog id never re-selected) + 4 tests.
  - [x] S3: composer steer derivation (isAssistantMessageInProgress + resolveComposerSteerState) extracted into `chatDraft.ts` + 5 tests (attachments/primary-action already module).
  - [x] S4: timeline ordering (compare/merge block into history) + scroll-restore resolver extracted into `chatSessionHydration.ts` + 4 tests.
  - [ ] Lot gate: `make typecheck-chat-ui` + `make test-chat-ui` green.

- [ ] **Lot 2 — ChatPanelShell.svelte view (gold markup)**
  - [x] S5a1: ChatPanelShell scaffold + comments region (CommentsPanel forwarding, snippet props host-injected).
  - [x] S5a2a: timeline region ported (5 snippets + hydration measure + loading/empty/timeline render) + theme css regenerated (drift guard).
  - [x] S5a2b: banners/confirm region ported (local-tool permission prompts, checkpoint confirm, error banner).
  - [ ] S5a2c: composer region + gold <style>.
  - [ ] Move the gold markup/composition from AppChatPanel into `packages/chat-ui/src/components/ChatPanelShell.svelte`, rendering from the controller; host-specific concerns stay injected via existing adapter ports.
  - [ ] Density: carry the sentropic "petit" sizing as it is today (preset formalization deferred to Lot A2).
  - [ ] Lot gate: typecheck + test-chat-ui green.

- [ ] **Lot 3 — Sentropic adoption (no visual change)**
  - [ ] `AppChatPanel.svelte` becomes a thin host wrapper: adapters + app stores wired into `ChatPanelShell`.
  - [ ] Full `make test-ui` (vitest) green; boundary tests evolved in same commits if extraction breaks source-grep tests.
  - [ ] Parity proof: re-capture gold screens (É1/É2/É3-4) on the branch stack and diff vs the QA'd reference; record evidence.
  - [ ] Lot gate: typecheck-ui + lint-ui + test-ui + test-chat-ui green; parity evidence attached.

- [ ] **Lot 4 — Merge & publish**
  - [ ] Push, PR, CI green (rerun infra flakes only; never merge red).
  - [ ] Owner UAT sign-off on root `ENV=dev`.
  - [ ] Merge; confirm `@sentropic/chat-ui` minor publish on npm latest.
