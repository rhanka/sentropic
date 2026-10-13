# Feature: Cluster-mesh generic storage port lots K1 then K2a (L3a v4 common)

## Objective
- [x] Deliver K1 data-pure contracts then K2a test-only reference and shared corpus in packages/cluster-mesh.

## Scope / Guardrails
- [x] Scope limited to cluster-mesh storage kernel contracts (K1) and test-only reference plus corpus (K2a).
- [x] Make-only workflow, no direct Docker commands.
- [x] Root workspace ~/src/sentropic is reserved for user dev/UAT (ENV=dev) and must remain stable.
- [x] Branch development happens in worktree tmp/worktrees/cluster-mesh-storage-k1.
- [x] Automated test campaigns run on ENV=test-cm-storage, never on dev.
- [x] In every make command, ENV=test-cm-storage passed as last argument with API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595.
- [x] All new text in English.
- [x] Zero Python.
- [x] Engram stays neutral (cluster-mesh imports engram-live, never the inverse).
- [x] Frozen comments M1 and merged engram L6a identity contract unchanged.
- [x] Version proposal 0.15.0 recorded below, package not published (0.14.0 taken by feat/live-git-l6a-s).

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/cluster-mesh/package.json`
  - [x] `package-lock.json`
  - [x] `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md`
  - [x] `packages/cluster-mesh/src/storage/contracts.ts`
  - [x] `packages/cluster-mesh/src/storage/authority.ts`
  - [x] `packages/cluster-mesh/src/storage/atomic.ts`
  - [x] `packages/cluster-mesh/src/storage/profiles.ts`
  - [x] `packages/cluster-mesh/src/storage/descriptor.ts`
  - [x] `packages/cluster-mesh/src/storage/staged-units.ts`
  - [x] `packages/cluster-mesh/src/storage/readers.ts`
  - [x] `packages/cluster-mesh/src/storage/errors.ts`
  - [x] `packages/cluster-mesh/tests/storage/reference-store.ts`
  - [x] `packages/cluster-mesh/tests/storage/reference-state.ts`
  - [x] `packages/cluster-mesh/tests/storage/atomic-corpus.ts`
  - [x] `packages/cluster-mesh/tests/storage/authority-corpus.ts`
  - [x] `packages/cluster-mesh/tests/storage/chain-corpus.ts`
  - [x] `packages/cluster-mesh/tests/storage/read-corpus.ts`
  - [x] `packages/cluster-mesh/tests/storage/reference.spec.ts`
  - [x] `packages/cluster-mesh/tests/storage/mutations.spec.ts`
  - [x] `.h2a/build/k1_k2a_report.md`
  - [x] `.h2a/build/k1_corev_report.md`
  - [x] `.h2a/build/k1_r3_report.md`
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `plan/NN-BRANCH_*.md` (except this branch file)
  - [x] `packages/comments/**`
  - [x] `packages/cluster-mesh/src/live*/**`
  - [x] `packages/cluster-mesh/src/comments/**`
  - [x] `packages/cluster-mesh/src/modules/**`
  - [x] `packages/cluster-mesh/src/runtime/**`
  - [x] `.h2a/inputs/**`
  - [x] `.h2a/reviews/**`
  - [x] `.env`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
- [x] Exception process:
  - [x] Declare exception ID BRxx-EXn in Feedback Loop before touching any conditional/forbidden path.
  - [x] Include reason, impact, and rollback strategy.
  - [x] Mirror the same exception in this file under Feedback Loop.

## Feedback Loop
- [x] `CI-666-1` — validate-cluster-mesh ENOENT on stale `file:../sentropic-cluster-mesh-0.13.3.tgz` after the 0.15.0 proposal; fixture and lock re-pointed to 0.15.0 via `refresh-lazy-package-lock`, `test-lazy-package` 63/63 green locally.
- [x] `BR-K1C-EX1` — K1+K2a share one branch with 22 files vs twelve-file §17.4 budget; combined review requested in one pass; rollback by splitting K1C follow-ups per lot if required.
- [x] `BR-K1C-EX1-RAT` — BR-K1C-EX1 ratified: combined review delivered in one pass (engram Sol rounds 1-2, Opus review of PR #666); no split required.
- [x] `BR-K1R3-EX1` — Historical discipline deviations already pushed (5 commits over 150 lines: 36c70c715, 325eb11fc, 56acb484a, 6e3bd68fe, fd8134101; 9 K1 commits without BRANCH.md from 09770777a to 6e3bd68fe); history immutable after push; all R3 commits stay under 150 lines with BRANCH.md in-commit; rollback not applicable.
- [x] `R3-RED1` — RED batch 1 (atomic conversions plus identical replay, authority and chain typed codes); observed failing pre-implementation, details in k1_r3_report.
- [x] `R3-RED2` — RED batch 2 (guard and rollback codes, opaque read cursors, envelope budget, retained-boundary disposal); observed failing pre-implementation, details in k1_r3_report.
- [x] `R3-RED3` — RED batch 3 (persisted values, aggregate-version and predicate guards, unsupported-effect rejection); observed failing pre-implementation, details in k1_r3_report.
- [x] `R3-RED4` — RED batch 4 (K1R3 validator tests, stale-update rollback, rebound replay pin); MIN2/MIN3 observed failing pre-fix, details in k1_r3_report.

## AI Flaky tests
- [x] No AI flaky tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick (default for orthogonal tasks; single final test cycle)
- [x] Rationale: single worktree builds K1 then K2a sequentially on one branch.

## UAT Management (in orchestration context)
- [x] Mono-branch: no UI surface, no UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Baseline and constraints
  - [x] Read co-owner BRIEF-K1-K2a and L3a-spec-v4-common 17.1 plus referenced contract sections.
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, plan/BRANCH_TEMPLATE.md.
  - [x] Read packages/cluster-mesh README and src.
  - [x] Confirm frozen comments M1 and merged engram L6a identity contract unchanged.
  - [x] Confirm branch feat/cluster-mesh-storage-k1 from origin/main.
  - [x] Check make ps-all with API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage last.
  - [x] Define environment mapping (test-cm-storage) and ports for this branch.
  - [x] Confirm command style: make ... API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage with ENV last.
  - [x] Confirm scope and guardrails.
- [x] Lot K1 — Profile contracts, authority, atomic/read/staged protocols, descriptor/SPI, error mapping (types and validators only, data-pure, no backend)
  - [x] Named RED tests first for profiles, authority, atomic, staged-units, readers, descriptor, errors, contracts.
  - [x] Implement packages/cluster-mesh/src/storage/contracts.ts.
  - [x] Implement packages/cluster-mesh/src/storage/profiles.ts.
  - [x] Implement packages/cluster-mesh/src/storage/authority.ts.
  - [x] Implement packages/cluster-mesh/src/storage/atomic.ts.
  - [x] Implement packages/cluster-mesh/src/storage/staged-units.ts.
  - [x] Implement packages/cluster-mesh/src/storage/readers.ts.
  - [x] Implement packages/cluster-mesh/src/storage/descriptor.ts.
  - [x] Implement packages/cluster-mesh/src/storage/errors.ts.
  - [x] Write spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md for K1 scope.
  - [x] Lot gate:
    - [x] make typecheck-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [x] make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [x] K1 exit commit recorded.
- [ ] Lot K2a — Test-only in-memory reference plus atomic, authority, chain, read corpus
  - [x] Implement packages/cluster-mesh/tests/storage/reference-state.ts (test-only).
  - [x] Implement packages/cluster-mesh/tests/storage/reference-store.ts (test-only).
  - [x] Implement packages/cluster-mesh/tests/storage/atomic-corpus.ts.
  - [x] Implement packages/cluster-mesh/tests/storage/authority-corpus.ts.
  - [x] Implement packages/cluster-mesh/tests/storage/chain-corpus.ts.
  - [x] Implement packages/cluster-mesh/tests/storage/read-corpus.ts.
  - [x] Implement packages/cluster-mesh/tests/storage/reference.spec.ts executing the corpus against the reference.
  - [x] Implement packages/cluster-mesh/tests/storage/mutations.spec.ts with discriminating recorded mutations.
  - [ ] Lot gate:
    - [ ] make typecheck-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [ ] make test-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [x] K2a corpus executed against the test reference.
    - [x] Discriminating mutations recorded.
    - [ ] K2a exit commit recorded.
- [ ] Lot K1C — Co-review fixes for K1/K2a rejection
  - [x] Fix 1 local live without product triplet plus partial-triplet rejection.
  - [x] Fix 2 parsed-instant expiry for grants and leased snapshots.
  - [x] Fix 3 atomic staging with persisted records and updates.
  - [x] Fix 4 allocation check plus CAS conflict codes.
  - [x] Fix 5 forged-grant authenticity via issued grants.
  - [x] Fix 6 stable head-bound reads plus full encoded-byte budget.
  - [x] Fix 7a async atomic and chain corpus with structural ports.
  - [x] Fix 7b async read and authority corpus with injected fixtures.
  - [x] Fix 8 discriminating mutations preserving valid cases.
  - [x] Fix 9 branch file-budget exception recorded above.
- [ ] Lot R3 — Round-3 fixes for engram Sol-2 REJECT and Opus NO-GO
  - [x] R1 persisted record and aggregate values asserted in full.
  - [x] R2 bound grant and scope deep-copied and frozen at bind.
  - [x] R3 budget measured on full encoded page including envelope.
  - [x] R4 disposal resume from a retained non-null boundary.
  - [x] MAJEUR-1 opaque cursors plus typed code and outcome assertions.
  - [x] MAJEUR-2 disposed chain reads return inaccessible.
  - [x] MAJEUR-3 aggregate-version and predicate guards plus unsupported-effect rejection.
  - [ ] MAJEUR-4 mutations M6-M15 recorded, M5 propagation claim corrected.
  - [x] MINEUR-1 page validator allows absent continuation and full encoding.
  - [x] MINEUR-2 unparseable nowIso refused for grants and snapshots.
  - [x] MINEUR-3 triangle rejects blank and NUL identities per L6a.
  - [x] MINEUR-4 scope-level idempotency with divergent-content conflict.
  - [x] MINEUR-5 bound-scope snapshot comparison in the reference.
  - [ ] MINEUR-6 discipline deviations recorded under BR-K1R3-EX1.
  - [ ] MINEUR-7 BRANCH gates, v4.1 headers and allowed paths fixed.
- [ ] Lot N — Final validation
  - [ ] Typecheck and Lint
  - [ ] Retest cluster-mesh
  - [x] Bumped packages/cluster-mesh/package.json version to 0.15.0 (proposal, not published).
  - [x] make scope-check API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
  - [x] Final gate step 1: push branch and open DRAFT PR to main using BRANCH.md text as PR body (never merge).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [x] Write .h2a/build/k1_k2a_report.md with K1 exit SHA and K2a exit SHA.
