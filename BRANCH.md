# Feature: ACT-L06a — persistent provider/account rotation and first qualified reconciled route(s) (daily cyber activation, amendment r6)

## Objective
Implement lot ACT-L06a of r6 §7.2 (W2): persistent provider-first/account-second rotation over the single custody allocator, the first individually qualified reconciled route(s) with billing-first quota/lifecycle/model proof and the T6-P1 public-execution disposition, and `review-partial-roster` publication while A1 stays unresolved — synthetic L6-B–G (including two Codex/two Vibe fixtures), per-selected-account L6-H gating, and §7.3 tests T5-N2 (C/ half) and T6-P1 at the exact §6.4 destinations. No claim of L6-A/all-account closure; no live call, no payment, no new account, no design decision outside r6.

## Scope / Guardrails
- Scope limited to `scripts/ci/seat-custody/**` (new `src/security-roster.ts`, `src/seat-public-execution.ts`, new `tests/security-roster.test.ts`, `tests/seat-public-execution.test.ts`, extended `tests/seat-admission.test.ts`, additive type extension of `src/custody-state-store.ts`) and `BRANCH.md`.
- Binding design: `.tmp/daily-cyber/activation-amendment-r6.md` (sha256 4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f, verified at session start). r6 §7.2 row ACT-L06a, §6.4 rows L9-C/L9-F, §7.3 T5-N2/T6-P1, §4.3.3. Depends on ACT-L03a (merged on main as 9899cf336); reuses its CustodyStateV1 store, broker and admission caps unchanged.
- Make-only workflow, Docker under the flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, `ENV=test-cyber-L06a` always LAST, `make down ENV=test-cyber-L06a` after. Never `ENV=dev`, never `make clean-all`. At most one locked Docker lane at a time.
- Zero Python. Zero payment on quota exhaustion (no paid fallback, top-up, overage or purchase). No secret read, printed, logged or committed; synthetic fixtures only.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required verbatim by `scripts/ci/ci-lockfile-installs.test.mjs`, run by the required `validate-publishable-manifests` CI job).
- Tests first: RED run of `make test-ci-seat-contract SCOPE=...` under the flock, then implementation, then GREEN run of the full `make test-ci-seat-contract ENV=test-cyber-L06a`.
- Branch development happens in worktree `tmp/worktrees/cyber-act-L06a` on branch `feat/cyber-act-L06a` created from `origin/main` (9899cf336).
- All new text in English. No human-effort or time estimates.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/seat-custody/src/security-roster.ts`
  - `scripts/ci/seat-custody/src/seat-public-execution.ts`
  - `scripts/ci/seat-custody/src/custody-state-store.ts` (additive optional fields only: roster entry provider/displayName/aliases/quotaFamilyRef/refreshFamilyRef, `admissions`, `skips`; no existing field, bound or validation removed)
  - `scripts/ci/seat-custody/tests/security-roster.test.ts`
  - `scripts/ci/seat-custody/tests/seat-public-execution.test.ts`
  - `scripts/ci/seat-custody/tests/seat-admission.test.ts` (L9-C additions only)
  - `BRANCH.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `.tmp/**` (report file stays untracked)
  - `api/**`
  - `packages/**`
  - `scripts/security/**` (D/ half of T5-N2 belongs to ACT-L09's `daily-review.test.mjs`, not this lot)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - No exception declared; no conditional or forbidden path is touched. `test-ci-seat-contract` already globs `tests/*.test.ts`, so no Makefile change is needed to wire the new suites.

## Feedback Loop
- No open blockers: r6 supplies every design decision for this lot (rotation order, skip codes, caps, exhaustion behavior, §4.3.3 disposition, `review-partial-roster`). Anything not covered by r6 is reported in the final report, not decided here.
- D/ `daily-review.test.mjs` half of T5-N2 is ACT-L09's destination and does not exist yet; the C/ half (rotation, dedup-by-reviewInputKey at the allocator, exhaustion, waiting-seat, zero payment) is implemented and tested here.
- Test runs (Docker under the flock, `ENV=test-cyber-L06a` last, `make down ENV=test-cyber-L06a` after, `make ps` empty): scoped run of the three touched suites = 27/27 pass. Full `make test-ci-seat-contract ENV=test-cyber-L06a` = 91 tests, 90 pass, 1 fail; all 21 new ACT-L06a tests pass.
- The single failure is pre-existing on `origin/main` (9899cf336), not caused by this lot: `tests/seat-workflow-contract.test.ts` T5-C1/T6-C1 fails identically on a detached `origin/main` worktree (rc=2) with signature `security-report-control.yml: preflight-missing:deadline-record; preflight-missing:control-receipt; preflight-missing:state-intent; preflight-missing:state-commit`. This branch's diff does not touch `.github/workflows/**` or `seat-workflow-contract.ts` (verified via `git diff origin/main HEAD --stat`). Recorded per the AI-flaky/unrelated-failure policy; not blocking for this lot.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch `feat/cyber-act-L06a` from `origin/main`; one final CI on the review-ready head)
- Rationale: one lot, one branch; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, COMMON-RULES, r6 amendment (sha256 verified), r4 §2/§3/§10.3 L6 definitions, L03a report and merged seat-custody code.
  - [x] Create worktree `tmp/worktrees/cyber-act-L06a` on branch `feat/cyber-act-L06a` from `origin/main` (9899cf336); `harness check branch` PASS C1; `.env` copied locally (never printed).
  - [x] Confirm command style: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make ... ENV=test-cyber-L06a` (ENV last), then `make down ENV=test-cyber-L06a`.
  - [x] Validate scope boundaries (Allowed/Forbidden above); no exception needed.
- [x] **Lot 1 — Tests first (r6 §6.4 destinations)**
  - [ ] C/ `tests/security-roster.test.ts` (L6-B–G, T5-N2 C/ half, L6-H gating, `review-partial-roster`): L6-B exact A1,B1,A2,B1,A1 sequence, exhausted-skip-within-provider, all-A-refuse→B, five-provider ring, duplicate display names, enrollment append/removal tombstone/rename, alias + refresh-family sharing, persistence across restart/midnight/mode/epoch; L6-D every skip code; L6-E last-unit double allocation, once-only settlement, crash holds; L6-F cross-account isolation, refresh drain + successor gate; L6-G bounded full exhaustion → waiting-seat, zero paid, runner released, no conversation migration; two Codex/two Vibe fixtures; unchanged reviewInputKey → zero inference.
  - [ ] C/ `tests/seat-public-execution.test.ts` (T6-P1): accept C1 D0.3 public-repo extension or explicit provider proof only with all other gates; refuse private-only/other-provider/expired/generic consent; A9 linkage recorded; unqualified routes stay visible/off.
  - [ ] C/ `tests/seat-admission.test.ts` (L9-C additions): allocator commits turns in state, broker consumes reservation without local cursor reset, exhaustion yields waiting-seat with zero payment and unchanged caps.
  - [ ] RED run: `flock … make test-ci-seat-contract SCOPE="scripts/ci/seat-custody/tests/security-roster.test.ts scripts/ci/seat-custody/tests/seat-public-execution.test.ts scripts/ci/seat-custody/tests/seat-admission.test.ts" ENV=test-cyber-L06a`, then `make down ENV=test-cyber-L06a`.
- [x] **Lot 2 — Implementation**
  - [ ] `src/security-roster.ts`: PROVIDER_RING, roster enrollment/tombstone/rename, cursor persistence, provider-first/account-second `selectRoute` with typed skips, reservation via existing seat-admission caps, L6-F projection isolation, L6-G exhaustion result, reviewInputKey dedup, `AccountQualificationV1` gate (billing-first, non-inference quota >20% ≤30s, lifecycle, exact model route, public-execution disposition), purpose enablement (report-only review vs assisted repair distinct models), `review-partial-roster` publication.
  - [ ] `src/seat-public-execution.ts`: `PublicExecutionDispositionV1` (r6 §4.3.3) validation + route admission gate + A9 linkage.
  - [ ] `src/custody-state-store.ts`: additive optional roster fields + `admissions`/`skips` arrays in `CustodyStateV1`/`makeGenesisState` (validateState unchanged in strictness).
  - [ ] GREEN run: `flock … make test-ci-seat-contract ENV=test-cyber-L06a` (full suite, no regressions in the 68 existing tests); `make down ENV=test-cyber-L06a`; `make ps` empty.
- [x] **Lot 3 — Gates, commits, push**
  - [ ] `make scope-check` before every commit; `git diff --check`; atomic `make commit MSG="…"` ≤150 lines, stage specific files only; push after every few commits (crash safety).
- [ ] **Lot N — Final validation**
  - [ ] Full suite GREEN under the flock with `ENV=test-cyber-L06a` last; `make down ENV=test-cyber-L06a`; `make ps` empty.
  - [ ] Push review-ready head; open draft PR with this BRANCH.md as body.
  - [ ] Run ONE CI on the final head; wait for completion; record result.
  - [ ] Report to `.tmp/rv/cyber-act-L06a.md` (untracked); do not merge.
