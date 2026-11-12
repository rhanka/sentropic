# Feature: Sandbox Node Step 1 — contract freeze (ExecutionNodeV1 + tenant model)

## Objective
Freeze the ExecutionNodeV1 contract and the two-tenant model (sentropic + immo) on the BHS b3-16 host so S1-A1a/S1-K1/S1-B1 can build against a stable surface.

## Scope / Guardrails
- Scope limited to the contract freeze: spec text + one amendable contract module.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sandbox-node` (verified: branch `feat/sandbox-node-step1` at `origin/main` `5be8e34f3` before any edit).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `packages/contracts/**` (ExecutionNodeV1 types only: `src/execution-node-v1.ts` + its re-export in `src/index.ts`)
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None declared.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- No exceptions declared (`Makefile`, `docker-compose*.yml`, `api/**`, `ui/**`, `deploy/**` untouched).
- No `blocked` / `deferred` / `cancelled` / `attention` items.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature here; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single contract-freeze step; no independent CI sub-streams)
- [ ] **Multi-branch**
- Rationale: S1-T0 is a 2h freeze with no runtime code; one branch, one review.

## UAT Management (in orchestration context)
- No UI change, no UAT checkpoint for this step.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/sandbox-node-step1` tracks `origin/main` (`5be8e34f3`) in worktree `tmp/worktrees/sandbox-node` before any edit.
  - [x] Confirm scope and guardrails (Allowed/Forbidden above; `Makefile` and `deploy/**` untouched).
- [x] **Lot 1 — Spec freeze**
  - [x] Write `spec/SPEC_EVOL_SANDBOX_NODE.md` (English): ExecutionNodeV1 + tenant model frozen; open points (D2/D3/D4/D5/D6/D7/D14) explicitly marked non-frozen.
- [x] **Lot 2 — Contract module**
  - [x] Add single amendable module `packages/contracts/src/execution-node-v1.ts` (types + JSON schemas, no dependency) and re-export it from `packages/contracts/src/index.ts`.
  - [x] Lot gate: `tsc --noEmit` on `packages/contracts` passes; `git status` shows no `Makefile`, `docker-compose*.yml`, `api/**`, `ui/**`, `deploy/**` changes.
- [x] **Lot S1-A1a — Sandbox-node daemon (apps/sandbox-node, Node/TS, zero Python)**
  - [x] Daemon against injectable runtime adapter (`src/runtime-adapter.ts`: fake for tests, real `runsc --network=none` systrap compile-safe).
  - [x] Per-tenant read-only base mounts + `/workspace`-only writes (`src/mounts.ts`).
  - [x] Lifecycle automaton + idempotence + ticket verification (`src/daemon.ts`, `src/tickets.ts`).
  - [x] Per-tenant admission/quotas + WFQ 1:1 drain + audit events (`src/admission.ts`, `src/audit.ts`).
  - [x] Unit tests written: tenant isolation, lifecycle incl. stop->export->destroy, tickets, admission fairness, adapters.
  - [x] Typecheck `apps/sandbox-node` via `exec-api` on `ENV=test-sandbox-node` (green).
  - [x] Unit tests green via `test-api-endpoints SCOPE=apps/sandbox-node/tests` on `ENV=test-sandbox-node` (5 files, 16 tests).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint for the touched package.
  - [ ] Bump `packages/contracts/package.json` only if a release step requires it (not in S1-T0).
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR.
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md`, push, and merge.
