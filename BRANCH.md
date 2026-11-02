# Feature: artifact parity part 1 integrated on main (R2)

## Objective
Integrate part 1 with published p0b on main: retain D1/D2/D4 and add versions, revert, strict CAS, metadata, edits and D3 transport. IMMO alone activates part 1 after its two qualified switchovers. Publish artifacts 0.2.6 and retain the required mcp-platform 0.4.1 codec extension. Stop after pull_request CI, without merging.

## Scope / Guardrails
- Scope is the semantic union with p0b, the D3 platform codec, host migration/APP-P1 pins and generated Memory L5 inventory, within the allowed paths below.
- Reuse the existing commit/release/current-pointer model; no redesign.
- Make-only workflow, Docker under the single flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, `ENV=test-artifacts-parity` always LAST, `make down ENV=test-artifacts-parity` after; never `ENV=dev`; never `make clean-all`.
- Tests first: retain the p0b and D3 suites; add `parity-r2-profile.test.ts` for independent switches, retained receipts, strict refusals and version/revert lineage.
- Commits: `make commit MSG="..."` only, authored changes <=150 lines each, selective `git add`; retain whole generated data under BRAP-EX1 and push the locally qualified final head.
- All new text in English.
- API boot slot: API_PORT=9686 UI_PORT=5886 MAILDEV_UI_PORT=1786; ENV=test-artifacts-parity.
- Retain the BRLOCK-EX1 policy reference verbatim in this BRANCH.md (required by `scripts/ci/ci-lockfile-installs.test.mjs`, run by required CI job `validate-publishable-manifests`): owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**`
  - `packages/mcp-platform/src/runtime.ts`, `packages/mcp-platform/src/transport/result-codec.ts` (D3 outcome codec only)
  - `packages/mcp-platform/src/tool-configuration.ts` (installed platform version constant only, aligned with the D3 codec release)
  - `packages/mcp-platform/tests/tool-configuration.test.ts` (golden digests containing the installed platform version)
  - `packages/mcp-platform/tests/artifact-result-codec.test.ts`, `packages/mcp-platform/package.json`, `packages/mcp-platform/CHANGELOG.md` (D3 codec tests and release metadata)
  - `packages/mcp-platform/etc/mcp-platform.api.md`, `packages/mcp-platform/etc/mcp-platform-memory.api.md` (generated D3 public result fields and declaration line references)
  - `api/src/services/artifacts/composition.ts` (host store wiring only)
  - `api/src/services/artifacts/host-storage.ts` (journal p0b 0004 and part 1 0005 assets)
  - `api/src/services/mcp/cluster-registry.ts` (APP-P1 pin realignment for artifacts 0.2.6, following PR 878)
  - `api/tests/api/app-mcp-registry.test.ts`, `api/tests/api/app-mcp-installed.test.ts`, `api/tests/api/artifacts-host-publication.test.ts`, `api/tests/api/artifacts-host-migrations.test.ts` (digest/version/journal-count pins only)
  - `BRANCH.md`
  - `tools/memory-mcp-l5/artifacts/**` (generated consumed-contract inventory and retained archives only)
  - `packages/mcp-broker/package.json` (align the private P1 consumer floor with platform 0.4.1)
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts` (explicit 17-tool inventory)
  - `packages/cluster-mesh/tests/packaging/**` (candidate dependency closure and selected fixture refresh)
  - `api/src/services/artifacts/reader-activation.ts` (publication-independent reader authority)
  - `api/tests/api/artifacts-host-activation-store.test.ts`, `api/tests/api/artifacts-reader-activation.test.ts` (historical migration and concurrent activation fixtures)
  - `.github/workflows/ci.yml` (BRAP-EX2: publish platform before its artifacts consumer)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (artifacts publisher dependency gate)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/l0-freeze/**` (frozen L0 contract vectors)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file) — not needed; the artifacts schema migration lives in `packages/artifacts/migrations/`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BRAP-EX1: owner step 3 requires a regenerated immutable L5 inventory. Retain the exact prior manifest/sidecar in history; generate the new manifest, packed closure and whole lock snapshot using make. Generated lock snapshots are retained as complete data artifacts; authored code commits remain below 150 lines.
- BRAP-EX2: owner CI repair option (b) retains platform 0.4.1 because the shared MCP codec must preserve typed D3 errors and commit outcomes. Order artifacts publication after platform; refresh the selected fixture with the existing make target and supply candidate archives to frozen consumers. Impact is bounded to packaging/CI; rollback reverts these changes together, never loosens the codec requirement.

## AI Flaky tests
- Acceptance rule: only non-systematic provider/network/model nondeterminism as `flaky accepted`; never additive timeouts. None expected here (pure unit tests, no AI calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch `feat/artifacts-parity-p0`, one final test cycle)
- [ ] **Multi-branch**
- Rationale: one package, one concern; no orthogonal sub-workstreams.

## Plan / Todo (lot-based)
- [ ] **Fix CI integrate — run 41388209369**
  - [ ] Update and verify the exact 17-name Cluster Mesh artifacts inventory.
  - [ ] Align the selected fixture, frozen candidate installs and package publication ordering.
  - [x] Repair the W1.a upgrade fixture and reader activation causes; retain rejection and concurrency assertions (102 targeted API tests pass).
  - [ ] Run targeted make checks under the single Docker lock, make down, commit, push and observe pull_request CI.
  - [ ] Append evidence under Fix CI integrate in the lane report; stop without merging.
- [ ] **Integrate on main — owner-priority part 1**
  - [x] Verify branch mechanically, read the full lane report and binding R2 design, rebase with semantic union.
  - [x] Retain p0b source authorization, masking, management confirmation, terminal controls and all tests.
  - [x] Renumber part 1 metadata migration to 0005; journal both migrations without gaps.
  - [x] Qualify strict v2 and compatible p0b projections; align artifacts 0.2.6, consumer ranges and APP-P1 pins.
  - [x] Add R2 switchover regression tests before implementation; retain both source/control and editing suites with exact-byte assertions.
  - [x] Implement independent trusted profile/result descriptors, exact typed precondition refusals and replay before strict admission.
  - [x] Add retained-receipt switchover and strict v2 history/revert lineage acceptance tests.
  - [x] Record new release authors and lineage without inventing historical data; expose bounded v2 history and targetReleaseId revert.
  - [x] Initialize ensure metadata in the coordinator transaction, preserve resolved bindings and restrict explicit p0b schemas to their compatible inputs.
  - [x] Preserve strict delete refusals outside the operational finalizer codec and replay historical terminal receipts before new-command validation.
  - [x] Preserve the compatible ensure receipt shape; emit the full ensure summary only in result version 2.
  - [x] Regenerate Memory L5 inventory using make, with no manual digest edits; retain the previous manifest and complete source lock snapshot.
  - [x] Run artifacts and mcp-platform typecheck/test/lint plus API boot under the single Docker lock; make down.
  - [ ] Commit using make, force-with-lease push, mark PR ready, wait for pull_request CI and append the lane report; do not merge.
- [x] **Retained implementation — part 1 and D3**
  - [x] Preserve the original versions/revert, conflict, edits and metadata tests, adapting source assertions to p0b's verified byte payload.
  - [x] Preserve transactional CAS, reauthorization, atomic metadata/quota/receipt writes, lost-COMMIT recovery and complete typed D3 HTTP/MCP outcomes.
  - [x] Preserve p0b get_source, set_access, delete, masking, management confirmation and summary fields.
  - [x] Supersede the failed D3 0.2.5 candidate and stale L5 inventory; retain that CI evidence in the lane report.

## Verification
- [x] Artifacts typecheck/build/lint and 505 unit tests; 225 integration/e2e tests across 14 files.
- [x] MCP Platform typecheck/build/lint and 350 tests; strict extraction of both public API reports.
- [x] Memory L5 lot 1 gate against the regenerated manifest, using the repository make targets.
- [x] Packed Radar/consumer probes; API boot, 65 tests across five host/transport files, and health status/readiness both successful.
- [x] `make down` and empty `make ps`; temporary qualification helpers stay outside the committed scope.
- [x] Mechanical branch check and scope check of the complete PR diff; no deleted tests or branch commit CI-skip markers.
- [ ] Release the Docker reservation, resume its paused waiters, push with a lease, mark PR ready and wait for one pull_request CI on the final head.
- [ ] IMMO activation remains a separate owner-controlled gate after both qualified switchovers; this lane does not merge.
