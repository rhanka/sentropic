# Feature: ACT-L03b — #681 CI/API/restore/current-model integration + complete test-disposition manifest (daily cyber activation, amendment r6, wave W2)

## Objective
Implement lot ACT-L03b of r6 §7.2 (W2) on the preserved #681 lineage now merged via #872: complete the #681 CI integration (bot-PR trigger/check bridge, exact-H/B/T gate, late-receipt gate), the OperationModelMapV1 current product/CI operation map, and the complete 63-path/case/destination/required-Make-suite manifest with collection proof — remaining L3-A/C/D/E/G/H/J/K/L/M items and §7.3 tests T5-C5, T6-R1 (exact-head PR-trigger side) and T6-M1 at the exact §6.4 destinations.

## Scope / Guardrails
- Scope limited to the Allowed Paths below. Binding design: `.tmp/daily-cyber/activation-amendment-r6.md` (sha256 4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f, verified at session start). No design decision outside r6; anything else is reported, not decided.
- Make-only workflow, Docker under the flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, `ENV=test-cyber-L03b` always LAST, `make down ENV=test-cyber-L03b` after. Never `ENV=dev`, never `make clean-all`. No new Docker image build (reuse pinned node:24 image).
- Zero Python. Zero payment on quota exhaustion. No secrets read, printed, logged or committed. Synthetic fixtures only; no live call, no custody repository, no App.
- Preserve refs stay untouched (`preserve/cyber-lot3-*`, `refs/preserve/cyber-lot3-broker`); the unadmitted broker blob stays out of the tree. #681 stays open; this branch continues the lineage as r6 §6/§7.2 say. No merge of this PR by this lane.
- Retain the BRLOCK-EX1 policy reference verbatim in this BRANCH.md (required by `scripts/ci/ci-lockfile-installs.test.mjs`, run by required CI job `validate-publishable-manifests`): owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Branch development happens in worktree `tmp/worktrees/cyber-act-L03b` on branch `feat/cyber-act-L03b` from `origin/main` (9899cf336, L03a merged).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/seat-custody/**`
  - `scripts/security/daily/ci-trigger-bridge.mjs`
  - `scripts/security/daily/ci-trigger-bridge.test.mjs`
  - `scripts/security/daily/review.mjs`
  - `scripts/security/daily/review.test.mjs`
  - `scripts/security/daily/post-merge-effects.mjs`
  - `scripts/security/daily/post-merge-effects.test.mjs`
  - `spec/evidence/ci-seats/activation-lot3-preservation.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `.tmp/**`
  - `api/**`
  - `packages/**`
  - `e2e/**`
  - `ui/**`
  - `plan/**`
  - `docs/**` (except none)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR03b-EX1: only the `test-security-daily` SCOPE list gains the three new D/ test files so the r6 §7.3 cases run in the required suite that CI job `validate-ci-capacity-metrics` already executes)
- **Exception process**:
  - BR03b-EX1 declared here before touching `Makefile`: reason = r6 §6.4/§7.3 requires every §6.4 destination wired into its owning required Make suite (`test-security-daily`, already run by required CI job `validate-ci-capacity-metrics`); impact = additive SCOPE entries only, no existing entry removed; rollback = revert the single SCOPE line. C/ destinations need no Makefile change: `test-ci-seat-contract` collects `tests/*.test.ts tests/e2e/*.test.ts` by glob.

## Feedback Loop
- BR03b-EX1: `acknowledge` — Makefile SCOPE addition for `test-security-daily` (see Conditional Paths).
- No open blockers: r6 supplies every design decision for this lot; anything not covered by r6 is reported in the final report, not decided here.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- This lot runs only synthetic, network-free suites; no AI flaky lane applies.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch `feat/cyber-act-L03b`; one final CI on the review-ready head)
- Rationale: one lot, one branch; the preserved #681 lineage is already on main via #872; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, COMMON-RULES, r6 amendment, Lot 3 STOP report, r4 §5/§10.3.
  - [x] Create worktree `tmp/worktrees/cyber-act-L03b` on branch `feat/cyber-act-L03b` from `origin/main` (9899cf336); `harness check branch` PASS C1.
  - [x] Confirm command style: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make ... ENV=test-cyber-L03b` (ENV last), then `make down ENV=test-cyber-L03b`.
- [x] **Lot 1 — Tests first (r6 §6.4 destinations, RED)**
  - [x] C/ `tests/operation-model-map.test.ts` (L3-E/L3-J): OperationModelMapV1 load, I/D/N classification, retired IDs, exact 2027-04-01T00:00:00Z cutoff instant, no substring ban, unmapped live op refuses, source-gap deployment evidence leaves case required/incomplete, no CI-only alias.
  - [x] C/ `tests/acceptance-disposition.test.ts` (extend, T6-M1): 63 paths resolved (41 present incl. the 5 re-landed by L03a, 22 with exact replacement destinations), all §6.4 + L03a/L03b destinations exist AND are wired into required Make suites (collection proof), no bare N/A.
  - [x] D/ `ci-trigger-bridge.test.mjs` (T5-C5, L3-G, L3-M): actual main-push effect enumeration, one dispatched exact-H/B/T required CI per bot PR, stale/ref-swapped/partial/missing/replayed/spoofed refusal, zero release effects, late-receipt gate, hostile same-repo PR production-credential acquisition refusal (A13 stays source-gap).
  - [x] D/ `review.test.mjs` (T5-C5): native-review classification, automated-translation event contract, attestor != author, bot self-approval refusal, person-owned token vs human-intent refusal.
  - [x] D/ `post-merge-effects.test.mjs` (T6-R1 PR-trigger side): exact-head PR CI with no release passes; post-merge exact-M dispatch contract (one per effect, idempotent intent, wrong-head/main-move/push-only refusals, pause+debt on failure).
  - [x] RED run: `flock … make test-ci-seat-contract ENV=test-cyber-L03b` and `flock … make test-security-daily ENV=test-cyber-L03b`.
- [x] **Lot 2 — Implementation (GREEN)**
  - [x] C/ `config/operation-model-map.v1.json` + `src/operation-model-map.ts` (L3-E/L3-J OperationModelMapV1).
  - [x] C/ `src/acceptance-disposition.ts`: replacement mappings, L03B_TEST_IDS, `validateCollection` (destination existence + Make-suite wiring).
  - [x] D/ `ci-trigger-bridge.mjs`, `review.mjs`, `post-merge-effects.mjs`.
  - [x] `spec/evidence/ci-seats/activation-lot3-preservation.json` re-landed and extended with the #872 rebase record (L3-H).
  - [x] Wire D/ tests into `test-security-daily` SCOPE (BR03b-EX1).
  - [x] GREEN run of both suites; `make down ENV=test-cyber-L03b`.
- [ ] **Lot 3 — Gates, PR, CI, report**
  - [x] `make scope-check` before every commit; `git diff --check`; atomic `make commit` ≤150 lines, push after every few commits (crash safety).
  - [ ] Push review-ready head; open draft PR with this BRANCH.md as body.
  - [ ] Run ONE CI on the final head; wait for completion; record result.
  - [ ] Report to `.tmp/rv/cyber-act-L03b.md`; do not merge.
