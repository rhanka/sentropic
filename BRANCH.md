# Feature: release-receipt skipped publishers hotfix

## Objective
Unblock main deploys: `release-receipts` must pass when a selected package publisher ran green but explicitly published nothing (dev-line skip, already-published equal-integrity).

## Scope / Guardrails
- Scope limited to release receipt assessment and the CI record outputs feeding it.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/release-receipt-hotfix`.
- Automated tests run on dedicated environment (`ENV=test-ci-receipt`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/release-receipt.mjs`
  - `scripts/ci/release-receipt.test.mjs`
  - `.tmp/rv/hotfix-release-receipt.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `<none>`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention`: BR82-EX2 — `.github/workflows/ci.yml` record steps touched (conditional path). Reason: the cluster-mesh decision-skip path emits no `record` outputs today, so the receipt sees job `success` with no `pack` and fails a publisher that never published; the equal-integrity conflict is also not forwarded. Impact: three `record` steps only (llm-mesh, llm-gateway, cluster-mesh) gain an explicit `status=skipped` branch and a forwarded `conflict` output; no job `if` conditions change. Rollback: revert the `record` step blocks; the `.mjs` fix alone already passes already-published mesh/gateway receipts.
- `acknowledge`: main is RED at `843efe3a1` (run 42036741718, `release-receipt: FAIL (1): repacked publication: @sentropic/cluster-mesh (pack=missing, expected candidate)`); this branch is the urgent hotfix lane, no merge until the PR CI is green.

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
- Rationale: single orthogonal hotfix, one final test cycle on the PR CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/release-receipt-hotfix` on branch `fix/release-receipt-skipped-publishers` from `origin/main` (`843efe3a1`); harness branch check PASS C1.
  - [x] Confirm scope boundaries and declare BR82-EX2 for `.github/workflows/ci.yml`.
  - [x] Confirm command style: `make ... ENV=test-ci-receipt` with `ENV` last.
- [x] **Lot 1 — Tests-first receipt fix**
  - [x] Added red tests to `scripts/ci/release-receipt.test.mjs` (5 failed pre-fix, 2 fail-closed locks passed pre-fix).
  - [x] Fixed `scripts/ci/release-receipt.mjs` (`assessChain` reads `publication_*` outputs + explicit status; `publicationProblems` passes explicit skipped/already-published, keeps pack FAIL-closed for real publications).
  - [x] Fixed `ci.yml` record steps (explicit `status=skipped` on the cluster-mesh decision-skip path, forward `conflict`).
  - [x] Lot gate:
    - [x] `make test-publishable-manifests SCOPE=scripts/ci/release-receipt.test.mjs ENV=test-ci-receipt` green (40/40); full manifest suite 119/119 green.
    - [x] `make scope-check` clean before every commit; commits via `make commit` only.
- [ ] **Lot 2 — PR + CI to green**
  - [ ] Open READY PR from `fix/release-receipt-skipped-publishers`, push head.
  - [ ] Watch PR CI to green (no `[skip ci]`, no `gh run rerun`).
- [ ] **Lot 3 — Report, no merge**
  - [ ] Write `.tmp/rv/hotfix-release-receipt.md`.
  - [ ] Do NOT merge; hand control back.
