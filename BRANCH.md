# Feature: Stabilize Chat Replay E2E

## Objective
Stabilize the main CI blocker in chat replay E2E by validating persisted assistant content and absence of legacy stream-event browser calls without requiring provider-native reasoning deltas from a non-reasoning CI model.

## Scope / Guardrails
- [x] Scope limited to `e2e/tests/03-chat.spec.ts` and `BRANCH.md`.
- [x] Make-only workflow for build/test/commit commands.
- [x] Worktree development only in `tmp/fix-chat-reasoning-replay-e2e`.
- [x] Tests use `ENV=e2e-chat-replay`, never `ENV=dev`.
- [x] In every `make` command, `ENV=e2e-chat-replay` is passed as the last argument.
- [x] All new code comments, test names, and branch text are in English.

## Branch Scope Boundaries
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `e2e/tests/03-chat.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
- **Conditional Paths**:
  - none
- **Exception process**:
  - none

## Environment
- [x] Worktree: `tmp/fix-chat-reasoning-replay-e2e`
- [x] Branch: `fix/chat-reasoning-replay-e2e`
- [x] Env: `e2e-chat-replay`
- [x] Ports: API `9211`, UI `5411`, Maildev `1311`

## Plan
- [x] Lot 0: Recover CI failure signature and branch context
- [x] Lot 1: Replace flaky runtime reasoning header assertion with replayed assistant content assertion
- [x] Lot 2: Run targeted E2E validation attempts
- [ ] Lot 3: Commit and publish the fix
- [ ] Lot 4: Verify PR CI group `03`

## Validation
- [x] RED baseline from main CI run `26725239363`: `e2e/tests/03-chat.spec.ts` failed waiting for `Reasoning` UI while the assistant response completed.
- [x] `make test-e2e E2E_SPEC=tests/03-chat.spec.ts:227 API_PORT=9211 UI_PORT=5411 MAILDEV_UI_PORT=1311 ENV=e2e-chat-replay` reached and passed the replay scenario once during iteration.
- [x] Later local targeted runs exposed unrelated local Vite hydration blanks on `/folders` before the replay assertion; PR CI remains the required gate for this branch.

## Acceptance
- [ ] The test still verifies reload and new-tab history replay
- [ ] The test still verifies no browser request to legacy stream-events endpoints
- [ ] Branch has a focused commit ready for PR
- [ ] PR CI group `03` passes
