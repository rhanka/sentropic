# Feature: llm-mesh 0.25.0 release train (mesh, gateway, cluster-mesh)

## Objective
- [x] Publish the Claude seat delivery as one coherent release train: llm-mesh 0.25.0 (LOT 1 live-validation fixes), llm-gateway 0.19.5 (mesh ^0.25.0 tuple), cluster-mesh 0.13.3 (widened mesh range), re-frozen selected packaging lock.
- [x] All qualification gates green before merge; publication via CI trusted publishers on the merge tags.

## Scope / Guardrails
- [x] Scope limited to the three train packages, their tests, their fixtures, the root lockfile and this file.
- [x] Make-only workflow; every make command ends with `ENV=test-llm-mesh-release`.
- [x] No direct npm publish; publication is tag-driven through CI only.
- [x] Worktree `tmp/llm-mesh-release-train`, branch `release/llm-mesh-0.25.0-train`.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/enrollment/claude-code.ts`
  - `packages/llm-mesh/src/enrollment/pkce.ts`
  - `packages/llm-mesh/tests/enrollment/claude-code.test.ts`
  - `packages/llm-mesh/tests/enrollment/pkce.test.ts`
  - `packages/llm-mesh/tests/service/local-account-transport-service-claude.test.ts`
  - `packages/llm-mesh/README.md`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/**`
  - `package-lock.json`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `docs/**`
- [x] **Conditional Paths**: none.
- [x] **Exception process**: none required; no forbidden path touched.

## Feedback Loop
- [x] `RT-1` — acknowledge — owner: conductor — Live validation 2026-10-10 (PR #659 feedback CS-48/CS-49) drives this train: bundled OAuth profile moved to `claude.com/cai` with `user:plugins`, and 22-char nonce states are rejected by the approval API ("Invalid request format"); both fixed here with tests. Automated consent click still unproven (owner clicked); loopback http redirect support stays deferred to a follow-up.
- [x] `RT-2` — attention — owner: conductor — npm pack is byte-deterministic (verified: three packs of llm-mesh 0.25.0 produce identical sha256 matching the receipt), so the re-frozen lock integrity equals the bytes CI will publish.

## Implementation plan
- [x] Lot 1 — llm-mesh live-validation fixes: bundled profile v2 (`claude-code-oauth-2.1.296-v1`, authorize `claude.com/cai`, `user:plugins` scope), 32-byte nonce states, tests and README updated.
- [x] Lot 2 — cluster-mesh range widening to `>=0.22.0 <0.26.0`: catalog constant, truth tables, skew invariants, surface snapshots, fixture candidate pin.
- [x] Lot 3 — version bumps llm-mesh 0.25.0 / llm-gateway 0.19.5 (`^0.25.0`) / cluster-mesh 0.13.3, root lockfile entries, re-frozen selected lock from sibling receipts.
- [x] Gates — `make test-llm-mesh ENV=test-llm-mesh-release` PASS 593/593; `make test-cluster-mesh ENV=test-llm-mesh-release` PASS 398/34 skips; `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make build-llm-mesh` PASS; `make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-llm-mesh-release` PASS 63/63.
- [x] Cleanup — `make clean-node-modules ENV=test-llm-mesh-release`; no compose services started.
