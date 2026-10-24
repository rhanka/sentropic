# Feature: Run AI CI jobs on mistral-small-2603 (nano retired)

## Objective
Switch every CI/test path defaulting to retired gpt-4.1-nano to mistral-small-2603. Unblock immo #861 CI.

## Scope / Guardrails
- Scope limited to CI/test model selection and CI key wiring.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/ci-mistral-small`.
- Automated test campaigns must run on dedicated environments (`ENV=test-ci-mistral-small`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Never print secrets; reference MISTRAL_API_KEY by name only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/tests/**`
  - `e2e/tests/**`
  - `api/tests/utils/seed-test-data.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/src/config/env.ts` (production default)
  - `api/src/services/model-catalog.ts` (production fallback)
  - `api/src/services/settings.ts` (settings defaults)
  - PR #686
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `e2e/helpers/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- BR-CL1-EX1 (declared, untriggered): `.github/workflows/ci.yml` env only, if code-level TEST_MODEL default does not propagate to all CI AI suites. Reason: CI must inject MISTRAL_API_KEY where jobs need it. Impact: CI-only env wiring. Rollback: revert the workflow hunk. Status: untriggered — OPENAI/GEMINI/ANTHROPIC/MISTRAL/COHERE/TAVILY keys are already wired into `test-api-unit-integration` and `test-e2e` job env.
- Track-linked note (item 01M5PCVH1Y8ZAVM7T94SRAWVR5): CI AI jobs run on mistral-small-2603 until seats are available; revert/review then. Production default model unchanged (refs listed in PR body). No mock anywhere: real Mistral calls. `.track/` import left to the designated writer.

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
- Rationale: single focused CI switch, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch. No UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create isolated worktree `tmp/worktrees/ci-mistral-small` on `fix/ci-mistral-small` from `origin/main`.
  - [x] Confirm command style: `make ... ENV=test-ci-mistral-small` with `ENV` last.
  - [x] Validate scope boundaries and declare BR-CL1-EX1.
- [x] **Lot 1 — Switch CI/test model selection to mistral-small-2603**
  - [x] Survey nano refs: CI/test vs production default; mistral-small-2603 catalog presence; MISTRAL_API_KEY CI wiring.
  - [x] Edit test default funnel (`TEST_MODEL`), seed labels, explicit `model:` payloads, e2e specs.
  - [x] Track-linked note on Track item 01M5PCVH1Y8ZAVM7T94SRAWVR5 (revert/review when seats available).
  - [ ] Lot gate (runs in PR CI: no local keys/images on this host):
    - [ ] `typecheck-lint-api` CI job green
    - [ ] `test-api-unit-integration (ai x3)` + `(queue)` shards green
    - [ ] `test-e2e` groups a/c/d green (group-b + 08 summaries blocked: production FORCED_DOCUMENT_MODEL, see PR)
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API AI suite
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Do not merge: s-conductor asks the owner for the GO.
