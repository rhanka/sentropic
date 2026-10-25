# Feature: #861 L8d complete integration requalification

## Objective
- [ ] Qualify packed artifacts 0.2.0 and cluster-mesh 0.22.0 against the pinned full Radar consumer.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/861-L8d; branch feat/artifacts-861-L8d; no rebase.
- [x] ENV=test-861-int last for final requalification; Compose-only services expose no host ports.
- [x] Shared Docker lock and matching Compose down after every step; no publication.
- [x] Merge 895e67f97 preserves integration 082fe4c60 and #744/#747/#748; Track unchanged.
- [x] Final requalification merges 464581fb8 (#750); preserve this lane plan and all incoming product bytes; Track unchanged.
- [x] Final runner imports exact guarded integration archives and archives the complete Radar frozen-profile head stacked on listKeys; no source overlay.
- [x] New Radar pin contains listKeys but not the old A1/A2 topic SHAs as ancestors; the final receipt identifies the complete selected consumer head instead of asserting old ancestry.
- [x] Final source merge retains deca5422c, the exact guarded candidate pack source; preserve incoming release tooling only, with no product or Track edits.
- [x] Final runner emits compact suite counts, grouped failing case names and diagnostics, exact source/log hashes and candidate receipt hash for classification.
- [x] Final observed blockers: Radar wrong executor entrypoint and unsupported phase-injection seam; classify each failing/skipped case explicitly, including host composition and H3 gaps.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/probe/l8d/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/cluster-mesh/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Requested merge preserves reviewed product changes; new lane edits stay within qualification scope.

## Feedback Loop
- [x] Radar integration b2b802b5 plus acceptance/helper overlay e2e9515; A1/A2 ancestry checked by pin-radar.
- [x] Original PR #746 was already merged at 238ab2959; replacement draft PR #749 targets feat/immo-861-integration for this requalification delta.
- [x] #748 promotes ERESOLVE/TS2307 reproductions to normal assertions; no TODO acceptance.
- [x] The normal lane test target includes both packaging regressions and the real llm-mesh 0.19.2 runtime probe.
- [x] Runner retains per-suite pass/fail/skip counts even when fail-closed validation rejects the suite.
- [x] Standalone aggregate target evaluates delivered shards even when the image or consumer suite gates fail first.
- [x] Initial API setup failed on missing PostGIS; runner overlay now matches pinned Radar postgis/postgis:16-3.4. Initial evidence remains in tmp/l8d/pre-postgis.
- [x] Q1: 31 failed (27 effectiveProfile, 2 purge joints, 2 explicit H3 gaps); Q2: 31 effectiveProfile failures. Acceptance cleanup listKeys("") is a separate Radar test defect.

## AI Flaky tests
- [x] No flaky acceptance; failures and skips prevent qualification.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: this lane owns packed consumer evidence; product and Radar fixes retain their owners.

## UAT Management (in orchestration context)
- [x] Package qualification only; no production activation claim.

## Plan / Todo (lot-based)
- [x] Lot 0 — verify branch and merge complete integration without rebase.
- [x] Lot 1 — rebuilt and packed candidate; strict full-Radar install, archive runtime and declaration compilation pass; normal lane 19/19, zero TODOs/skips.
- [x] Lot 2 — invoked eight Radar suites with gate 1; required cases 73 passed / 72 failed / 5 setup skips. Full host workspace 157 passed / 1 failed.
- [x] Lot 3 — receipt and shard validation reject qualification; evidence updated, scope checked, atomic commits pushed; draft PR #749 carries the delta after merged #746.
- [x] Final 0.2.0 — exact tuple installed strictly, packed smoke and 19 runner tests pass; Q1 0/31, Q2 0/31, acceptance 0/6; final receipt records 71 Radar failures, 2 explicit H3 gaps and 5 Radar setup skips across all invoked tests.
- [x] Final receipt and four-shard aggregate correctly reject missing image/shard evidence; NO-GO is retained; no publication or main merge.

## Deferred to L9
- [x] Published bytes, provenance and activation require separate release gates.
