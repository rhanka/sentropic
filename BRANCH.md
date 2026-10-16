# Feature: CI seat contract

## Objective
Deliver lot L0a on branch feat/ci-seat-contract: the frozen five-CLI seat envelope and source contract for llm-mesh, synthetic fixtures only, gated by the package Make targets.

## Scope / Guardrails
- Scope limited to spec v9 section 8 lot L0a, synthetic fixtures only, no live provider call.
- Never read, print or copy a real secret or token; no live home, keyring or network access.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree tmp/worktrees/ci-seat-contract.
- Automated test campaigns run on ENV=test-ci-seat-contract, never on root dev.
- In every make command, ENV=<env> must be passed as the last argument.
- All new text in English.
- Stop at end of L0a; L1 and later lots are out of scope and need their own branches.
- Owner decisions binding: Q1=A, Q2=A with easy re-enrollment, Q3=B no GitHub Pro; seats only, never per-token API cost.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_CI_SEATS.md`
  - `packages/llm-mesh/src/enrollment/seat-bundle.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/tests/enrollment/seat-bundle.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/README.md`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - workflows/deployment, h2a source, any credential store
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none in L0a
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).
- **Reserved downstream exception**:
  - `CISEAT-EX3` recorded for L1 owner-machine native helper use; grants no host execution or forbidden-path edit in L0a.

## Feedback Loop
- `attention` CISEAT-EX3 reserved: owner-machine native Node helper for L1 local inspect and L3 re-enroll; rationale macOS Keychain, Windows Credential Manager, Linux session D-Bus; rollback disable helper targets and retire disposable lab profile; no L0a host execution under this exception.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- L0a status: N/A, synthetic container gates only, no AI provider call.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: L0a is one small independently reviewable contract with a single owner.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/ci-seat-contract`.
  - Push branch before UAT.
  - L0a UAT is a credential-free walkthrough, no root ENV=dev session needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules MASTER, workflow, subagents, testing, security and plan/BRANCH_TEMPLATE.md.
  - [x] Read spec v9 section 8 lot L0a and challenge-opus-r5 L0a verdict.
  - [x] Verify branch feat/ci-seat-contract on origin/main 09b1c601d and clean tree.
  - [x] Verify L0a Make targets at Makefile:760, :764, :2007 and empty make ps-all.
  - [x] Define environment mapping: ENV=test-ci-seat-contract; reserved ports API_PORT=9570 UI_PORT=5770 MAILDEV_UI_PORT=1670; L0a package gates expose no ports and need no slot.
  - [x] Confirm command style: make ... ENV=<env> with ENV last.
  - [x] Confirm scope and guardrails; record CISEAT-EX3 as reserved only.
- [ ] **Lot L0a — Five-CLI envelope and source contract, synthetic first**
  - [x] Define SeatBundleV1 in packages/llm-mesh/src/enrollment/seat-bundle.ts.
  - [x] Export contract through packages/llm-mesh/src/node/index.ts, no browser export.
  - [x] Bump packages/llm-mesh/package.json 0.25.0 to 0.25.1 and match package-lock.json.
  - [x] Add packages/llm-mesh/tests/enrollment/seat-bundle.test.ts covering five schemas, size, owner, client, unknown and nested refresh fields, rollback, authority escalation.
  - [x] Add spec/SPEC_EVOL_CI_SEATS.md with frozen interfaces and supported/unverified table.
  - [x] Document contract in packages/llm-mesh/README.md.
  - [ ] UAT credential-free walkthrough:
    - [ ] Select five synthetic profile labels, one per CLI.
    - [ ] Inspect static validation errors for mismatched owner, client and oversize bundle.
    - [ ] Inspect metadata-only receipts with no credential payload.
    - [ ] Review one-command enrollment instructions for initial enrollment and replacement.
  - [x] Lot gate:
    - [x] `make test-llm-mesh SCOPE=tests/enrollment/seat-bundle.test.ts ENV=test-ci-seat-contract`
    - [x] `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh ENV=test-ci-seat-contract`
    - [ ] **API tests**: N/A in this lot, no api/** change.
    - [ ] **UI tests (TypeScript only)**: N/A in this lot, no UI change.
    - [ ] **E2E tests**: N/A in this lot, no browser or native E2E.
- [ ] **Lot N — Final validation**
  - [x] Typecheck and Lint for llm-mesh package.
  - [x] Retest llm-mesh package gate.
  - [x] Bumped packages/llm-mesh/package.json version 0.25.1, matching package-lock.json.
  - [ ] Final gate step 1: create DRAFT PR using BRANCH.md text as PR body.
  - [ ] Final gate step 2: run and verify branch CI on that PR and resolve remaining blockers.
  - [ ] Stop at end of L0a: never merge, never publish.
