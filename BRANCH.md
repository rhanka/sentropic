# Feature: Train 1b 2026-11-07 A-LIVE api/apps

## Objective
- [ ] One train, one PR, one CI: the A-LIVE api/apps wagons (W1, W3, W4, W5, pod-4live, netpol, MCP takeover L1, h2a CLI OAuth client, service client provisioner, W8, W7, W9) cherry-picked onto main in that order; wagon BRANCH.md edits dropped.
- [x] Integration contract: recipes.ts = W4 + W7 placement; pods.ts = pod-4live resources/volumes/env + W7 namespace/placement, no activeDeadlineSeconds; worker.ts = W8 structure + W3 signatures + W4 environments.
- [x] Frozen: `packages/artifacts/src/live-host` HostLedger and AcceptOptions types unchanged.

## Scope / Guardrails
- [x] Branch train/2026-11-07-alive-1b from origin/main a5d8dee87; worktree tmp/worktrees/train1b; ENV=test-train1b.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build (host disk above 90%).
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `api/src/services/artifacts/transport.ts`
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
  - `api/tests/unit/mcp-client-policy.test.ts`
  - `api/tests/unit/oauth-register-client.test.ts`
  - `api/tests/unit/oauth-register-service-client.test.ts`
  - `api/tests/unit/services/cluster-mesh/github-app-host.test.ts`
  - `apps/artifact-content/**`
  - `deploy/ci/artifact-content/**`
  - `deploy/ci/idp-identity-sync/CRED_CYCLE.md`
  - `docs/secrets.md`
  - `scripts/ci/oauth-service-client-job.test.mjs`
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
  - `Makefile` under BR90-EX4.
  - `deploy/k8s/**` under BR90-EX5.
  - `packages/artifacts/src/server/**`, `packages/artifacts/package.json`, `packages/artifacts/CHANGELOG.md` under BR90-EX6.
  - `packages/cluster-mesh/src/**`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/CHANGELOG.md` under BR90-EX7.
  - `packages/auth-hono/src/oauth/redirect-utils.ts`, `packages/auth-hono/package.json` under BR90-EX8.
  - `package-lock.json`, `api/package-lock.json` under BR90-EX9.
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**`, `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` under BR90-EX10.

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
- [x] BR90-EX10: the cluster-mesh selected packaging fixture follows the candidate tuple: cluster-mesh archive dev.15, same-PR BLOCK siblings artifacts 0.2.21 (guarded sha256 `a8919b4780fa34414ebc664e9ecae57f4efcef25793125bf305b441abad6895b`) and auth-hono 0.18.1 (sha256 `f469a751e6d31b4f2d9b73ed80f1654e3d72198838bfe9783fa5eca0b65b2923`) through `make pack-candidate-siblings` (CI-equivalent pull_request context) and `refresh-lazy-package-lock`; tuple-spec integrity pin updated. Rollback: revert with the bump.

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
- [x] Lot 8: version bumps (artifacts 0.2.21, cluster-mesh 0.26.0-dev.15, auth-hono 0.18.1), lock workspace entries, selected fixture candidate archive name.
- [ ] Lot 9: push, open PR, GLM review of the full diff.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
