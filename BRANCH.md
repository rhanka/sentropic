# Feature: W2.b app registry dispatch and artifact HTTP

## Objective
- [x] Mount the compiled cluster-mesh registry and APP-P1 HTTP on one durable artifact host.

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
  - `api/tests/api/cluster-mesh-resources.test.ts`
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
- [x] BR02B-EX1: extend the existing resources inventory regression for the additive APP-P1 paths; impact is test expectations only; rollback with the artifact route mount.
- [x] W1.b P2: real session/OAuth readers verify tuple, scopes, audience, consent, proof key, expiry and revocation after waits.
- [x] W2.a P2 reconciliation: API artifacts uses file workspace; root lock removes private registry copy; TS/Vitest artifacts aliases removed.
- [x] W2.a P2 installed proof: native Node/tsx uses ESM import resolution from API/mesh and matches physical artifacts paths; production-settings bundle also compiles; 2/2 in /tmp/app-w2b-installed-final.log.
- [x] Bundle red: production esbuild settings refused the loaded profile with invalid compiled artifacts profile; /tmp/app-w2b-focused1.log.
- [x] API build keeps artifacts and cluster-mesh external, preserving physical runtime instances and package topology guards.
- [x] Retried GitHub push every ten minutes until access recovered at 08:29 UTC; branch pushed; no merge.
- [x] Physical leaf receipt /tmp/app-w2b-physical-tree.json: workspace artifacts 0.2.1, mesh 0.22.4, platform 0.4.0, Comments 0.3.1, gateway 0.21.3, llm-mesh 0.28.1; actual comments/gateway/artifacts module loads succeed.
- [x] W3 handoff: reuse productArtifactHost and productArtifactTransport.ready (one compiled exact-name map); extend only /api/v1/resources/artifacts/* for trusted activation; keep the resources author and existing MCP supervisor.
- [x] W3 prerequisite: UP-T artifacts 0.2.3 publication/export/SQL receipt plus W1.c composition; no copied PG algorithm or SQL. Current qualified workspace remains 0.2.1 until that integration is qualified.
- [x] W3 configuration: APP_ARTIFACT_HOST_ENABLED=1 requires explicit APP_ARTIFACT_QUOTA_BYTES and dedicated APP_ARTIFACT_S3_{BUCKET,REGION,ACCESS_KEY_ID,SECRET_ACCESS_KEY}; optional APP_ARTIFACT_S3_ENDPOINT. No memory/filesystem storage fallback.
- [x] W3 packaging: preserve artifacts/cluster-mesh API build externals, add the content entrypoint to the canonical image and verify the pruned physical graph. Keep activation closed until FIRST-IMMO; live origin/CSRF/content/restore qualification remains W3/W5.
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
- [x] Lot 2 strict workspace npm ci passed in the API image; physical and bundled compilation pass without artifacts aliases.
- [x] Lot 3 tests authored in api/tests/api/app-artifacts-transport.test.ts; exact dispatch, denial, HTTP and MCP routing.
- [x] Lot 3 durable test: HTTP session ensure and OAuth MCP replay, MCP publish and HTTP replay; assert one artifact/release and two receipts.
- [x] Current-reader vectors include matching/wrong DPoP proof, revocation during artifact-row waits and expiry during quota waits for both credential kinds.
- [x] Credential red /tmp/app-w2b-credential-final-red.log: session expiry after credential-row wait and revoked required scope with a remaining read scope; 3 failures/20 passes before repair.
- [x] Reader rechecks session expiry after locking and intersects the request-required MCP scopes on every current credential check.
- [x] Current credential/transport/profile suites: 51/51, no errors or skips; /tmp/app-w2b-focused-green.log.
- [x] Lot 4 core: compiled exact-name dispatch and bounded APP-P1 HTTP adapter delegate to W1 host.
- [x] Lot 4 singleton: one durable PG host with dedicated private S3, explicit quota and default-closed activation.
- [x] Lot 4 mount: verified credential tuples, shared MCP supervisor guard, resources author and /resources/artifacts/*; 28 namespaces retained.
- [x] MCP transport is acquired through the cluster-mesh loader; Drive/Gmail ports and original URLs remain mounted.
- [x] Lot 5: focused 51/51; API typecheck; lint 0 errors/219 warnings; API production bundle build; no AI calls/skips.
  - [x] api/tests/api/{app-mcp-registry,artifacts-host-publication,artifacts-host-recovery,artifacts-host-migrations,mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory}.test.ts.
  - [x] 14-file regression run: 164/165 initially; only resource inventory expectation evolved, then that file passed 9/9. /tmp/app-w2b-regressions.log and /tmp/app-w2b-resources-green.log.
  - [x] Exact remaining regression files: cluster-mesh-{resources,gw,gw-native,auth-roots,oauth-roots}.test.ts, session-adoption.test.ts and auth/{session,oauth-revoke-introspect}.test.ts.
  - [x] Strict install and physical package-resolution inventory without aliases; npm ls --omit=dev --all succeeds, /tmp/app-w2b-runtime-tree.json.
  - [x] Full development tree inventory retained in /tmp/app-w2b-workspace-tree.json; diagnostics concern @types/node, Vitest/UI and minimatch development requirements; no runtime dependency errors.
  - [x] Runtime startup logs checked; locked make down and empty make ps ENV=test-app-w2b; /tmp/app-w2b-final-cleanup.log.
- [x] Lot 6 authorship: source evidence and W3 handoff consolidated; mechanical branch/scope checks and atomic make commits.
- [ ] Draft PR using this body against feat/app-cm-integration; publication-disabled CI on the final head.
