# Feature: llm-mesh Claude seat runner

## Objective
Ship a concrete Node ClaudeCodeCliRunner in @sentropic/llm-mesh so a Claude seat authenticates a claude CLI child and serves the anthropic provider.

## Scope / Guardrails
- Scope limited to packages/llm-mesh (src/node runner, transport quota mapping, catalog opus-5-5, tests, version, CHANGELOG).
- One migration max in `api/drizzle/*.sql` (not applicable, no migration).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/llm-mesh-claude-seat`.
- Automated test campaigns run on dedicated environments (`ENV=test-llm-mesh-claude-seat`), never on root `dev`.
- UAT qualification branch/worktree is commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/node/claude-code-cli-runner.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/transport/claude-code-runtime-client.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/routing-targets.ts`
  - `packages/llm-mesh/tests/node/claude-code-cli-runner.test.ts`
  - `packages/llm-mesh/tests/transport/claude-code-runtime-client.test.ts`
  - `packages/llm-mesh/tests/routing-targets.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- No exceptions declared.

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
- Rationale: single package, one lane, one test cycle.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT checkpoints.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, .tmp/packets/COMMON-RULES.md, .tmp/rv/llm-mesh-accounts-plan.md.
  - [x] Create isolated worktree tmp/worktrees/llm-mesh-claude-seat on feat/llm-mesh-claude-seat-runner from origin/main (ec3c0bcc8).
  - [x] Verify branch: feat/llm-mesh-claude-seat-runner.
  - [x] Environment mapping: ENV=test-llm-mesh-claude-seat, API_PORT=8919, UI_PORT=5319, MAILDEV_UI_PORT=1219.
  - [x] Confirm command style: docker-slot.sh make ... ENV=<env> with ENV last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries, no BRxx-EXn needed.
- [ ] **Lot 1 — Node ClaudeCodeCliRunner + quota mapping + factory**
  - [ ] New src/node/claude-code-cli-runner.ts: spawn claude CLI headless (-p, stream-json, --effort, --system-prompt-file or stdin, model id), CLAUDE_CODE_OAUTH_TOKEN in child env only, normalize CLI output to ClaudeCodeCliEvent, quota/rate-limit to typed rate_limited failure, timeouts, abort.
  - [ ] Runtime client: pass typed quota failures through with numeric fields only (secret boundary intact).
  - [ ] Factory createClaudeSeatAnthropicClient for clients.anthropic; export runner + factory from ./node subpath.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat`
    - [ ] Scoped runs: `make test-llm-mesh SCOPE=tests/node/claude-code-cli-runner.test.ts ENV=test-llm-mesh-claude-seat`
    - [ ] Scoped runs: `make test-llm-mesh SCOPE=tests/transport/claude-code-runtime-client.test.ts ENV=test-llm-mesh-claude-seat`
- [ ] **Lot 2 — Catalog claude-opus-5-5 + seat import proof**
  - [ ] Add claude-opus-5-5 via make llm-mesh-add-model MODEL=claude-opus-5-5 BASE=claude-opus-5 (verify scaffold, remove scaffold comments).
  - [ ] Test: faithful claude-code target first for claude-opus-5-5; test: claude seat bundle import path (parseCliSeatProfile + importSeatBundle).
  - [ ] Lot gate:
    - [ ] Scoped runs: routing-targets + seat import tests ENV=test-llm-mesh-claude-seat
- [ ] **Lot 3 — Version, changelog, lockfiles, full gates**
  - [ ] Bump packages/llm-mesh/package.json 0.33.0 -> 0.33.1 (npm latest is 0.33.0), CHANGELOG entry, lockfiles via make.
  - [ ] Full `make test-llm-mesh ENV=test-llm-mesh-claude-seat`, typecheck, lint.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest llm-mesh suite (cf Lot1, copy checklist)
  - [ ] Bumped packages/llm-mesh/package.json version (semver) — enforced by CI enforce-package-bump.
  - [ ] Final gate step 1: create PR using BRANCH.md text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: push only (no merge, conductor merges).
