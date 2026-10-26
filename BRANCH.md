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
