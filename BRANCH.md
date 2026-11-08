# Feature: Train 1b 2026-11-07 A-LIVE api/apps

## Objective
- [ ] One train, one PR, one CI: the A-LIVE api/apps wagons (W1, W3, W4, W5, pod-4live, netpol, MCP takeover L1, h2a CLI OAuth client, service client provisioner, W8, W7, W9, MCP workspaces_list, CI10 toolbox deps key) cherry-picked onto main in that order; wagon BRANCH.md edits dropped.
- [x] Integration contract: recipes.ts = W4 + W7 placement; pods.ts = pod-4live resources/volumes/env + W7 namespace/placement, no activeDeadlineSeconds; worker.ts = W8 structure + W3 signatures + W4 environments.
- [x] Frozen: `packages/artifacts/src/live-host` HostLedger and AcceptOptions types unchanged.

## Scope / Guardrails
- [x] Branch train/2026-11-07-alive-1b from origin/main a5d8dee87; worktree tmp/worktrees/train1b; ENV=test-train1b.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build (API checks run in the existing node image).
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `api/src/services/artifacts/transport.ts`
  - `api/src/services/artifacts/authorization.ts`
  - `api/src/services/artifacts/instance.ts`
  - `api/src/services/artifacts/workspace-directory.ts`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/services/mcp/client-policy.ts`
  - `api/src/routes/namespaces/mcp.ts`
  - `api/src/routes/github-app.ts`
  - `api/src/routes/artifacts-builder.ts`
  - `api/src/services/cluster-mesh/github-app-*.ts`
  - `api/src/services/secret-crypto.ts`
  - `api/src/services/auth/service-client-provisioning.ts`
  - `api/src/scripts/oauth-register-client.ts`
  - `api/src/scripts/oauth-register-service-client.ts`
  - `api/src/db/control-schema.ts`
  - `api/package.json`
  - `api/tests/api/github-app-*.ts`
  - `api/tests/api/mcp-client-allowlist.test.ts`
  - `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
  - `api/tests/api/mcp-workspaces-list-directory.test.ts`
  - `api/tests/api/mcp-resource-server.test.ts`
  - `api/tests/api/registry-dispatch-terminal.test.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/unit/mcp-client-policy.test.ts`
  - `api/tests/unit/oauth-register-client.test.ts`
  - `api/tests/unit/oauth-register-service-client.test.ts`
  - `api/tests/unit/services/cluster-mesh/github-app-host.test.ts`
  - `apps/artifact-content/**`
  - `deploy/ci/artifact-content/**`
  - `deploy/ci/idp-identity-sync/CRED_CYCLE.md`
  - `docs/secrets.md`
  - `scripts/ci/oauth-service-client-job.test.mjs`
  - `scripts/ci/api-tool-deps-key.mjs`
  - `scripts/ci/api-tool-deps-key.test.mjs`
  - `scripts/ci/api-tool-deps-key-inputs.test.mjs`
  - `ui/tests/nginx-protected-resource.test.ts`
  - `packages/artifacts/tests/**`
  - `packages/auth-hono/tests/oauth/**`
  - `packages/cluster-mesh/tests/heavy-phase-queue.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `.github/workflows/**`
  - `packages/artifacts/src/live-host/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `api/drizzle/control/0021_github_app_enrollments.sql`, `api/drizzle/control/meta/_journal.json` under BR90-EX1.
  - `api/src/app.ts`, `api/src/config/env.ts` under BR90-EX2.
  - `ui/nginx/default.conf` under BR90-EX3.
  - `Makefile` under BR90-EX4 and BR90-EX11.
  - `deploy/k8s/**` under BR90-EX5.
  - `packages/artifacts/src/server/**`, `packages/artifacts/package.json`, `packages/artifacts/CHANGELOG.md` under BR90-EX6.
  - `packages/cluster-mesh/src/**`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/CHANGELOG.md` under BR90-EX7.
  - `packages/auth-hono/src/oauth/redirect-utils.ts`, `packages/auth-hono/package.json` under BR90-EX8.
  - `package-lock.json`, `api/package-lock.json` under BR90-EX9.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR90-EX10.
  - `packages/artifacts/src/mcp-core.ts`, `api/src/services/mcp/cluster-registry.ts`, `api/tests/api/app-mcp-installed.test.ts`, `api/tests/api/app-mcp-registry.test.ts` under BR90-EX12.

## Feedback Loop
- [x] BR90-EX1 (W1, was BR86-EX1): one control migration `0021_github_app_enrollments.sql` and its journal entry (idx 16) for the SG0-app envelope store. Impact: one additive control table. Rollback: revert the W1 commits and drop the table.
- [x] BR90-EX2 (W1, W7 BRW7-EX2): product mounts `/api/v1/github-app` and `/api/v1/artifacts/builder` (one `app.route` line each, optional env values). Impact: both mounts stay absent or default-deny until configured. Rollback: revert the mount lines.
- [x] BR90-EX3 (W1, L1, W7): ui nginx locations for `/api/v1/github-app` and `/api/v1/artifacts/builder` (no query logging) and the RFC 9728 PRM rewrite. Impact: ui image only. Rollback: revert the location blocks.
- [x] BR90-EX4 (provisioner, was BRSVC-EX1): additive Makefile target `oauth-register-service-client-job` and its Job render test in the default `test-publishable-manifests` list. Rollback: delete the target and the list entry.
- [x] BR90-EX5 (netpol BR88N-EX1/EX2, provisioner, W9): per-overlay live edge Ingress NetworkPolicy, the provisioning Job and its postgres NetworkPolicy, the artifact-content live configuration (inert) and the README egress note. Rollback: delete the added objects and their resources lines.
- [x] BR90-EX6 (W5, W8 BRW8-EX1): `@sentropic/artifacts` server GB1 validators and the 900 s live idle deadline; version bump and changelog. Rollback: revert the wagon commits and the bump together.
- [x] BR90-EX7 (W8 BRW8-EX2): `@sentropic/cluster-mesh` durable FIFO heavy-phase queue (one module, one root export); version bump and changelog. Rollback: revert the wagon commits and the bump together.
- [x] BR90-EX8 (h2a CLI OAuth client): `@sentropic/auth-hono` RFC 8252 §7.3 port-less loopback redirect matching for public clients; patch bump 0.18.0 to 0.18.1 keeps every `^0.18.0` consumer range (the package has no changelog). Rollback: revert the commit and the bump together.
- [x] BR90-EX9: root and api lock workspace entries follow the three version bumps (artifacts 0.2.21, cluster-mesh 0.26.0-dev.15, auth-hono 0.18.1; registry latest 0.2.20, 0.25.0, 0.18.0). Rollback: revert with the bumps.
- [x] BR90-EX10: the cluster-mesh selected packaging fixture follows the candidate tuple: cluster-mesh archive dev.15, same-PR BLOCK siblings artifacts 0.2.21 (guarded sha256 `bc3f9b73e697414190063881a308a78697788485e6954f877dc27ab640ebd8d3`, repacked after BR90-EX12) and auth-hono 0.18.1 (sha256 `f469a751e6d31b4f2d9b73ed80f1654e3d72198838bfe9783fa5eca0b65b2923`) through `make pack-candidate-siblings` (CI-equivalent pull_request context) and `refresh-lazy-package-lock`; tuple-spec integrity pin updated. Rollback: revert with the bump.
- [x] BR90-EX11 (CI10 toolbox deps key, was BR91-EX1): Makefile `API_TOOL_DEPS_VERSION` computed by `node scripts/ci/api-tool-deps-key.mjs` and `test-ci-api-tool-cache` runs the two deps-key test files. Train guard: only the workspace `version` field leaves the key (`INERT_FIELDS = ['version']`); lock externals, resolved, integrity and every dependency edge stay hashed. Impact: same `tooldeps-<sha256>` tag shape; the first main run after merge rebuilds the deps base. Rollback: restore the former Makefile line and drop the three scripts.
- [x] BR90-EX12 (PR #945 static-package red, CI run 42428941859): `ARTIFACTS_PROVIDER_VERSION` follows the package version 0.2.21 (the packed-consumer probe requires equality); APP-P1 manifest digest repinned `6faa661d…` to `5150544ae621a22e19b9190b2a4d62c516b75f01afc738ebdea74ea7f97c9e8c` in `cluster-registry.ts` and its API tests (0.2.20 history line kept). The same manifest with version 0.2.20 still gives `6faa661d…`: only the version changed. Impact: APP-P1 compatibility receipts move to the 0.2.21 digest. Rollback: revert with the bump.
- [x] `acknowledge`: workspaces_list host tool (s-archi) is gated by the L1 read-only client allowlist (`isToolPermitted`): the `sentropic-mcp` client neither lists nor calls it until the allowlist policy admits host tools (decision s-archi).
- [x] `acknowledge`: L1 connector admission requires `tid`; `mcp-resource-server.test.ts` route tokens now carry `tid` (test fixture only, the check is unchanged).
- [ ] `attention`: W4 PORTS 6 (pod `/_supervisor/v1/frame` relay) has no `SupervisorChannel.send` implementation in the train yet (W7 open item: product composition of `createBuilderService`); owner W7.
- [x] `attention`: `ARTIFACTS_PROVIDER_VERSION` is 0.2.21 under BR90-EX12: holding it at 0.2.20 failed the packed-consumer probe; tool definitions stay byte-stable and the APP-P1 digest is repinned to `5150544a…`.
- [x] `acknowledge`: W7 (BRW7-EX1, BRW7-EX4) merged W3, W4, W5 and W8; its merge resolutions are carried as two train commits (8.4 evidence at BUILD_QUEUED; W3/W4/W8 tests on string revisions, the streaming cache and the builder placement).
- [ ] `attention`: W4 `api/tests/unit/artifacts-live/bootstrap-server.test.ts:31,34` implicit any under strict test typing (`make typecheck-api` covers `src` only); owner W4.
- [ ] `attention`: not run locally (no local image build): the full API endpoint, smoke and queue suites (`tests/smoke/api-health.test.ts` needs a running API server), artifact-content `process`/`runtime` tests; the PR CI covers them.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branches reviewed separately, integrated into one dated train with one version assignment, one PR and one CI.

## UAT Management (in orchestration context)
- [ ] Exact-head pull_request CI result retained in the PR.

## Plan / Todo (lot-based)
- [x] Lot 1: W1 cherry-picked (tree identical to the wagon on its files); its API suites run in the PR CI (no local API image at 92% disk).
- [x] Lot 2: W3 and W4 cherry-picked without conflict; recipes.ts owned by W4.
- [x] Lot 3: W5 and pod-4live cherry-picked; pods.ts resources from pod-4live; `make test-artifacts SCOPE=tests/build-` 61/61.
- [x] Lot 4: netpol, MCP takeover L1, h2a CLI OAuth client and service client provisioner cherry-picked; `make test-auth-hono SCOPE=tests/oauth` 147/147, `make typecheck-auth-hono`, `make test-publishable-manifests SCOPE=scripts/ci/oauth-service-client-job.test.mjs` 4/4, `make test-artifact-content-manifests` 141 PASS.
- [x] Lot 5: W8 cherry-picked; worker.ts = W8 structure + W3 signatures + W4 environments; `make test-cluster-mesh SCOPE=tests/heavy-phase-queue.spec.ts` 7/7.
- [x] Lot 6: W7 (FIX5) cherry-picked with its W3/W4/W5/W8 merge resolutions carried; recipes.ts placement, pods.ts namespace/placement; artifacts-live 258/258 and live src tsc clean.
- [x] Lot 7: W9 cherry-picked on the live-host subpath; artifact-content live vitest 157/157, tsc clean, `make test-artifact-content-manifests` 145 PASS.
- [x] Lot 8: version bumps (artifacts 0.2.21, cluster-mesh 0.26.0-dev.15, auth-hono 0.18.1), lock workspace entries, selected fixture repin; `make test-artifacts` 967/967, `make typecheck-artifacts`, `make typecheck-cluster-mesh`, `make test-cluster-mesh SCOPE=tests/packaging` 85 pass, `test-lazy-package` with sibling receipts 136/136, `make test-publishable-manifests` 133/133.
- [x] Lot 9: push, open PR #945, GLM review of the full diff (APPROVE on a00797885).
- [x] Lot 10: MCP workspaces_list (5b13de0a6) cherry-picked after L1; transport.ts union (access_denied discovery + read-only filter); registry-dispatch read-only gate; L1 `tid` test fixture; full API `tsc` clean, `lint` 0 errors, API unit 2104 passed (2 pre-existing skips), wagon API files 145/145 with Postgres, 36/37 touched API files (smoke needs a server), ui nginx 3/3, artifacts-live 258/258.
- [x] Lot 11: CI10 toolbox deps key (713372f54) cherry-picked last with the version-only guard; `make test-ci-api-tool-cache` 25/25 (mutation with the former field list fails 2), `test-ci-dag` 10/10, `test-ci-unit-graph` 7/7, `test-ci-expected-results` 28/28, `test-ci-static` 3/3, `test-ci-performance-report` 8/8, `test-ci-run-metrics` 36/36.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
