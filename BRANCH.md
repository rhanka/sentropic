# Feature: Decision V4-L4 Kev native local candidate

## Objective
- [x] Implement owner-selected Kev Q8_0 through a fixed local System One transport in `@sentropic/llm-mesh/decision`.

## Scope / Guardrails
- [x] Owner decision 2026-10-28: L4-A, local native llama.cpp; no Python.
- [x] Branch `feat/decision-v4l4`, base `origin/main`, worktree `tmp/worktrees/decision-v4l4`.
- [x] Make-only; shared Docker flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock` for containers, downloads and inference.
- [x] `ENV=test-decision-l4` last; API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097; teardown after campaigns.
- [x] Store model once in ignored `tmp/cache/decision-v4l4` in the primary checkout; delete nothing else.
- [x] Runtime hosting outside library; fixtures in default CI; no model download or inference by default.
- [x] Atomic commits at most 150 lines; make commit; no trailers; merge only, never rebase.
- [x] Draft PR to main; retain BRANCH.md; verify completed successful CI on exact head.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/decision/**`
  - `packages/llm-mesh/src/transport/systemone-local.ts`
  - `packages/llm-mesh/tests/decision-kev*.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/speech-peer.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package*.json`
  - `package-lock.json`
  - `scripts/decision/**`
  - `spec/decision/kev-v4l4-candidate.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` under BR04-EX1 only.
  - `.github/workflows/**` remains unchanged.
- [x] **Exception process**: declare rationale, impact and rollback before edits.

## Feedback Loop
- [x] BR04-EX1 (Makefile): include `scripts/decision/kev-local.mk` for explicit opt-in local targets; no default dependency; rollback removes include and targets.
- [x] Track single writer: update this source artifact only; conductor owns sidecar import.
- [ ] Independent peer review awaits owner permission required by `rules/subagents.md`; no agents launched and no consensus claimed.
- [x] Native smoke attempt 1 stopped in local inventory verification before POST; diagnose custody without inference, then use the two remaining smoke attempts for binary/choice; graded remains fixture-covered.
- [x] Source LFS tuple verified 2026-10-28: selected revision/file, 4483801504 bytes, SHA-256 7c2ebed90560522c2801389db482ac1dc4c36d828f201f6074c1d60e433948da; model card Apache-2.0.
- [x] Upstream archive distribution attestation cryptographically verified with pinned GitHub CLI 2.103.3; publication workflow provenance recorded separately from unverified compilation reproducibility.
- [x] CI install regression resolved: gateway/cluster compatibility, guards and train fixtures admit additive mesh 0.32; root lock and exact UI Docker manifest subset pass npm ci dry-run. Gateway 1370 tests and cluster 1225 tests pass; frozen lock binds actual candidate archives. Rollback restores this compatibility tuple with the mesh bump.

## AI Flaky tests
- [x] No flaky acceptance or timeout increase planned; protocol failures block completion.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; author implements; independent peers review the completed diff.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Library-only surface; no web, Chrome or VSCode UAT required.
- [x] Local native smoke evidence and fixture receipt verification passed; binary/choice receipts verified; graded fixture coverage.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, V4 spec, dossier and merged L3/L5 contracts; harness branch check passed.
  - [x] Confirm published mesh version 0.31.0; feature bump will be 0.32.0.
- [x] **Lot 1 — Immutable runtime and artifact manifest**
  - [x] Pin upstream native CPU release/source/archive; verify provenance, licence and model LFS source before use.
  - [x] Add opt-in Make provisioning target; one shared cache; verified native archive contents.
- [x] **Lot 2 — Inventory and descriptor**
  - [x] Bind file, revision, bytes, quantization, runtime archive/readout and compilation into evaluator definition.
  - [x] Keep shipped candidate unqualified; explicit local qualification composition only.
- [x] **Lot 3 — Fixed local transport**
  - [x] Verify host inventory and single served native model before/after one System One POST.
  - [x] Bound request, response, timeout and cancellation; reject redirects and identity gaps without replay; explicit positive local call-rate tariff.
- [x] **Lot 4 — Native adapter and host exports**
  - [x] Compile typed binary/choice/graded questions and validate pinned native output, independent usage and identity.
  - [x] Preserve host allowlist, receipt, budget and qualification gates; no general chat registration.
- [x] **Lot 5 — Fixture acceptance**
  - [x] `packages/llm-mesh/tests/decision-kev-inventory.test.ts`: P26 wrong file/revision/hash/runtime and P27 execution changes.
  - [x] `packages/llm-mesh/tests/decision-kev-transport.test.ts`: fixed endpoint, identity, redirects, bounds, cancellation.
  - [x] `packages/llm-mesh/tests/decision-kev-routing.test.ts`: P28 no egress, native kinds and served-model receipt.
  - [x] Scoped make test-llm-mesh passed all 38 Kev fixtures; public feature-version assertion updated for 0.32.0.
- [x] **Lot 6 — Local native qualification**
  - [x] Download exact selected model once; validate all bytes and pinned runtime before inference.
  - [x] Three attempted calls total: one inventory refusal before POST, then binary/choice successes; receipts, 4.45 GiB RSS and cache recorded in spec; native process stopped and make down completed.
  - [x] Report calibration/production limits separately from protocol evidence.
- [x] **Lot 7 — Documentation and publication**
  - [x] Consolidate manifest, provenance gaps, bounded cost plan and runtime update/rollback in `spec/decision/kev-v4l4-candidate.md`.
  - [x] Bump mesh package and lock to 0.32.0, above npm published version 0.31.0 verified 2026-10-28.
- [ ] **Lot 8 — Final validation and draft PR**
  - [x] Compatibility gate: cluster catalog/train/registry/topology fixtures and selected consumer lock follow mesh 0.32, gateway 0.22.2, cluster 0.23.5; typecheck/tests for both consumers and Docker install subset dry-run pass.
  - [x] make typecheck-llm-mesh, lint-llm-mesh, test-llm-mesh (90 files / 1569 tests), build-llm-mesh under flock.
  - [ ] Two-peer review; reconcile findings and verify final scope.
  - [x] Draft PR #820 opened to main with this plan as body; first comment records execution steps and local evidence.
  - [ ] Exact-head CI completed/success; report PR URL and head; leave draft unmerged.
