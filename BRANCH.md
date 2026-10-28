# Feature: Decision V4-L4 Kev native local candidate

## Objective
- [ ] Implement owner-selected Kev Q8_0 through a fixed local System One transport in `@sentropic/llm-mesh/decision`.

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
  - `packages/llm-mesh/package.json`
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
- [x] Source LFS tuple verified 2026-10-28: selected revision/file, 4483801504 bytes, SHA-256 7c2ebed90560522c2801389db482ac1dc4c36d828f201f6074c1d60e433948da; model card Apache-2.0.

## AI Flaky tests
- [x] No flaky acceptance or timeout increase planned; protocol failures block completion.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; author implements; independent peers review the completed diff.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Library-only surface; no web, Chrome or VSCode UAT required.
- [ ] Local native smoke evidence and fixture receipt verification required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, V4 spec, dossier and merged L3/L5 contracts; harness branch check passed.
  - [x] Confirm published mesh version 0.31.0; feature bump will be 0.32.0.
- [ ] **Lot 1 — Immutable runtime and artifact manifest**
  - [x] Pin upstream native CPU release/source/archive; verify provenance, licence and model LFS source before use.
  - [x] Add opt-in Make provisioning target; one shared cache; verified native archive contents.
- [ ] **Lot 2 — Inventory and descriptor**
  - [x] Bind file, revision, bytes, quantization, runtime archive/readout and compilation into evaluator definition.
  - [ ] Keep shipped candidate unqualified; explicit local qualification composition only.
- [ ] **Lot 3 — Fixed local transport**
  - [x] Verify host inventory and single served native model before/after one System One POST.
  - [x] Bound request, response, timeout and cancellation; reject redirects and identity gaps without replay; explicit positive local call-rate tariff.
- [ ] **Lot 4 — Native adapter and host exports**
  - [x] Compile typed binary/choice/graded questions and validate pinned native output, independent usage and identity.
  - [x] Preserve host allowlist, receipt, budget and qualification gates; no general chat registration.
- [ ] **Lot 5 — Fixture acceptance**
  - [x] `packages/llm-mesh/tests/decision-kev-inventory.test.ts`: P26 wrong file/revision/hash/runtime and P27 execution changes.
  - [x] `packages/llm-mesh/tests/decision-kev-transport.test.ts`: fixed endpoint, identity, redirects, bounds, cancellation.
  - [x] `packages/llm-mesh/tests/decision-kev-routing.test.ts`: P28 no egress, native kinds and served-model receipt.
  - [ ] Scoped make test-llm-mesh while evolving these files.
- [ ] **Lot 6 — Local native qualification**
  - [ ] Download exact selected model once; validate all bytes and pinned runtime before inference.
  - [ ] Run at most three protocol/identity smokes through native process plus Docker Node client; record usage, memory/latency, wrong-selection refusal and cache path.
  - [ ] Report calibration/production limits separately from protocol evidence.
- [ ] **Lot 7 — Documentation and publication**
  - [ ] Consolidate manifest, provenance gaps, bounded cost plan and runtime update/rollback in `spec/decision/kev-v4l4-candidate.md`.
  - [ ] Bump mesh package and lock to 0.32.0, above npm published version.
- [ ] **Lot 8 — Final validation and draft PR**
  - [ ] make typecheck-llm-mesh, lint-llm-mesh, test-llm-mesh, build-llm-mesh under flock.
  - [ ] Two-peer review; reconcile findings and verify final scope.
  - [ ] Draft PR body from this plan; first comment records execution steps.
  - [ ] Exact-head CI completed/success; report PR URL and head; leave draft unmerged.
