# Feature: T5a CM providers, code only

## Objective
App bascule en mode cluster-mesh asap, code only, flag-gated, preprod-safe.

## Scope / Guardrails
- Scope limited to CMP-L1, CMP-L3, CMP-P1, CMP-E1, type registry CODE move.
- No state move, no data migration, no drizzle migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/llm-gateway/**`
  - `api/src/services/llm-runtime/gateway-*.ts`
  - `api/src/services/llm-runtime/internal-gateway.ts`
  - `api/src/routes/namespaces/gw.ts`
  - `api/src/services/email/**`
  - `api/src/services/notifications/ops-mail.ts`
  - `api/src/services/scw-tem-client.ts`
  - `api/src/services/prompts/**`
  - `api/src/services/object-registry/**`
  - `packages/cluster-mesh/src/prompts/**`
  - `packages/cluster-mesh/src/messaging/email-port.ts`
  - `packages/cluster-mesh/src/messaging/index.ts`
  - `packages/cluster-mesh/src/storage/object-type-registry.ts`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `api/tests/**/gateway-cm-providers*.spec.ts`
  - `api/tests/**/prompt-registry*.spec.ts`
  - `api/tests/**/email-port*.spec.ts`
  - `api/tests/**/object-type-registry*.spec.ts`
  - `packages/cluster-mesh/tests/**/*.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/package.json`
  - `api/package.json`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] T5a-EX1 pending if package.json export edit needed: reason additive export, impact none, rollback revert line

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
- Rationale: One PR for several wagons, train integration merges once, single CI.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- [ ] **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-sentropic`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Create/confirm isolated worktree `tmp/worktrees/t5a-providers` and run development there.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
  - [x] ENV=test-t5a API_PORT=8951 UI_PORT=5351 MAILDEV_UI_PORT=1251
  - [x] Branch feat/t5a-cm-providers from origin/main VERIFIED 7a352bb4d
- [ ] **Lot 1 — CMP-L1 wiring pool/authResolver/dispatch GD-14**
  - [ ] Add flag-gated cm-app-workload module, no default behavior change
  - [ ] Wire gw.ts optionally, refused by default preserved
  - [ ] Scoped tests gateway-cm-providers, typecheck
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>`>
    - [ ] **API tests**
      - [ ] `api/tests/api/llm/gateway-cm-providers.spec.ts` new
      - [ ] Scoped runs while evolving tests: `make test-api-<suite> SCOPE=tests/your-file.spec.ts ENV=test-<branch-slug>`
      - [ ] Sub-lot gate: `make test-api ENV=test-<branch-slug>`
      - [ ] AI flaky tests run (non-blocking only under acceptance rule): `make test-api-ai ENV=test-<branch-slug>` and document status/signature in `BRANCH.md`
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change, skip with reason recorded
      - [ ] Sub-lot gate: `make test-ui ENV=test`
    - [ ] **E2E tests**
      - [ ] No E2E change, CI covers
- [ ] **Lot 2 — CMP-L3 internal calls in-process gateway**
  - [ ] Add internal-gateway wrapper flag-gated, default delegates to callLLM
  - [ ] Scoped tests, typecheck
- [ ] **Lot 3 — CMP-P1 prompt registry GD-7**
  - [ ] Add packages/cluster-mesh/src/prompts registry pure + api adapter settings-backed
  - [ ] Scoped tests, typecheck
- [ ] **Lot 4 — CMP-E1 email port**
  - [ ] Add messaging/email-port + api adapter allowlist/rate/audit
  - [ ] Scoped tests, typecheck
- [ ] **Lot 5 — CODE move type registry**
  - [ ] Move validation/interface to packages/cluster-mesh/src/storage, api re-exports
  - [ ] Scoped tests, typecheck
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
