# Feature: Fix CI gateway mesh range wait (merged with main sec-zod4 plan; both kept)

## Objective
Fix `wait-llm-gateway-mesh-dependency` so a semver range dependency resolves before publishing llm-gateway.
- [x] Migrate zod 3.25.76 to zod >=4.6.6 across api, UI dependency trees, and packages, closing HIGH memory-exhaustion advisory GHSA-mrhx-c7xc-m3w5.

## Scope / Guardrails
- Scope limited to registry wait for gateway mesh dependency plus the merged zod v4 migration (no feature changes).
- One migration max in `api/drizzle/*.sql` (if applicable; none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktrees (`tmp/worktrees/ci-gateway-wait`, `tmp/worktrees/sec-zod4`).
- Automated test campaigns run on dedicated environments (`ENV=test-ci-gateway-wait`, `ENV=test-sec-zod4`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- 0 Python in repos and jobs. One Docker build at a time machine-wide.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json` (root workspace lock sync for packages/* bumps)
  - `package.json` (root, `overrides` pin only — forces the single v4 line tree-wide)
  - `api/src/**`
  - `api/tests/api/organizations.test.ts` (PR #752 autosave status regression)
  - `api/tests/unit/zod-validator.test.ts` (PR #752 validation response contract)
  - `api/tests/unit/gateway-package-version.test.ts` (candidate gateway version evidence)
  - `api/tests/unit/google-drive-oauth.test.ts` (deterministic tamper test blocking CI)
  - `packages/auth-hono/**`
  - `packages/auth-ui/package.json` (auth-hono 0.17 peer support)
  - `packages/llm-gateway/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/package.json` (auth-hono 0.17 peer support)
  - `packages/cluster-mesh/src/modules/catalog.ts` (auth-hono 0.17 runtime preflight support)
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (candidate version assertions)
  - `packages/cluster-mesh/tests/modules/registry.spec.ts` (auth-hono runtime version boundary)
  - `packages/comments/**`
  - `packages/skills/**`
  - `packages/cluster-mesh/tests/packaging/**` (Zod resolution in the frozen consumer)
  - `packages/cluster-mesh/tests/storage/comments-deps.package.json`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (standalone consumer Zod resolution)
  - `packages/cluster-mesh/tests/comments-contract-boundaries.spec.ts`
  - `docs/comments-annotations/contract/package-zod4-migration.json`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `BRANCH.md`
  - `Makefile` (BR01-EX1, BR01-EX2: Zod pins and Compose-safe verification; gateway mesh range wait)
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-pack.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
  - `.github/workflows/ci.yml` (BR01-EX4: skills validation lane)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `packages/cluster-mesh/packaging.mk`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**` (except the allowed ci.yml exception)
  - `ui/**`
  - `e2e/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BR02-EX1: touch conditional `packages/cluster-mesh/packaging.mk` (`test-lazy-package` only: build workspace llm-mesh/llm-gateway/comments dists before packing them for the pre-publication fallback) plus `packages/cluster-mesh/tests/packaging/{prepare.sh,siblings.mjs,siblings.spec.ts,release-matrix.spec.ts}` (already allowed). Reason: PR CI is circular — the lazy gate installs workspace train versions from the registry, which 404 while their publication is what this PR unblocks. Impact: test-only; no published archive or manifest changes. Rollback: revert the prepare.sh fallback, the `train-spec` command, the spec updates and the added build lines.
- [x] BR01-EX1: touch conditional `Makefile` target `wait-llm-gateway-mesh-dependency` only. Merged resolution: adopt main's `dependencyFloor` recipe (union range resolves to its exact floor; main-CI-green), keep our range-aware `commandWait`/`waitForRange` machinery tested in `publishable-manifests.mjs`. Impact: one recipe line; no other target changed. Rollback: restore the single recipe line from `origin/main`.
- [x] CI run 40322725730 for PR #760: guard gates green (`validate-publishable-manifests`, `validate-llm-gateway`, `validate-llm-mesh`, `enforce-package-bump`, typecheck/lint). One failure: `validate-cluster-mesh` step `Qualify packed Cluster Mesh (lazy surface release gate)` cannot install `@sentropic/llm-gateway@0.21.1` (registry 404, version unpublished). Root cause is the blocked publication this branch unblocks, not this diff: no shared code path (lazy test never imports the guard module; pack steps passed), reproduced locally with the exact failing target. Needs owner decision: merge with override or bootstrap-publish 0.21.1, then re-run.
- [x] Resync #754: preserve live STT 0.28 support and Zod 4/auth-hono 0.17 support together. Main consumes gateway 0.21.1 and cluster-mesh 0.22.2; select free gateway 0.21.2 and cluster-mesh 0.22.3, refresh workspace/API/selected metadata and retain guarded archive integrities.
- [x] Resync #755: preserve all BR-E2-EX1 Make targets, integration triggers, exact-head bump receipts and qualification predicates from main; union the host scope environments. No source, version or Track conflict.
- [x] BR-E2-EX1 resync: owner authorized merge of PR #752; merged main #751 with both Compose packaging runners and all qualification environments preserved. Added test-resync-752 to the existing host scope lane; rollback removes that environment. Reviewed migration code is unchanged.
- [x] CI 40288664433: gateway archive integrity differed because workspace and cold builds emitted different request-receipts.d.ts bytes. Rebuilt all gateway prerequisites in isolated storage with the CI recipe's pinned tools/dependencies; resulting archive SHA-256 3b0ad59cbdf3578a2160181c3f2ffa8bdb7a7106ae1a7f3552b955ee9570573f exactly matches CI. Pin the selected lock to that verified archive's SHA-512.
- [x] CI 40287324395: aligned Cluster Mesh runtime auth-hono preflight with 0.17 support and both API/Cluster Mesh gateway version assertions with 0.21.1. Focused Cluster Mesh boundary/surface tests 55/55 PASS and package build PASS; API version evidence 22/22 PASS. All four endpoint CI shards PASS, including autosave regressions.
- [x] Opus r1 P1: reproduced default injection under Zod 4.6.7; reserve defaults for POST. Added autosave PUT/GET regressions for draft/enriching/completed and explicit status updates in api/tests/api/organizations.test.ts (endpoint CI gate). Only folders/initiatives also use partial schemas; neither contains defaults. No wrapped defaults found in other migrated consumers.
- [x] Opus r1 P2-1: all 25 API router modules use one shared validator hook restoring the exact 400 envelope (success/error/issues/name, no message); JSON/query/success contract tests 3/3 PASS and API typecheck PASS via Compose. Zod 4 issue contents remain the native validation output.
- [x] Opus r1 P2-2: auth-hono 0.17.0 documents the breaking Zod peer change. auth-ui 0.7.7, llm-gateway 0.21.1 and cluster-mesh 0.22.2 widen their peer support; registry predecessors verified (0.7.6/0.21.0/0.22.1). Root/API locks refreshed; standalone API uses the local gateway candidate to avoid its published predecessor's incompatible peer. Three backend package builds PASS. Frozen selected versions/peer metadata and SHA-512 integrities refreshed from guarded auth-hono/gateway archives; exact-head CI validates the installed consumers.
- [x] Resume 2026-10-25: merge origin/main without rebase; preserve the six WIP commits. Track item `01M5PMR6AG9QDZG9H3N57TB3FS`; owner decision verbatim: « Exception datée + migration ».
- [x] BR01-EX2: allow the host scope-check lane for `test-sec-zod4` and an optional comparison base during the main merge. Reason: the default scope checker starts non-Compose containers, forbidden by the Docker packet. Impact: scope checking only; rollback: remove this environment and comparison-base parameter.
- [x] Merge containment: all 342 pre-merge Track event IDs survive; no local Track writes. Main now contains the dated Zod exception and body-parser fix; requalify the resumed migration.
- [x] PR #752 created as draft. Refresh main again to resolve its intervening BRANCH.md update and enable CI; retain this migration plan and all incoming source changes.
- [x] Expanded inventory: 44 API source files, five auth-hono handlers, comments Hono adapter, skills parser; UI/e2e have no direct consumer. Root/API locks resolve 4.6.7; the frozen cluster-mesh selected consumer still resolves 3.25.76 and needs its own lot.
- [x] Transitive inspection: Ollama 1.2.0 (latest published) declares a v3 peer but its runtime validation uses safeParse and the record parses successfully with 4.6.7. No application shim or v3 import introduced.
- [x] CI run 40243669602 reproduces a second independent consumer: comments-deps.package.json installs published comments 0.3.0 into scratch space and resolves vulnerable Zod 3. Pin Zod 4 for this audit/oracle tree and the installed-comments consumer; keep the frozen published peer identity.
- [x] Historical memory qualification lock-snapshots are content-addressed archived evidence, not active workspace install locks; preserve their bytes and hashes.
- [x] BR01-EX3: add the missing guarded skills build/pack lane and register it in the manifest inventory. CI 40243669602 fails because the changed, unpublished skills package has no pack-skills target. Impact: build/pack verification only, no publisher; rollback: remove this lane and its inventory entry. Make the existing pack runner overridable for Compose-only local verification.
- [x] BR01-EX4: wire the skills pack lane into CI and its final gates. Reason: the existing wiring regression requires one validation pack step per registered lane. Impact: additive validation only; rollback: remove the skills filter/job and gate dependencies with its pack registration.
- [x] CI 40244768449 passes the standalone audit and then reports only the frozen comments package-manifest hash mismatch. Preserve contract-v1.json and all 29 original pins; add a dated, digest-bound package migration receipt and verify that reversing exactly the version/Zod changes recovers the original bytes. Contract sources, exports and wire/hash rules stay pinned.
- [x] CI 40245755696 reaches packed consumers: the selected fixture still pins published auth-hono 0.16.0/comments 0.3.0 while same-PR receipts carry 0.16.1/0.3.1. Advance only those fixture entries and record the verified candidate archive integrities, retaining the Zod 4 resolution.
- [x] CI unit failure: google-drive-oauth.test.ts replaces the final signature characters with xx, which can decode to the same bytes as xw; an unchanged valid MAC then reports expiry. Flip a decoded signature byte and pass the test's fixed time so the tamper assertion always exercises authentication.
- [x] CI 40247946287 validates the new fixture pins, then exposes a missing comments substitution in prepare.sh: selected/latest consumers must resolve the same-PR comments archive with the existing verified-sibling resolver, instead of requesting the unpublished registry version.
- [ ] BR01-EX1 (`acknowledge` self): touch `Makefile` (Forbidden Path), pin-only changes of `zod@3.25.76`/`zod@3.23.8` install pins to the v4 line in package typecheck/test targets (skills, auth-hono, llm-gateway, auth-client, cluster-mesh peer tools). Reason: targets hardcode the exact zod version under test; without the pin update the gates keep validating against v3. Impact: version strings in ephemeral `npm install` commands only, no target logic change. Rollback: revert pin strings to v3.
- [x] `acknowledge`: `make scope-check` available (harness CLI installed); run before every commit.
- [x] Previous pause lifted by owner resume on 2026-10-25; merged the main fixes and refreshed the API lock. Current root audit reports zero HIGH/CRITICAL.
- [x] Local API endpoint tests need their normal Compose environment: qualification-only runs stop during env validation without SCW_TEM_SECRET_KEY. Full API/E2E validation runs in PR CI.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single CI fix with one test cycle; merged main sec-zod4 plan kept for traceability.

## UAT Management (in orchestration context)
