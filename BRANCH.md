# Feature: Tolerant `updates` normalization for chat field-update tools (BUG-ORG)

## Objective
Fix the chat field-update tools so a field update actually applies when small/nano models emit `updates` as an object `{field:value}` (and/or a sibling `patch` object) instead of the advertised array `[{field,value}]`, which today throws "updates is required" and never applies.

## Scope / Guardrails
- Scope limited to `api/` tool-update executors + their dispatch arg forwarding + api unit tests.
- No migration.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chat-freeze-fix`.
- Automated test campaigns on `ENV=test-freeze`, never on root `dev`.
- In every `make` command, `ENV=<env>` last argument; ports `API_PORT=9470 UI_PORT=5570 MAILDEV_UI_PORT=1470`, `REGISTRY=local`.
- All new text in English.
- Do NOT touch freeze/streaming code (separate parallel effort).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/tests/unit/tool-service.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - chat-core / chat-ui streaming + freeze code
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/src/services/tool-service.ts`
  - `api/src/services/skills/foundation-executor.ts`
- **Exception process**:
  - `BRxx-EXn` declared in `## Feedback Loop` before touching conditional paths.

## Feedback Loop
- BR-freeze-EX1 (`acknowledge`): Touch `api/src/services/tool-service.ts` and `api/src/services/skills/foundation-executor.ts` (`api/**` conditional path).
  - Reason: tolerant tool input — coerce model-emitted `updates` object / `patch` object into the canonical `[{field,value}]` array so nano-model field updates apply. The dispatch helper `optionalUpdates` currently collapses any non-array `updates` to `[]` and drops `patch`, so the object form must be forwarded raw to the executor where a shared normalizer runs before the "updates is required" guard.
  - Impact: additive tolerance only; array form, the "updates is required" guard, and the field-enum/"Unsupported field" validation all stay intact. No legacy path removed.
  - Rollback: revert the two source files; tests revert with their commit.

## AI Flaky tests
- None expected (deterministic unit tests, no model calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single orthogonal bugfix in one api service + its tests.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read evidence (`.tmp/uat-analysis/freeze-orgupdate-state.md`, executors, dispatch).
  - [x] Confirm worktree `tmp/chat-freeze-fix` on `fix/chat-freeze-org-update`.
  - [x] Env mapping: `ENV=test-freeze`, ports 9470/5570/1470, `REGISTRY=local`.
  - [x] Declare scope exception `BR-freeze-EX1`.

- [x] **Lot 1 — Tolerant normalization (TDD)**
  - [x] Add failing api unit tests (object form, patch form, array form, empty {} error, unknown field rejected) for organization + mirror for folder/executive_summary/initiative.
  - [x] Run tests RED (capture failing-before proof).
  - [x] Add shared `normalizeFieldUpdates` helper in `tool-service.ts`; reuse in all 4 executors before the guard.
  - [x] Forward raw `updates` + `patch` from `foundation-executor.ts` dispatch (stop collapsing non-array to `[]`).
  - [x] Run tests GREEN.
  - [x] Lot gate:
    - [x] `make typecheck-api ... ENV=test-freeze`
    - [x] `make lint-api ... ENV=test-freeze`
    - [x] **API tests**
      - [x] `make test-api-unit SCOPE=tests/unit/tool-service.test.ts API_TEST_WORKERS=1 ... ENV=test-freeze`

- [x] **Lot N — Cleanup**
  - [x] `make down ... ENV=test-freeze`
