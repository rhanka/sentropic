# Feature: Chat live terminal projection backstop (fix server-completed UI freeze)

## Objective
Fix the chat UI freeze where a server-completed run leaves the timeline stuck ("Préparation…"/"response_created"/mid-token) because the LIVE projection derived `isTerminal` only from `_localStatus`/`content`, never from a `done`/`error` event in the projected stream.

## Scope / Guardrails
- Scope limited to `packages/chat-ui` (LIVE projection terminal derivation + regression test + version bump).
- No migration.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chat-freeze-bisect`.
- Automated test campaigns run on `ENV=test-bisect` (API_PORT=9475 UI_PORT=5575 MAILDEV_UI_PORT=1475), never on root `dev`.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/state/chatProjection.ts`
  - `packages/chat-ui/src/state/chatLoopController.ts`
  - `packages/chat-ui/src/utils/chat-run-projection.ts`
  - `packages/chat-ui/tests/**`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `FRZ-FLAKY-1` / Branch `fix/chat-live-terminal-projection` / Owner agent / Severity low / Status `flaky accepted` (pending user sign-off)
  - Repro: `make test-chat-ui SCOPE=tests/chat-loop-controller.spec.ts REGISTRY=local API_PORT=9475 UI_PORT=5575 MAILDEV_UI_PORT=1475 ENV=test-bisect`
  - Expected: 753 passed
  - Actual: non-systematic 1 failure in `chat-loop-controller.spec.ts > local-tool state machine (slice 1E)` (tests `11l`/`11m` "tool in-flight" fake-timer), signature `Error: Aborting after running 10000 timers, assuming an infinite loop! (chatLoopController.ts ltScheduleBufferedLocalToolExecution setTimeout)`
  - Evidence: same failure reproduced on CLEAN base (HEAD `011ad69f3`, changes stashed) on test `11m`; passed 2 of 3 isolated runs with this branch's changes (RUN1=753 pass, RUN2=1 fail `11m`, RUN3=753 pass). Pre-existing fake-timer nondeterminism in code NOT touched by this branch (projection only). New projection tests pass 100% of runs.

## AI Flaky tests
- `FRZ-FLAKY-1` recorded above — non-systematic, at least one success on same commit + command, unrelated to branch scope (local-tool timer machine), no timeout amendment. User sign-off required before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal fix; single final test cycle)
- [ ] **Multi-branch**
- Rationale: One self-contained chat-ui projection bugfix; no independent sub-workstreams.

## UAT Management (in orchestration context)
- Mono-branch: UAT on the integrated branch from root workspace (`ENV=dev`) after push.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read diagnosis `.tmp/uat-analysis/freeze-orgupdate-state.md` and relevant rules.
  - [x] Confirm isolated worktree `tmp/chat-freeze-bisect` on branch `fix/chat-live-terminal-projection` (HEAD `011ad69f3`).
  - [x] Capture make targets: `test-chat-ui`, `typecheck-chat-ui`, `typecheck-ui`, `commit`, `down`.
  - [x] Env mapping: `ENV=test-bisect`, API_PORT=9475 UI_PORT=5575 MAILDEV_UI_PORT=1475, REGISTRY=local.
  - [x] Confirm command style: `make ... <vars> ENV=test-bisect` with `ENV` last.
  - [x] Confirm scope and guardrails (chat-ui only).
  - [x] Validate scope boundaries; no `BRxx-EXn` exception needed.

- [x] **Lot 1 — Live terminal projection backstop**
  - [x] TDD: add freeze regression tests in `packages/chat-ui/tests/chat-projection.test.ts` (done→completed terminal w/o `_localStatus`/content; error→failed terminal; mid-stream CONTROL stays non-terminal; explicit `_localStatus` still wins). Confirmed RED first (6 fail).
  - [x] FIX: add `getProjectedRunTerminalOutcome` to `utils/chat-run-projection.ts` (mirror chat-core `history.ts` getTerminalOutcome, mapped to `completed`/`failed`/null).
  - [x] FIX: add `terminalOutcome` to `ChatProjectionComputation` and OR it into `isTerminal` in `state/chatProjection.ts` (additive backstop; `_localStatus`/content logic preserved; `failed` now terminal; `isActiveRuntimeSegment` consistent since it derives from `isTerminal`).
  - [x] FIX: populate `terminalOutcome` in `getProjectedAssistantComputation` (`state/chatLoopController.ts`) + cache it.
  - [x] Add `getProjectedRunTerminalOutcome` to `export-manifest.json` (both subpaths).
  - [x] Bump `packages/chat-ui/package.json` 0.19.1 → 0.19.2 + `export-manifest.json` `_version` + 3 version-assertion specs.
  - [x] Lot gate:
    - [x] `make typecheck-chat-ui ... ENV=test-bisect` (0 errors)
    - [x] **UI tests (TypeScript only)**
      - [x] `make test-chat-ui SCOPE=tests/chat-projection.test.ts ... ENV=test-bisect` (green after fix)
      - [x] Sub-lot gate: `make test-chat-ui ... ENV=test-bisect` (752 pass + new tests; only flake `FRZ-FLAKY-1`)
    - [x] `make typecheck-ui ... ENV=test-bisect` (0 errors, 6 pre-existing warnings in unrelated `.svelte`)

- [ ] **Lot N — Final validation**
  - [x] Typecheck (chat-ui + ui)
  - [x] Retest UI (full `test-chat-ui`; flake documented in `## Feedback Loop`)
  - [x] Bumped `packages/chat-ui/package.json` version (patch 0.19.2)
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` as body (NOT done — do not push per mission).
  - [ ] Final gate step 2: branch CI green.
  - [ ] Final gate step 3: UAT + CI green → remove `BRANCH.md` → push → merge.
