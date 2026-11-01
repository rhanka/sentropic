# Feature: cyber-act-L08a same-repo control and deadline

## Objective
Deliver ACT-L08a from activation amendment r6: same-repo public control, report writer and deploy-key rulesets, pinned control image, off and enable, DeadlineStatusV1 and daily deadline trigger.

## Scope / Guardrails
- Scope limited to scripts/security/daily control, report, deadline, provisioning and resource modules plus one report-control workflow.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/security/daily/**`
  - `docs/security/controls/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `Makefile`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `BR08a-EX1` (Makefile, conditional path): extend the existing `test-security-daily` `SCOPE` list with the fourteen L08a `scripts/security/daily/*.test.mjs` files. Reason: r6 section 6.4 requires every new case wired into its owning required Make suite, and the suite target already exists. Impact: one line, no target added, no existing file removed from the list. Rollback: restore the five-file list.
- `BR08a-EX2` (.github/workflows/**, conditional path): add `.github/workflows/security-report-control.yml` with L08a-owned jobs only (report fence writers, deadline-record, control-receipt). Reason: T6-C1 parses actual emitted jobs against the section 4.1 single-environment map. Impact: new workflow, manual and schedule triggers for deadline only, no secrets. Rollback: delete the file.

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
- Rationale: single lane implementing one wave-table row with no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read COMMON-RULES, amendment r6 and wave-table row ACT-L08a plus section 7.3 tests.
  - [x] Verify r6 sha256 `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
  - [x] Create worktree `tmp/worktrees/cyber-act-L08a` on branch `feat/cyber-act-L08a` from `origin/main` (`1239f291f`).
  - [x] Confirm command style: `make ... ENV=test-cyber-L08a` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BR08a-EX1` and `BR08a-EX2`.
  - [x] No ports needed: no compose services, tests run via `docker run` node image only.
  - [x] No live credentials: synthetic fixtures only, fail-closed without live resources.
- [x] **Lot 1 — Tests first**
  - [x] Add `scripts/security/daily/workflow-contract.test.mjs` (T5-C1, T6-C1, L8-B, L8-G, L8-H).
  - [x] Add `scripts/security/daily/report-branch-integrity.test.mjs` (T5-C4, L8-B, L8-D, L8-F subset).
  - [x] Add `scripts/security/daily/report-format.test.mjs` (L8-C, L8-I, DeadlineStatusV1).
  - [x] Add `scripts/security/daily/control-permit-channel.test.mjs` (T5-C6 part, T6-C3 part, L8-G).
  - [x] Add `scripts/security/daily/control-clock.test.mjs` (T5-C6 part, T6-C3 part, L8-G, L8-J).
  - [x] Add `scripts/security/daily/control-provisioning.test.mjs` (T5-C6 part, T6-C1 part, T6-M1 part, L8-J).
  - [x] Add `scripts/security/daily/resource-envelope.test.mjs` (T6-B1, L8-H).
  - [x] Add `scripts/security/daily/deadline-report.test.mjs` (L8-I).
  - [x] Add `scripts/security/daily/collector-provenance.test.mjs` plus `control-image-publish.test.mjs` (L8-K).
  - [x] Lot gate: tests written before implementation modules, failing run recorded.
- [x] **Lot 2 — Implementation**
  - [x] Add `job-environment-map.json` (section 4.1 map, twelve reader copies) plus loader module.
  - [x] Add `report-branch-integrity.mjs` (hook-free SSH expected-parent writer contract).
  - [x] Add `report-format.mjs` (DeadlineStatusV1 schema, sanitized public report, fence projection reader).
  - [x] Add `control-image-pin.mjs` (pinned control image contract, fail-closed without digest).
  - [x] Add `control-permit.mjs` (watcher, consumer, permits, translated peers, elevation, guardian).
  - [x] Add `control-clock.mjs` (clock health, termination bounds).
  - [x] Add `enable.mjs` (global-off-first, off and enable receipts).
  - [x] Add `control-provisioning.mjs` (section 4.5 L08a rows, copies, expiry).
  - [x] Add `resource-envelope.mjs` (section 7.4 L08a accounting).
  - [x] Add `deadline-report.mjs` (07:30 trigger contract, shortfall handoff).
  - [x] Add `.github/workflows/security-report-control.yml` (EX2).
  - [x] Extend `test-security-daily` `SCOPE` with the L08a files (EX1).
  - [x] Lot gate: full suite green locally under flock with `ENV=test-cyber-L08a` last, then `make down`.
- [ ] **Lot 3 — Branch hygiene and PR**
  - [x] Run `make scope-check`.
  - [x] Atomic commits with `make commit` (150 lines max each), push after every few commits.
  - [ ] Open draft PR with `BRANCH.md` as body.
  - [ ] Run ONE CI on the final head and wait for completion.
- [ ] **Lot 4 — Report and stop**
  - [ ] Write `.tmp/rv/cyber-act-L08a.md` with PR, head, CI result and each acceptance item.
  - [ ] Stop without merging.
