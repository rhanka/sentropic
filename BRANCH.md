# Feature: Produce exact-candidate L5 manifests and checkpoint evidence

## Objective
- [ ] Assemble the delivered 965c93e3 candidate, retain actual per-case results and produce a strictly verified checkpoint proposal.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/memory-l5-checkpoint; branch feat/memory-l5-checkpoint; successor to #777; rebase onto origin/main before delivery.
- [x] Make-only, shared Docker flock, pinned Node image, API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-memory-l5 last; make down after.
- [x] Preserve P3, L0, catalog and producer bytes; missing evidence blocks; no synthetic CI, owner action or acceptance.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5CP-EX1: bounded Make targets delegate candidate assembly and evidence production to tools; preserve frozen producing recipes. Rollback the new delegation only.
## Feedback Loop
- [ ] #771/#777 final-head CI and independent reviews remain gates; no merge is authorized.
- [ ] P3 broker 0.1.0 lacks reference export; #771 reference 0.2.0 changes the inventory. Reject cross-inventory acceptance.
- [ ] Platform profile/context cases remain subject to the separate #783 adoption and successor-freeze decision.
- [ ] Authenticated owner UAT, detached L0 authorization and role acceptances must come from their authorized actors.
## AI Flaky tests
- [x] No flake waiver, skipped required case or timeout change.
## Orchestration Mode (AI-selected)
- [x] Sequential dependent PRs; author implementation; independent review per harness review skill when reachable.
## UAT Management (in orchestration context)
- [ ] Record the minimal actual owner action or authenticated L6/L8 deferral; do not manufacture either.
## Plan / Todo (lot-based)
- [x] Lot 0: read common/project rules, retained L5 specification, P3 inventory, catalog, existing receipt verifier and latest #777 review.
- [ ] Lot 1: candidate assembly with archive identity, P3/build-receipt binding and immutable output; tests/candidate.test.mjs covers tampering, missing roles and contract drift.
  - [x] Add candidate.mjs: preserve and verify P3 peers/inventory, E4 receipt and every archive; write immutable candidate bytes and sidecar without issuing acceptance.
- [ ] Lot 2: report bundling and checkpoint production; tests/proof-bundle.test.mjs covers absent/duplicate/nonexecuted/failed/skipped/stale/cross-manifest assertions; keep strict receipt rejection.
- [ ] Lot 3: resolve predecessor dispositions against the approved memory-first transfer, preserving all later R2/R7a obligations.
- [ ] Lot 4: scope-check and tooling gate; record review selection, push PR and verify exact-head CI; no publication or merge.
