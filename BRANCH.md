# Feature: ACT-L03a — same-repo seat/control core on the preserved #681 lineage (daily cyber activation, amendment r6)

## Objective
Implement lot ACT-L03a of r6 §7.2 (W1): preserve the #681 lineage rebased onto current origin/main and deliver the bounded same-repository seat/control core with qualified bootstrap placement — r6 §6 L3-A/B/C/D/F/H/I/L core, the required core suite, and tests T5-C1/C2/C3/C6, T6-C1/C2/C3/M1 (plus T6-D1 via L3-D) at the exact §6.4 destinations. Synthetic fixtures only; no live call, no payment, no custody repository or App.

## Scope / Guardrails
- Scope limited to `scripts/ci/seat-custody/**`, the three new `scripts/security/daily/control-*.mjs` modules and their tests, `docs/security/activation/owner-procedure-r6.md`, and the two gate files listed under Conditional Paths.
- Binding design: `.tmp/daily-cyber/activation-amendment-r6.md` (sha256 4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f). No design decision outside r6; anything else is reported, not decided.
- Make-only workflow, Docker under the flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, `ENV=test-cyber-L03a` always LAST, `make down ENV=test-cyber-L03a` after. Never `ENV=dev`, never `make clean-all`.
- Zero Python. Zero payment on quota exhaustion. No secrets read, printed, logged or committed.
- The preserved #681 work is rebased (never merged/cherry-picked) from `preserve/cyber-lot3-reconciled` onto `origin/main`; preserve refs stay untouched; the unadmitted broker blob `refs/preserve/cyber-lot3-broker` stays out of the tree.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required verbatim by `scripts/ci/ci-lockfile-installs.test.mjs`, run by the required `validate-publishable-manifests` CI job).
- Branch development happens in worktree `tmp/worktrees/cyber-act-L03a` on branch `feat/cyber-act-L03a`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/seat-custody/**`
  - `scripts/security/daily/control-provisioning.mjs`
  - `scripts/security/daily/control-provisioning.test.mjs`
  - `scripts/security/daily/control-permit-channel.mjs`
  - `scripts/security/daily/control-permit-channel.test.mjs`
  - `scripts/security/daily/control-clock.mjs`
  - `scripts/security/daily/control-clock.test.mjs`
  - `docs/security/activation/owner-procedure-r6.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `packages/**` (except the Conditional files below)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR03a-EX1: only the `test-security-daily` SCOPE list gains the three new `control-*.test.mjs` files so the r6 §7.3 cases run in the required suite that CI already executes)
  - `packages/llm-mesh/package.json` + `package-lock.json` (BR03a-EX2: post-rebase gate — branch touches `packages/llm-mesh/src/**`, so the version must be strictly greater than the published `0.32.2`; bump to `0.32.3`)
  - `packages/cluster-mesh/tests/fixtures/train.ts`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`, `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR03a-EX3: version-gate consequence — the EX2 candidate `0.32.3` must be reflected in the cluster-mesh train literal and the frozen selected tuple, so the exact gateway/mesh artifact/range/one-copy proofs required by r6 §6.1 hold at the gated version)
- **Exception process**:
  - BR03a-EX1 declared here before touching `Makefile`: reason = r6 §7.3 requires every §6.4 destination wired into its owning required Make suite (`test-security-daily`, already run by required CI job `validate-ci-capacity-metrics`); impact = additive SCOPE entries only, no existing entry removed; rollback = revert the single SCOPE line.
  - BR03a-EX2 declared here before touching the version files: reason = rules/workflow.md Post-Rebase Gate + `enforce-package-bump` CI job after the #681 rebase; impact = version string only in `packages/llm-mesh/package.json` and its workspace entry in `package-lock.json`; rollback = revert to `0.32.2`.
  - BR03a-EX3 declared here before touching the cluster-mesh fixtures: reason = r6 §6.1 post-rebase package-version gate (EX2) makes `packages/llm-mesh` the unpublished candidate `0.32.3`, and the cluster-mesh train/selected fixtures pin the workspace tuple exactly (main precedent: commit d1e9d31fd rebound them to `0.32.2`); impact = version literals plus the single `@sentropic/llm-mesh` lock entry (version/resolved/sibling sha512) only, no spec logic changed; rollback = revert the three files to the `0.32.2` pins.

## Feedback Loop
- BR03a-EX1: `acknowledge` — Makefile SCOPE addition for `test-security-daily` (see Conditional Paths).
- BR03a-EX2: `acknowledge` — llm-mesh `0.32.2` → `0.32.3` post-rebase package gate (see Conditional Paths).
- BR03a-EX3: `acknowledge` — cluster-mesh train/selected fixture literals rebound to the gated llm-mesh `0.32.3` (see Conditional Paths).
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
- [x] **Mono-branch + cherry-pick** (single branch `feat/cyber-act-L03a`; the preserved #681 lineage is rebased, not cherry-picked; one final CI on the review-ready head)
- Rationale: one lot, one branch; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, COMMON-RULES, r6 amendment, Lot 3 STOP report.
  - [x] Create worktree `tmp/worktrees/cyber-act-L03a` on branch `feat/cyber-act-L03a` from `origin/main`.
  - [x] Rebase `preserve/cyber-lot3-reconciled` (62 commits over `e6d17327`) onto `origin/main`; BRANCH.md conflicts keep the #681 copy, version/lockfile conflicts keep current-main pins.
  - [x] Post-rebase gate: bump `packages/llm-mesh` to `0.32.3` (> published `0.32.2`).
  - [x] Confirm command style: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make ... ENV=test-cyber-L03a` (ENV last), then `make down ENV=test-cyber-L03a`.
- [ ] **Lot 1 — Tests first (r6 §6.4 destinations)**
  - [ ] C/ `scripts/ci/seat-custody/tests/seat-environment-custody.test.ts` (T5-C1/C2, T6-C1): one environment per job, literal secret names, twelve reader copies, synthetic canonical→projection→N+1 roundtrip, same-run/stale-rerun/ambiguous-PUT/interrupted-write refusals.
  - [ ] C/ `scripts/ci/seat-custody/tests/seat-workflow-contract.test.ts` (T5-C1, T6-C1): emitted-workflow scan — no `secrets: inherit`, ≤1 environment per job, allowlisted literal secret refs only, hostile PR/fork/tag/unprotected-ref/indirection refusals.
  - [ ] C/ `scripts/ci/seat-custody/tests/custody-state-store.test.ts` (T6-C2): eight-job transaction, bank/HEAD fencing, full interruption matrix, limits at/above ceilings, mixed-generation/stale-pointer refusal.
  - [ ] C/ `scripts/ci/seat-custody/tests/e2e/github-seat-roundtrip.test.ts` (T5-C2 real later-run probes): synthetic payloads against the environment-secret API surface in a separate process/run.
  - [ ] C/ `scripts/ci/seat-custody/tests/ci-seat-broker.test.ts` (extend, T5-C3), `seat-ci-artifacts.test.ts`, `seat-secret-hygiene.test.ts` (T5-C3): positive wire + candidate file/env/process/socket/egress negatives, ciphertext-only artifacts, names-only hygiene.
  - [ ] C/ `scripts/ci/seat-custody/tests/ci-seat-topology.test.ts` (T6-C3): translated SO_PEERCRED triples, fixed elevation entry, guardian receipt fields.
  - [ ] C/ `scripts/ci/seat-custody/tests/acceptance-disposition.test.ts` (T6-M1): all 69 acceptance IDs, 63 paths, §6.4 rows, T5/T6 IDs, credential/copy/loader receipts.
  - [ ] C/ `scripts/ci/seat-custody/tests/owner-procedure-contract.test.ts` (T6-D1): §5.1/§5.2 equivalence against one fixture, both V6 5/8i withdrawals, retired IDs/cutoff, six steps, two owner quotes byte-for-byte.
  - [ ] D/ `scripts/security/daily/control-provisioning.test.mjs` (T5-C6, T6-M1), `control-permit-channel.test.mjs` (T5-C6, T6-C3), `control-clock.test.mjs` (T5-C6, T6-C3).
  - [ ] RED run: `flock … make test-ci-seat-contract ENV=test-cyber-L03a` and `flock … make test-security-daily ENV=test-cyber-L03a`.
- [ ] **Lot 2 — Same-repo seat/control core implementation**
  - [ ] `src/seat-environment-custody.ts` (L3-B store binding: sentropic protected environments, sealed PUT, N+1, canonical→projection ordering).
  - [ ] `src/custody-state-store.ts` (L3-B/§4.3.1: CustodyStateV1, two banks ×16 segments, HEAD, fence CAS, eight-job transaction).
  - [ ] `src/seat-workflow-contract.ts` (L3-C/L3-F: job→environment contract, bootstrap placement on protected main only, permanent closure after #681 merge).
  - [ ] `src/ci-seat-broker.ts` (L3-C: reservation-bound wire, journal fsync-before-send, FD-only loading, permits).
  - [ ] `src/acceptance-disposition.ts`, `src/owner-procedure.ts` (T6-M1, T6-D1 data).
  - [ ] D/ `control-provisioning.mjs`, `control-permit-channel.mjs`, `control-clock.mjs` (L3-I/L3-L, T5-C6/T6-C3).
  - [ ] `docs/security/activation/owner-procedure-r6.md` (synchronized §5.1/§5.2 copy).
  - [ ] Wire D/ tests into `test-security-daily` SCOPE (BR03a-EX1).
  - [ ] GREEN run of both suites; `make down ENV=test-cyber-L03a`.
- [ ] **Lot 3 — Preservation receipts & gates**
  - [ ] `spec/evidence/ci-seats/activation-lot3-preservation.json` re-read and extended with the rebase-onto-current-main record (L3-H).
  - [ ] `make scope-check` before every commit; `git diff --check`; atomic `make commit` ≤150 lines, push after every few commits (crash safety).
  - [ ] `make test-llm-mesh` + `make typecheck-llm-mesh` regression on the rebased lineage.
- [ ] **Lot N — Final validation**
  - [ ] Both suites GREEN under the flock with `ENV=test-cyber-L03a` last; `make down ENV=test-cyber-L03a`; `make ps` empty.
  - [ ] Push review-ready head; open draft PR with this BRANCH.md as body.
  - [ ] Run ONE CI on the final head; wait for completion; record result.
  - [ ] Report to `.tmp/rv/cyber-act-L03a.md`; do not merge.
