# Fix: #861 public contract gaps

## Objective
- [x] Integrate approved topic heads with merge commits and qualify real artifacts and mesh tuple gates without publishing.

## Scope / Guardrails
- [x] Worktree: tmp/worktrees/861-contract-gaps; branch: fix/artifacts-861-contract-gaps.
- [x] ENV=test-861-gaps last; Docker steps use shared flock and make down after each step.
- [x] Main merge and publication require owner GO.
- [x] No rebase, squash, cherry-pick, Python, or attribution trailers.
- [x] Merge commits preserve reviewed histories; the 150-line bound applies to new integration fixes and resolutions.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/**`
  - `scripts/ci/immo-861-*`
  - `Makefile`
  - `docker-compose.immo-861.yml`
  - `.track/**`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml`
  - `.security/**`
  - `api/**`
  - `e2e/**`
  - `docker-compose.test.yml`
  - `package-lock.json`
  - `packages/llm-mesh/**`
- **Exception process**:
  - [x] BR861-EX4: align only the three cluster-mesh qualification PEERS pins and their wiring assertion with artifacts 0.2.0; CI evidence rejected 0.1.3 against >=0.2.0 <0.3.0. Impact: qualification inputs only, no publication trigger or gate removed; rollback: restore these four version literals.
  - [x] BR861-EX1: qualification runner only; purpose: exact-tuple tests under mandatory Compose lock; impact: disposable test services and host harness scope check; rollback: remove qualification wiring. Main-only publishing stays unchanged.
  - [x] BR861-EX2: owner-requested origin/main merge only; preserve #734 and main changes in conditional paths; no integration edits there; rollback: revert the merge.

## Feedback Loop
- [x] BR861-GAPS-EX1: permit the existing isolated Compose runner, platform build, scope check and teardown for test-861-gaps; impact is one additional test environment; rollback removes this environment from the existing guards.
- [x] Candidate remains 0.2.0 per the owner request and r2 single-writer version reservation; no publication.
- [ ] GAPS-1: public executor/types and packed typed example; test packed installation and compilation.
- [x] GAPS-RED: packed example missing; three preparation regression cases fail on missing exports. Regression tests committed before implementation.
- [x] GAPS-1a: example now includes a compiled frozen-shape profile, PG participant with shared policy locks, fence minting and a serialized durable cleanup scheduler with an explicit lifetime/cadence.
- [ ] GAPS-2: correlated preparation inventory/deadlines and bounded safe cleanup; test denial, expiry, shared blobs and retry after cleanup failure.
- [x] GAPS-2a: memory and PostgreSQL stores retain preparation history and atomically invalidate expired attempts before cleanup; metadata uses existing JSON intents without schema or L3 port changes.
- [x] GAPS-2b: public preparation inspection and deterministic batch-bounded cleanup retain shared references/pins, serialize deletion with claims, and surface retryable cleanup debt.
- [x] GAPS-2c: added the real PostgreSQL regression for cleanup winning before a paused finalization; publication must roll back release, pointer and success.
- [x] GAPS-2d: preparation records include unique attempt/invocation/time/deadline metadata; PostgreSQL completion refuses expired/abandoned intents in the same finalization transaction. Cleanup-released pins do not mask the coordinator outcome.
- [ ] GAPS-3: correlated purge pause and claim inspection; test both race orders on PostgreSQL.
- [x] GAPS-3a: added durable claim history inspection and a call-scoped purge deletion adapter with release/finished; no global monkey patch or authority shortcut.
- [ ] GAPS-4: full artifacts unit/integration, lint, freeze, packed example, digests, push and draft PR against feat/immo-861-integration.
- [x] GAPS-INFRA: npm TLS resets reproduced twice in Docker and once on host; added an isolated offline qualification path using read-only external tool dependencies, excluding sibling @sentropic packages. Packed consumer installs archives only.
- [x] INT-17: preserved owner merges #747/#748 at fbda4c3ed without rebasing: typed coordinator/abort fixes, exact Radar 0.19.2 runtime admission, packaged declaration dependency and qualification regressions. Only BRANCH.md conflicted; retain this integration plan and all incoming source/test bytes. L0 freeze and Track remain unchanged.
- [x] INT-16: CI passed all 92 packaging tests, then the generic candidate-install qualifier rejected the stale artifacts 0.1.3 pin. Candidate, post-publication and bootstrap qualification now use 0.2.0; all 22 wiring tests and the full clean-consumer qualification passed with the guarded artifacts receipt, including every runtime entry point.
- [x] INT-15: CI carries an artifacts 0.2.0 sibling receipt while the committed selected lock intentionally pins published 0.1.4. Verify the installed file's version/SRI against the verified receipt; retain train registry-lock checks and reject missing, stale, remote or tampered entries. Four guard tests and all 92 packaging tests passed with both real sibling receipts; frozen selected lock bytes remain unchanged.
- [x] INT-14: preserved the owner's concurrent integration merge 59e6b4e7f (#744) without rebasing: publication invocation correlation/S3 observer hooks and 26 real boundary tests. Only BRANCH.md conflicted; retained this integration plan. L0 freeze and Track remain byte-identical.
- [x] INT-13: CI installed-comments probe rejected the reserved mesh 0.22.0 candidate against its own <0.22.0 descriptor. Admit 0.21/0.22 and retain the 0.23 refusal; 43 registry tests passed. Rebuilt packed bare-consumer root/storage/disabled-comments/missing-peer checks all passed under shared-lock Compose cleanup.
- [x] INT-12: packed round-trip uses trusted invocations and caller keys, rejects forged scope and invalid files, and reads content through the retained public runtime. Core-only (platform absent), kernel and both driver adapters passed under Compose; UTF-8 bytes, scope, CORP and zero fetches verified.
- [x] INT-11: packed/core-only probes now construct the guarded host from installed exports and catalogue only the compiled selection; retain the global 15-name contract and optional-platform absence checks.
- [x] INT-10: CI artifacts unit/integration gates passed, then the packed consumer failed with invalid compiled profile. Add a fresh-store host using installed public L6 exports; migrate the isolated consumer without relaxing validation or optional-peer checks.
- [x] INT-9: migrated mesh fixtures reproduced three invalid-argument failures because their placeholder artifact IDs violate L6's UUID schema. Use valid fixture IDs; keep schema and rejection assertions unchanged.
- [x] INT-8: mesh surface reproduced 17 failures / 4 passes because L7 fixtures omitted L6's required compiled profile. Migrate fixtures to selected capabilities and trusted invocations; preserve rejection/idempotency assertions.
- [x] INT-7: route test-861-int platform builds through the existing qualification Compose service with the frozen toolchain snapshot; preserve the #734 producing recipe byte-for-byte. Add a make entrypoint for the package freeze-types script.
- [x] INT-6: merged approved L6 e67a978f9; retained integration plan and L6 compiled MCP capability selection. Ported main's UTF-8 MCP regression to the trusted invocation API. Frozen L0 files and Track journal remain byte-identical.
- [x] INT-2: origin/main merge conflicts only in BRANCH.md; retain this integration plan. Track journal is byte-identical to the pre-merge integration head.
- [x] INT-3: restored the frozen build-mcp-platform recipe; retained P1 packed graph verification passed (30 files, 54 edges) inside the isolated Compose runner, without regenerating evidence.
- [x] BR861-EX3: root lock workspace metadata follows the artifacts/mesh candidate versions; no dependency resolution change; rollback with candidate manifests.
- [x] INT-4: reserved artifacts 0.2.0 and mesh 0.22.0 candidate manifests per spec r2 sections 5.2/6.1; registry baselines are 0.1.4/0.21.2. Platform 0.4.0 and mcp-auth 0.2.2 are reused; no publication or L8 acceptance claim. Artifacts build and 11 MCP tests passed.
- [x] INT-5: aligned selected fixture declarations with its retained published artifacts 0.1.4 entry; source tuple checks pass (4 tests; 3 installed checks await their dedicated runner). Mesh surface passes 21 tests. Full local packaging reached a registry 404 for llm-mesh 0.27.1; CI's verified sibling path remains required.
- [x] L0: owner accepts external CI failure tracked in #734.
- [x] L3: owner accepts 157f231d5; type convergence is now integrated through the approved L6 head.
- [x] Merge policy: retain integration BRANCH.md; report each source conflict separately.
- [x] L5 brings reviewed Track events; preserve them without editing. The L5 scope check reported advisory failures because the initial train plan forbade Track; this plan now permits preservation of the approved history.
- [x] INT-1: full installed packaging reproduced 90 passes / 1 failure at types-and-bundlers.spec.ts:82. The old optional-peer-only assertion rejected L7's declared platform digest import. Require the exact two runtime edges and the artifacts-only declaration edge; no runtime change.

## AI Flaky tests
- [x] No flaky acceptance granted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: one integrator; merge order L0, L1, L2, L3, L4, L5, L7, L6.

## UAT Management (in orchestration context)
- [x] No UI changes; real package and service tests are the qualification scope.

## Plan / Todo (lot-based)
- [x] Lot 0 — merge d41f47092 (contracts).
- [x] Lot 1 — merge 0c71291a2 (profile); only the topic plan conflicted.
- [x] Lot 2 — merge b29b6a334 (failures); only the topic plan conflicted.
- [x] Lot 3 — merge 157f231d5 (coordinator); only the topic plan conflicted.
- [x] Lot 4 — merge a8df25634 (publication/collection); only the topic plan conflicted.
- [x] Lot 5 — merge c703afc68 (MCP/HTTP); only the topic plan conflicted.
- [x] Lot 7 — merge eae0c261a (mesh surface/tuple); only the topic plan conflicted.
- [x] Lot 6 — merge e67a978f9 (approved transport/type convergence); resolved plan, MCP names and MCP tests.
- [x] Requalification — artifacts: 431 unit tests / 33 files; 102 PostgreSQL/MinIO integration/E2E tests / 10 files; lint and freeze-types passed.
- [x] Requalification — mesh: surface 21 passed; stateful conformance 1 passed; typecheck passed. Full installed packaging: 91 passed / 15 files, including artifacts tuple 7, tuple skew 14 and types/bundlers 17; no skips.
- [x] Requalification — source 982401708; guarded sibling receipt regenerated for that SHA; every Docker step used shared flock and test-861-int Compose cleanup. L0 freeze, Track and protected main/#734 files remain byte-identical to 34d467972.
- [x] Final post-#744 qualification — 431 unit tests / 33 files, 128 real integration/E2E tests / 11 files, lint and freeze-types passed. Mesh surface 21, stateful 1, registry 43 and full packaging 92 / 15 files passed; the latter includes both guarded artifacts/llm-mesh receipts and has no skips. Every Docker step used the shared lock and Compose cleanup.
- [x] PR #738 was automatically marked merged by GitHub after integration; added the requested comment: merged via integration #739. PR #739 stays open; CI is monitored on its final pushed head.
- [x] Qualification — make test-artifacts: 407 passed, 31 files; source tree at 818b6c509; build passed; make down passed.
- [x] Qualification — make test-artifacts-integration: 94 passed across 10 files against real PostgreSQL/MinIO; build and make down passed.
- [x] Qualification — make lint-artifacts: 0 errors, 0 warnings; make down passed.
- [x] Qualification — mesh artifacts-surface.spec.ts: 21 passed, 1 file; make down passed.
- [x] Qualification — full test-lazy-package: 91 passed, 15 files; artifacts-tuple: 7 passed; tuple-skew: 14 passed; types-and-bundlers: 17 passed.
- [x] Handoff — branch pushed; draft PR [#739](https://github.com/rhanka/sentropic/pull/739) targets main; all seven approved merges retained; no new lot defects observed in the requested gates.
