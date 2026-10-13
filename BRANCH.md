# Feature: Comments cluster-mesh storage port — Lot C0

## Objective
- [x] Implement C0 of the FROZEN L3a v4.1 storage-port spec: compatibility and extension manifest, frozen-M1 preservation test pinning M1 source hashes, exact transport and oracle packaging declarations.
- [x] Merge frozen M1 (PR #663), promoted spec (origin/spec/comments-annotations-port), and cluster-mesh storage K1/K2a (PR #666) cleanly without modifying frozen M1 files.

## Scope / Guardrails
- [x] Branch `feat/comments-cm-c0` in `tmp/worktrees/comments-cm-c0`, branched from `origin/feat/comments-annotations-model` (frozen M1, PR #663, freeze 2dabe25ce).
- [x] Merge `origin/spec/comments-annotations-port` and `origin/feat/cluster-mesh-storage-k1` (PR #666).
- [x] Resolve merge conflict in `BRANCH.md` only; never modify frozen M1 files (`docs/comments-annotations/contract/contract-v1.json`, `docs/comments-annotations/contract/freeze-receipt.md`, `packages/comments/src/**`, `packages/comments/tests/**`).
- [x] Implement C0 deliverables from §17: `docs/comments-annotations/contract/storage-module-v1.json`, `docs/comments-annotations/contract/storage-compatibility.md`, and test `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`.
- [x] Test-first: test fails when M1 source hashes change, and verifies compatibility manifest and storage contract boundaries (see DEBT-TEST-FIRST in Feedback Loop).
- [x] Make-only workflow, Docker-first, ENV last with `API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
- [x] Commits under 150 changed lines, max 10-15 files, named `git add` then separate `make commit MSG="..."`, no AI attribution (see BR-C0-EX4 for 2faca3916).
- [x] Report `.h2a/build/c0_report.md` in the new worktree (untracked).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope, frozen L3a v4.1 §17.4 row C0 plus shared branch files)**:
  - `BRANCH.md`
  - `docs/comments-annotations/contract/storage-module-v1.json`
  - `docs/comments-annotations/contract/storage-compatibility.md`
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `docs/comments-annotations/contract/contract-v1.json`
  - `docs/comments-annotations/contract/freeze-receipt.md`
  - `packages/comments/src/**`
  - `packages/comments/tests/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
  - `docs/comments-annotations/plan/**`
  - `docs/comments-annotations/evidence/**`
  - `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `BR00-EX1` (`BR-C0-EX1`) — Merge commit contains incoming files from K1/K2a (PR #666) and spec promotion; verified frozen M1 files are untouched.
- [x] `BR00-EX2` (`BR-C0-EX2`) — Re-merge `origin/feat/cluster-mesh-storage-k1` at `471628c19` (C0 Opus m7) and spec `§18.2` alignment (C0 Opus M6; local `1daad605c`, `d5cada404`, carried into this branch by merge, spec branch subsequently pushed at `c3518c2de`). Conflict resolution limited to `BRANCH.md` (kept C0 side); frozen M1 files verified untouched after each merge.
- [x] `BR00-EX3` (`BR-C0-EX3`) — C0 Opus remediation (B1, M1-M6, m1-m4): manifest error vocabulary derived from frozen M1 sources, `unverified` oracle/transport qualification, exact §11.3 limits/admission/operations, corrected transaction signature, derived hash pins incl. all conformance suites, executable G3 import scans. Rationale: review NO-GO findings. Impact: 4 files (manifest, doc, test, BRANCH.md). Rollback: revert the remediation commits.
- [x] `BR00-EX4` (`BR-C0-EX4`) — Commit `2faca3916` modified 391 lines in `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts` exceeding the 150-line limit (C0 Opus r2 a-m1). Rationale: atomic update of the boundary test suite to test all derived hash pins and frozen error vocabulary in a single coherent test file without intermediate broken test states. Impact: 1 test file only. Rollback: revert commit 2faca3916. All subsequent commits remain strictly under 150 lines.
- [x] `BR00-EX5` (`BR-C0-EX5`) — Re-merge `spec/comments-annotations-port` at `c3518c2de` (C0 Opus r2 MAJ-1, a-m7); partially addresses §18.2; r3 identifies remaining contradictory passages in step-1 docs (plan and spec files). Conflict resolution limited to `BRANCH.md` (kept C0 side); frozen M1 files verified untouched.
- [x] `BR00-EX6` (`BR-C0-EX6`) — Owner-requested full C0 documentation sweep on this branch: plans, evidence extracts and `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md` may change to align frozen L3a v4.1 §§9.6/11.3/17/18.2. Impact: documentation and the existing C0 guard only; frozen M1 remains byte-identical. Rollback: revert this remediation series. No merge or other-branch push.
- [x] `DEBT-TEST-FIRST` — Git commit history shows manifest/doc committed before boundary tests (`4318dca02` before `c6f57bb8a` in initial C0; `e9a1e2951` before `2faca3916` in r1 remediation) (C0 Opus r2 a-m6). Acknowledged technical debt: all subsequent fixes are test-verified before commit.

## AI Flaky tests
- [x] No AI flaky tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick (default for orthogonal tasks; single final test cycle)
- [x] Rationale: C0 delivers compatibility manifest and frozen-M1 preservation test in single worktree.

## UAT Management (in orchestration context)
- [x] Mono-branch: no UI surface in C0, no UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & merge resolution**
  - [x] Create worktree `tmp/worktrees/comments-cm-c0` on branch `feat/comments-cm-c0` from `origin/feat/comments-annotations-model`.
  - [x] Merge `origin/spec/comments-annotations-port`.
  - [x] Merge `origin/feat/cluster-mesh-storage-k1`.
  - [x] Resolve merge conflict in `BRANCH.md` using `plan/BRANCH_TEMPLATE.md`.
  - [x] Verify frozen M1 files are unchanged (`docs/comments-annotations/contract/contract-v1.json`, `docs/comments-annotations/contract/freeze-receipt.md`, `packages/comments/src/**`, `packages/comments/tests/**`).
  - [x] Complete merge commit.

- [x] **Lot C0 — Compatibility manifest & M1 preservation test**
  - [x] Read §17 row C0 and confirmation `.h2a/l3a/l3a_v4_confirmation.md` (G1–G5).
  - [x] Test-first: implement `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts` pinning M1 source hashes and verifying compatibility manifest.
  - [x] Implement `docs/comments-annotations/contract/storage-module-v1.json`.
  - [x] Implement `docs/comments-annotations/contract/storage-compatibility.md`.
  - [x] Run typecheck and test targets: `make test-cluster-mesh SCOPE=tests/comments-contract-boundaries.spec.ts API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
  - [x] Verify existing comments and cluster-mesh test suites pass.

- [x] **Lot C0FIX — Opus NO-GO remediation**
  - [x] Re-merge `origin/feat/cluster-mesh-storage-k1` at `471628c19` (m7).
  - [x] Align step-1 docs with frozen L3a v4.1 §18.2 on `spec/comments-annotations-port` (`1daad605c`, `d5cada404`), re-merge into C0 (M6).
  - [x] Fix manifest/doc/BRANCH.md (B1, M1, M2, M4, m2-m4).
  - [x] Fix boundary test (B1, M1-M3, M5, m1-m2), validate via Make, push, CI green, write `.h2a/build/c0_fix_report.md`.

- [x] **Lot C0FIX2 — Opus r2 remediation**
  - [x] Align step-1 docs on `spec/comments-annotations-port` (commits `6bbc2f959`, `c3518c2de`), push to origin (a-m7).
  - [x] Merge `spec/comments-annotations-port` into `feat/comments-cm-c0` (MAJ-1).
  - [x] Remove vacant missing sub-case in boundary test (a-m2).
  - [x] Enhance G3 decoupled runtimes scan to check relative cross-package imports (a-m3).
  - [x] Replace direct import of frozen comments source in boundary test with file parsing (a-m4).
  - [x] Add transport semantics §11.3 (canonical bytes, paging semantics, whole history rule, proposed host bounds, escaping/multibyte requirement) in manifest and doc (a-m5).
  - [x] Correct paths and document test-first debt / BR-C0-EX4 in BRANCH.md (a-m1, a-m6).
  - [x] Replace local file reference in storage-compatibility.md with normative frozen spec reference (a-m8).
  - [x] Historical validation/push/report completed at `300dc5a40`; r3 supersedes the report's alignment claims (corrected by C0DOCS).

- [ ] **Lot C0DOCS — Complete r3 documentation and guard remediation**
  - [x] Restrict root/storage import guards while allowing the optional comments leaf (R3-m2).
  - [x] Align SPEC contract/ownership/transport boundaries and add a tracked frozen-source reference.
  - [x] Align SPEC and two-lane plan phase gates, C4 inventory, diagram and installed PG acceptance.
  - [ ] Sweep every non-frozen comments document and SPEC against the frozen source; preserve historical evidence and M1 bytes (R3-MAJ-1, R3-m6).
  - [ ] Correct confirmation citations, report claims and checklist state (R3-m3–m5).
  - [ ] Prove the document guard detects original backticked phrases and every discovered residue class (R3-m1).
  - [ ] Run scoped C0 tests, cluster-mesh typecheck/full tests and scope checks through Make; verify frozen bytes.
  - [ ] Write `.h2a/build/c0_docs_astra_report.md`, push only this branch and record final PR checks; never merge.

- [x] **Lot N — Final validation & PR**
  - [x] Run `make scope-check API_PORT=9500 UI_PORT=5700 MAILDEV_UI_PORT=1600 ENV=test-comments-c0`.
  - [x] Push `feat/comments-cm-c0` to origin: `git push origin feat/comments-cm-c0`.
  - [x] Open draft PR with stacked note ("depends on #663 and #666") (#667).
  - [x] Generate `.h2a/build/c0_report.md` (untracked).
  - [x] Stop after C0.
