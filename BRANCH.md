# Feature: Release @sentropic/cluster-mesh 0.26.0 (stable)

## Objective
- [ ] Cut the stable 0.26.0 release from 0.26.0-dev.27 so npm publishes a cluster-mesh whose llm-mesh peer admits 0.38.x (h2a #458).

## Scope / Guardrails
- [x] Worktree tmp/worktrees/cluster-mesh-0260; branch chore/cluster-mesh-0.26.0 from origin/main 5c6db5a08.
- [x] Release convention copied from 0.25.0 (a50c18f91 + c72558e9b): stable version, root/api lock version metadata, selected fixture tarball pin, comments self-range, next-minor refusal test.
- [x] Test env if needed: ENV=test-cm-0260 API_PORT=9182 UI_PORT=5382 MAILDEV_UI_PORT=1282; Make only, ENV last, docker-slot.sh.
- [x] No merge: merging publishes to npm and needs the owner GO via the conductor.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `BRANCH.md`
  - `package-lock.json`
  - `api/package-lock.json`
- **Exception process**:
  - [x] BR0260-EX1: BRANCH.md is execution metadata; dropped before merge; rollback by removing it.
  - [x] BR0260-EX2: cluster-mesh version metadata only in package-lock.json and api/package-lock.json (workspace entries); no dependency resolution change; rollback with the version change.

## Feedback Loop
- [x] Inventory vs published 0.25.0: no removed or remapped export; 13 subpaths added; peers widened (llm-mesh <0.39.0, llm-gateway <0.24.0, auth-hono ^0.18.0); 3 optional UI peers added; runtime dependencies unchanged.
- [x] Behavior notes: pending_admin_approval accounts can be disabled/deleted; ClusterMeshProviderModuleId adds notifications.
- [x] Installed lane (packaging.mk test-lazy-package, ENV=test-cm-0260) on 43c354f64 under host load 18-35: run 1 142/143 (prepare-artifacts frozen-pin case 5000 ms timeout), run 2 141/143 (two consumer-topology cases 5000 ms timeout); every case passed in at least one run; no timeout increase; CI lazy lane is the gate.
- [ ] attention: post-publication follow-up (separate PR, as after 0.25.0): freeze the 0.26.0 consumer closure in scripts/ci/consumer-locks.json, roll RESERVED_NEXT to 0.27.0 and LATEST_PUBLISHED_CLUSTER_MESH to 0.26.0 in both mirrors.

## AI Flaky tests
- [x] No AI-dependent tests.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: single release lane, no sub-agents.

## UAT Management (in orchestration context)
- [x] Library release only; no product surface change.

## Plan / Todo (lot-based)
- [x] Lot 0: rules read, 0.24.0/0.25.0 release commits inventoried, branch verified.
- [x] Lot 1: version 0.26.0, lock and fixture pins, self-ranges <0.27.0, next-minor refusal at 0.27.0, CHANGELOG 0.26.0.
  - [x] Lot gate: scoped cluster-mesh tests, ENV=test-cm-0260: tests/modules 101 pass; tests/packaging 92 pass, 60 installed-only skips; tests/notifications-module.spec.ts 2 pass.
- [ ] Lot N: PR with this text as body, CI green on the exact head, then drop BRANCH.md; merge only on owner GO via the conductor.
