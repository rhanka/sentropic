# Feature: W2.b app registry dispatch and artifact HTTP

## Objective
- [ ] Mount the compiled cluster-mesh registry and APP-P1 HTTP on one durable artifact host.

## Scope / Guardrails
- [x] Base W2.a `247015eba` merged with W1.d `8729aff22`; merge commits only.
- [x] Merge approved W1.b `79a6a968c` fixture-shutdown correction; no production composition override; Track log blobs identical across all three bases.
- [x] Worktree `tmp/worktrees/app-w2b`; branch `feat/app-cm-w2b`; draft base `feat/app-cm-integration`.
- [x] Read Docker lock, complete plan-v2 and W0-close.d reservations; sole root/API lock writer.
- [x] Make-only; builds, tests and starts take shared Docker flock; teardown after each step.
- [x] Tests first; ENV=test-app-w2b last; API/UI/Maildev ports 8796/5182/1089; no dev.
- [x] Selective staging; scope-check before make commit; authored commits under 150 lines; no trailers.
- [x] Preserve MCP auth, connectors/resources, supervisor and single author/generation.
- [x] Activation stays closed; W3 owns activation/content/image/infrastructure.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/app.ts`
  - `api/src/routes/namespaces/mcp.ts`
  - `api/src/routes/namespaces/resources.ts`
  - `api/src/routes/namespaces/resources-module.ts`
  - `api/src/routes/namespaces/artifacts.ts`
  - `api/src/services/artifacts/transport.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/src/services/artifacts/instance.ts`
  - `api/src/services/artifacts/composition.ts`
  - `api/src/services/artifacts/lifecycle.ts`
  - `api/tests/api/artifacts-host-recovery.test.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/services/cluster-mesh-adapter.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package.json`
  - `package-lock.json`
  - `api/vitest.config.ts`
  - `api/tsconfig.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] Exception process: BR02B-EXn records reason, impact and rollback before expansion.

## Feedback Loop
- [ ] W1.b P2: verify OAuth tuple, scopes, expiry and revocation with DB time after waits.
- [x] W2.a P2 reconciliation: API artifacts uses file workspace; root lock removes private registry copy; TS/Vitest artifacts aliases removed.
- [ ] W2.a P2 installed proof: api/tests/api/app-mcp-installed.test.ts runs Node/tsx outside Vitest resolution; final strict install pending.
- [x] Bundle red: production esbuild settings refused the loaded profile with invalid compiled artifacts profile; /tmp/app-w2b-focused1.log.
- [x] API build keeps artifacts and cluster-mesh external, preserving physical runtime instances and package topology guards.
- [ ] Retry failed pushes every ten minutes; draft PR after push; no merge.
- [ ] Independent final-head reviews and remote CI remain separate receipts.

## AI Flaky tests
- [x] No AI calls or timeout increases planned; no accepted flakes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent final-head review.

## UAT Management (in orchestration context)
- [x] API-only; browser/Chrome/VSCode acceptance remains W3/W4/W5.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check and merge W1.d; freeze scope and environment.
- [x] Lot 1 tests authored first in api/tests/api/artifacts-host-credentials.test.ts; current OAuth/session authority.
- [x] Lot 1 reader: locked session/OAuth tuple, consent, audience, proof key and DB-time expiry; validation pending.
- [x] Test fixture uses allowed id_token substitution and waits for physical PG connection closure before drop.
- [x] Lot 2 manifests/locks regenerated strictly without peer overrides; API leaf metadata refreshed to source versions.
- [ ] Lot 2 strict install/physical compilation final receipt.
- [x] Lot 3 tests authored in api/tests/api/app-artifacts-transport.test.ts; exact dispatch, denial, HTTP and MCP routing.
- [x] Lot 3 durable test: HTTP session ensure and OAuth MCP replay, MCP publish and HTTP replay; assert one artifact/release and two receipts.
- [x] Current-reader vectors include matching/wrong DPoP proof, revocation during artifact-row waits and expiry during quota waits for both credential kinds.
- [x] Lot 4 core: compiled exact-name dispatch and bounded APP-P1 HTTP adapter delegate to W1 host.
- [x] Lot 4 singleton: one durable PG host with dedicated private S3, explicit quota and default-closed activation.
- [x] Lot 4 mount: verified credential tuples, shared MCP supervisor guard, resources author and /resources/artifacts/*; 28 namespaces retained.
- [x] MCP transport is acquired through the cluster-mesh loader; Drive/Gmail ports and original URLs remain mounted.
- [ ] Lot 5: focused tests, relevant regressions, API typecheck/lint/build.
  - [ ] api/tests/api/{app-mcp-registry,artifacts-host-publication,artifacts-host-recovery,artifacts-host-migrations,mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory}.test.ts.
  - [ ] Resource/gateway/D1/auth suites selected from actual filenames.
  - [ ] Strict install and physical package-resolution inventory without aliases.
  - [ ] Runtime logs and locked make down ENV=test-app-w2b; no remaining services.
- [ ] Lot 6: exact-head evidence and W3 handoff; scope check; push; draft PR using this body.
