# Feature: Cluster-mesh OAuth composition for Immo (O1)

## Objective
- [ ] Deliver additive MCP auth leaves, typed OAuth composition and a qualified twelve-tool consumer contract for Immo; preserve address, issuer, accounts and consent.
- [x] Deliver cluster-mesh 0.20.0 as draft PR #689; never merge or publish. Immo owns restore and i-cond owns Radar adoption.

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-oauth-o1`, worktree `tmp/worktrees/cluster-mesh-oauth-o1` (existing repository convention); harness branch check passed; base/main `1472d961e098908e64ef60b83835af357888d031` contains #679.
- [x] Packet authorizes commits, push and draft PR; selective staging, Conventional Commits via Make, at most 150 changed lines per commit, BRANCH.md updated with each commit.
- [x] BR-125 slot 0: API 9625, UI 5825, Maildev UI 1725; every Make command ends with `ENV=test-feat-cluster-mesh-oauth-o1` (service proof: `ENV=e2e-feat-cluster-mesh-oauth-o1`). Never ENV=dev.
- [x] Make/container workflow with rtk prefix; reuse images, one Docker build machine-wide; ps-all checked, disk 93%; no native Node/npm or timeout inflation.
- [x] #684 is still open at 57eca413; implement isolated contracts first per build packet, then rebase only onto its actual main merge before final qualification. Never merge main, cherry-pick or squash.
- [x] Preserve #679 exchange/O2 and #684 comments/storage; gateway peer widening belongs to #685. One cluster-mesh writer; conductor decides merge order.
- [x] No secrets, token contents, production changes or Radar edits; synthetic credentials only. No new persistence or issuer/browser-RP migration.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`; `.h2a/build/o1_report.md`; local evidence `.tmp/cluster-mesh-oauth-o1/**`.
  - [x] `packages/cluster-mesh/src/mcp/auth.ts`; `packages/cluster-mesh/src/mcp/auth/hono.ts`; `packages/cluster-mesh/src/mcp/oauth-*.ts`; `packages/cluster-mesh/src/compose/mcp-oauth.ts`.
  - [x] `packages/cluster-mesh/src/loaders/mcp/auth.ts`; `packages/cluster-mesh/src/loaders/mcp/auth/hono.ts`; `packages/cluster-mesh/src/loaders/mcp/index.ts`.
  - [x] `packages/cluster-mesh/src/modules/contracts.ts`; `packages/cluster-mesh/src/modules/catalog.ts`; `packages/cluster-mesh/src/modules/topology-guard-mcp-auth.ts`.
  - [x] `packages/cluster-mesh/package.json`; `package-lock.json`; `packages/cluster-mesh/README.md`; `packages/cluster-mesh/CHANGELOG.md`; `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md`.
  - [x] `packages/cluster-mesh/tests/modules/capabilities.spec.ts`; `packages/cluster-mesh/tests/modules/registry.spec.ts`; `packages/cluster-mesh/tests/modules/namespace-loading.spec.ts`; `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`.
  - [x] `packages/cluster-mesh/tests/loaders/mcp-auth.spec.ts`; `packages/cluster-mesh/tests/integrations/mcp-auth-surface.spec.ts`; `packages/cluster-mesh/tests/mcp-oauth-*.spec.ts`.
  - [x] `packages/cluster-mesh/tests/packaging/prepare.sh`; `packages/cluster-mesh/tests/packaging/types-and-bundlers.spec.ts`; `packages/cluster-mesh/tests/packaging/mcp-oauth-consumer.spec.ts`.
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`; `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`; `packages/cluster-mesh/tests/packaging/fixtures/mcp-oauth/**` (typed consumer, manifest and generated lock).
  - [x] `.github/workflows/ci.yml` (three cluster-mesh qualification mcp-auth pins only); `scripts/ci/publishable-ci-wiring.test.mjs` (matching peer string only), authorized BR125-EX3/R1.
  - [x] `packages/cluster-mesh/packaging.mk` (BR125-EX3 focused OAuth fixture qualification/lock refresh; full existing matrix retained).
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`; `docker-compose*.yml`; `.cursor/rules/**`; `rules/**`; agent instructions; other branch plans; `.track/**`; credentials and backup payloads.
  - [x] `packages/cluster-mesh/src/storage/**`; `packages/cluster-mesh/assets/**`; `packages/cluster-mesh/src/comments/**`; `packages/cluster-mesh/src/live*/**`.
  - [x] `packages/cluster-mesh/src/compose/mcp.ts`; `packages/cluster-mesh/src/mcp/registry.ts`; `packages/cluster-mesh/src/token-exchange.ts`; `packages/cluster-mesh/src/trust/token-exchange-http.ts`.
  - [x] `packages/auth-hono/**`; `packages/mcp-auth/**`; `packages/oauth-verify/**`; `packages/mcp-platform/**`; `packages/llm-gateway/**`; `packages/llm-mesh/**`; `api/**`; `ui/**`; `apps/**`; `deploy/**`; all Radar files.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `PLAN.md` (conductor registration, BR125-EX1); `packages/cluster-mesh/src/modules/registry.ts`; `packages/cluster-mesh/src/modules/topology-guard-mcp.ts` (evidenced auth preflight gap, BR125-EX2); `packages/cluster-mesh/packaging.mk` (evidenced runner gap, BR125-EX3).
- [x] **Exception process**:
  - [x] Record reason, bounded impact and rollback before conditional edits; existing packet authorizations apply. No speculative exceptions.

## Feedback Loop
- [x] `acknowledge` BR125-D1: reviewed O1 design and R1-R6 binding; no new plan review required. OAUTH-RESTORE-T3 is offline-only; live injection blocked and non-gating; T4/T6 accepted, T8 withdrawn, T7 operational only.
- [x] `acknowledge` BR125-EX3/R1: three CI cluster-mesh auth peer pins 0.2.1 -> 0.2.2 plus wiring assertion and selected/ OAuth fixture manifests/locks are authorized; reason: new static floor; impact: qualification only; rollback: revert with OAuth leaves. Gateway service-auth floor unchanged.
- [x] `acknowledge` BR125-EX3 runner activation: registry inventory confirms artifacts E404 and auth-hono latest0.15.0, blocking the full selected train fixture. Add focused OAuth-only qualification/refresh using published auth/platform/SDK/Hono tuple; retain full matrix as required/pending. Impact: new optional test target only; rollback: remove target/flag with OAuth fixture.
- [x] `acknowledge` R4: relax new ingress client restriction; bind optional signed azp/client_id when present, reject conflicts, and restrict originating client at exchange only. No new immo-mcp-only ingress denial.
- [x] `acknowledge` BR125-D3: real Radar schemas failed the bridge's bounded configuration profile (bbox tuple/items, missing string maxima). New leaf-local SDK validation preserves original wire schemas/defaults and numeric/tuple constraints; bridge retains JSON byte budget/result codec. Provider interfaces and Radar remain unchanged. Regression: overlap + schema parity tests.
- [ ] `attention` BR125-FL1, release maintainer/conductor: #684 merge/publication and single-writer ordering before O1 final rebase; select free minor above main/npm, retain #685 ranges if merged first; closure: base SHA and registry tuple receipts. Local archives are not publication.
- [ ] `attention` BR125-FL2, i-cond: Radar main >=7a2a1daf contains #869 T2 and #870 T1/T3/T5; #866 must rebase, then #865 onto R-O1. Supply registry adapter, account resolver and real service Make runner; retain server.test.ts twelve-tool/scope checks plus server-http/session, data-source, raw-data, discovery and deployed-baseline tests.
- [ ] `attention` BR125-FL3, i-cond/T3 owner: defect on Radar main: bascule.mjs:723 and bascule-preprod.yml:545-553 check only O_MIGRATE/O_RESTORE/O_DOCS. Wire O_RECON/O_FLIP; allow skipped flip only for SKIP_FLIP=true; refuse other skipped/cancelled/missing outcomes. Offline recon/flip failure tests plus workflow-to-CLI assertion required; no Radar edit here. O1 can ship; cutover acceptance waits.
- [ ] `attention` BR125-FL4, IdP operator/i-cond: record immo-mcp required_acr values in preprod/prod; optional requiredAcr fails closed at MCP ingress. Exchange drops acr/amr/auth_time; receiver cannot enforce human assurance. Policy changes remain owner decisions.
- [ ] `attention` BR125-FL5, IdP operator/i-cond: provision via `make oauth-provision-exchange-client`, rotate via `make oauth-rotate-service-client CLIENT_ID=immo-mcp-workload`; distinct per-environment secrets. Record owner-selected cadence and variable/.env custody; rotate after every IdP DB restore. Identity sync copies exchange_policy prod -> preprod with host rewrite, never secret hashes; no sync during quiesce.
- [ ] `attention` BR125-FL6, Immo operations: positive exchanged search_signals receipt in each environment before #865 strict activation; tenant restore/DR and existing-connection/browser smoke remain required. Never consumer-rollback to raw bearer after strict activation.
- [ ] `blocked` BR125-FL7, release maintainer: artifacts0.1.0 is E404 and auth-hono workspace0.16.0 is unpublished (latest0.15.0). Clean qualification imports all new OAuth leaves but fails existing mcp/artifacts. Publish prerequisites and rerun full packed/clean gates; no unrelated base archives may be substituted as same-PR siblings.
- [x] `acknowledge` Packet review instruction: accepted Opus review and R1-R6 integrated before implementation; "no new review is needed" overrides the generic review skill. No additional peer review or consensus claimed.

## AI Flaky tests
- [x] Accept only non-systematic provider/network/model nondeterminism, with a success on the same commit/command; document signature, command and file and obtain owner sign-off before merge. Never inflate timeouts.
- [x] O1 authentication tests are deterministic/blocking; no AI generation tests apply. Network/package-install failures are not flaky passes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one O1 writer, sequential lots; harness rebase discipline supersedes legacy cherry-pick wording.
- [ ] **Multi-branch**: not selected; existing Radar/#684/#685 owners retain their lanes.
- [x] Rationale: one additive package capability; no new delegation or plan review.

## UAT Management (in orchestration context)
- [ ] Qualify the integrated candidate; bind source SHA, exact SDK/Hono/jose/platform/auth tuple and archive hashes. Keep automated tests in this worktree.
- [x] Execute local package UAT in Lot 5; external Radar/IdP/restore receipts remain owned pending items, never completed cutover acceptance.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read current rules (legacy .mdc absent), README, TODO/PLAN, reviewed branch plan and template; verify branch mechanically and check ps-all/disk.
  - [x] Read feasibility v4 and owner decisions; npm cluster-mesh=0.18.0 via container npm view, candidate=0.20.0; original ranges mesh<0.27/gateway<0.21/auth>=0.2.1 retained; #684 rebase dependency recorded. Recheck ports before listeners.
  - [x] Prepared manifest-context.json from successful CI changes job 117545436005, cross-checked with actual branch diff/current workflow filters (43 package files). API/UI/E2E test edits: none.
- [x] **Lot 1 — Optional auth leaves and typed loaders**
  - [x] Catalog/capability/namespace/range regressions GREEN (68 tests); auth-owner/verifier-owner jose checks added. Expanded scope braces into literal paths because harness reports unsupported brace patterns as unknown.
  - [x] Auth loader contracts RED -> GREEN; actual provider identity preserved through static leaves and loaders.
  - [x] Add static mcp/auth + mcp/auth/hono, typed loaders/barrel, selected-only >=0.2.2 <0.3.0 topology guard, explicit exports/sideEffects; preserve provider identity and gateway >=0.2.1 floor.
  - [x] Package tests updated: modules/capabilities.spec.ts, registry.spec.ts, namespace-loading.spec.ts, topology-ranges.spec.ts; new loaders/mcp-auth.spec.ts and integrations/mcp-auth-surface.spec.ts. Cover disabled/missing/skew/export failures, shared loads and selected-only evaluation.
  - [x] Scoped gates: `rtk make test-cluster-mesh SCOPE=tests/loaders/mcp-auth.spec.ts API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; repeat for integrations/mcp-auth-surface.spec.ts and tests/modules. Passed independently and in the full suite.
  - [x] Gate: `rtk make typecheck-cluster-mesh lint-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` GREEN. UI/E2E files: none.
- [x] **Lot 2 — Metadata, request authority and sessions**
  - [x] Composition GREEN (7 tests) and sessions GREEN (5 tests): current authority/account, exact audience/issuer/client, ACR, overlap/cancellation/SSE and idle/absolute expiry.
  - [x] Shutdown-initialization RED -> GREEN: all transports owned before IDs, capacity includes initialization, close is idempotent. Malformed verifier/issuer readiness RED -> GREEN; no listener needed to expose invalid bindings.
  - [x] Reuse platform policy/bridge/result codec, original twelve-tool schemas/defaults and readonly request context; public handlers receive no bearer and host failures are redacted. Metadata/routes/module share the same owned sessions.
  - [x] New tests/mcp-oauth-composition.spec.ts and mcp-oauth-sessions.spec.ts: positive/negative ACR, mounts, live scopes/account, owner POST/GET/DELETE uniform 404, overlap, cancellation/SSE, expiry/restart/close. Existing unchanged: mcp-composition.spec.ts and mcp-registry.spec.ts.
  - [x] Scoped gate: Lot 1 test command with SCOPE=tests/mcp-oauth-composition.spec.ts, then sessions, existing composition and registry; full suite and typecheck/lint GREEN. UI files: none.
- [x] **Lot 3 — Controlled exchange egress and service proof**
  - [x] Real HTTP exchange proof GREEN; extended with inverse-audience refusals, raw/stub no-exchange and same-client fresh transport after listener/composition restart at the same URL. SDK reports 404; test client reinitializes without new user configuration.
  - [x] Implemented existing bounded exchange cache + controlled egress; three scoped tests GREEN (positive API token, restrictions, outage/retention/cancellation). No redirects/token getter; bounded JSON and close invalidation.
  - [x] New tests/mcp-oauth-egress.spec.ts: positive exchanged API bearer, no passthrough, profile/scope/path restrictions, outage/cache bounds and cancellation; existing token-exchange suites retain identity isolation and O2 races.
  - [x] New tests/mcp-oauth-http.spec.ts: loopback issuer/MCP/independent API verifier, real Basic RFC8693 + SDK, positive search, inverse audiences, same client fresh transport after restart. Synthetic keys, port 0 inside container.
  - [x] Scoped gates: Lot 1 command with SCOPE=tests/mcp-oauth-egress.spec.ts and SCOPE=tests/token-exchange GREEN; service gate SCOPE=tests/mcp-oauth-http.spec.ts and ENV=e2e-feat-cluster-mesh-oauth-o1 GREEN. Full suite includes all six exchange files (82 tests). No UI tests.
- [ ] **Lot 4 — Packed API, compatibility and release tuple**
  - [x] Root workspace lock regenerated strictly in Docker with npm --package-lock-only via local Make wrapper; only cluster-mesh's 0.18.0 -> 0.20.0 version changed. Published gateway/auth0.2.1 fixture GREEN; focused packed suite now 9 tests.
  - [x] Selected fixture manifest/lock refreshed through Make/npm --package-lock-only: only candidate version/path changed (six lock lines), all prior train nodes/pins retained and auth0.2.1 preserved. Full selected installation still requires publication. Published gateway-only floor0.2.1 runtime fixture GREEN.
  - [x] Final frozen archive GREEN (9 installed tests): SDK1.31.0/Hono4.10.7 and Radar SDK1.32.1/Hono4.13.13, platform0.3.0/auth0.2.2/oauth0.1.0/jose5.10.0; same native HTTP/ACR/restart scenario and full NodeNext/Bundler checks. No peer bypass, shims or unpublished base archives; exact SHA256 below.
  - [x] Dedicated loader declarations avoid the MCP barrel's unrelated artifacts type edge; barrel runtime identity also tested. Explicit SDK result annotation fixes portable declarations (TS2742); current ordinary Make SDK1.32.1/Hono4.13.0 is supplemented by the isolated lower-bound proof.
  - [x] Added Make-only focused packed runner and fixture staging with full library checks; refresh via `rtk make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock MCP_OAUTH_ONLY=1 API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; candidate digest recorded separately from generated frozen lock.
  - [x] Installed consumer tests written for full NodeNext/Bundler types, native HTTP/ACR/restart, provider identity, bare unused loader, disabled/missing/old-floor/broken-export refusals and root async-hooks isolation.
  - [ ] After #684 merge, rebase only onto main; choose target 0.20.0 above registry/main; widen comments self-range only; preserve storage/comments and gateway peer ranges; rerun affected gates.
  - [x] Selected manifest/lock regenerated with refresh-lazy-package-lock REFRESH_SELECTED_ONLY=1; OAuth frozen lock with MCP_OAUTH_ONLY=1; root lock regenerated in Docker (only version changed). Re-run after actual #684 rebase.
  - [x] Add mcp-oauth fixture manifest/lock and exact typed twelve-tool host adapter; pin SDK/Hono to Radar lock patches 1.32.1/4.13.13; retain SDK1.31.0/Hono4.10.7 and gateway-only auth0.2.1 proofs.
  - [x] New packaging/mcp-oauth-consumer.spec.ts and prepare.sh/types-and-bundlers.spec.ts updates cover strict types, installed HTTP/ESM, bare unused loader and selected auth refusals. Full existing matrix remains required.
  - [x] Typecheck/lint and real guarded pack GREEN; frozen 0.20.0 archive SHA256=55a604123f4f0dd41df286d8916e9f636ea139f0debaa70628f0a8a7005be10a at tested source checkpoint 0325228a8.
  - [x] `rtk make check-publishable-manifests MANIFEST_CONTEXT_FILE=.tmp/cluster-mesh-oauth-o1/manifest-context.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` GREEN: 22 packages, cluster-mesh only BLOCK, zero errors/four unchanged inventory warnings. pack-candidate-siblings GREEN: no same-PR BLOCK dependencies, empty receipts; no base archives substituted.
  - [ ] Packed gate attempted: `rtk make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` FAIL during frozen selected install: registry artifacts-0.1.0.tgz E404. OAuth/baseline installs compile before the failure and reproduce the frozen archive digest; full matrix remains blocked (BR125-FL7).
  - [ ] Clean qualification attempted with exact CI peer tuple and archive: FAIL, retained in tmp/ci-manifest-guard/qualify-cluster-mesh/qualify-report.json. Core/all new OAuth imports PASS; missing registry artifacts0.1.0 breaks existing mcp/artifacts (BR125-FL7). Rerun `rtk make qualify-published-install TARBALL=<candidate> SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json PEERS=<CI-list-with-mcp-auth0.2.2> REPORT_DIR=tmp/ci-manifest-guard/qualify-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` after publication.
  - [ ] Comments regression BLOCKED by unmerged #684: tests/storage/postgres.mk does not exist on actual main. After rebase run `rtk make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-test CM_COMMENTS_TARBALL=<candidate> API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`. UI files: none.
- [ ] **Lot 5 — UAT and consumer/restore handoff**
  - [x] Package HTTP: read PRM and aliases unauthenticated; inspect canonical 308/resource/issuer/scopes; POST without bearer ->401 and insufficient ingress scope ->403 with canonical metadata; mount exactly once at /mcp.
  - [x] Package MCP: initialize approved synthetic user, list twelve tools, exercise search/raw/stub/schema results; change token/scopes, overlap calls, reject foreign-owner POST/GET/DELETE, expire/restart/reconnect.
  - [ ] i-cond hosted MCP: unchanged preprod URL/client/consent/account, automatic reconnect and twelve tools, exchanged search_signals plus raw-data; bind candidate image digest. Repeat prod receipt before strict receiver.
  - [ ] i-cond browser: login/renewal/status screens, T1 missing-account no renewal, T5 suspended+pending invitation stays suspended. Existing Radar server.test.ts inventory/scopes, server-http/session, discovery, deployed baseline, raw-data/data-source; new mesh parity/exchange/service tests.
  - [ ] Immo restore: complete manifest/checksum/G1/G2/annotation guards, normal restore then MCP fresh-exchange/raw/login smoke, isolated empty-target DR, reconcile later suspensions/admin removals; record hashes/times. T3 offline recon/flip/wiring proof pending with i-cond; live injection remains blocked/non-gating.
  - [ ] Sentropic web/Chrome/VSCode code/tests unaffected; no application test/build campaign. Gate: local package UAT complete; external receipts explicitly pending.
- [x] **Lot 6 — Docs consolidation**
  - [x] Existing lazy-surface spec consolidated with exact inventory/scopes, 2FA and exchange boundaries, tenant state custody, per-environment mint/rotation and post-IdP-restore rule, current Radar baseline/tests and offline recon/flip defect handoff.
  - [x] Update README, CHANGELOG and existing lazy-surface spec with exact typed API/tuple, Node-only compose leaf, 2FA boundary, secret rotation/custody, policy sync/cache bound, tenant state/restore and R-O1/#865 sequence.
  - [x] Wrote `.h2a/build/o1_report.md`: changes, exact archive/tuple, checks including retained failures, owned feedback, risks, exceptions and read set. Docs match packed types; no duplicate issuer/recovery spec.
- [ ] **Lot 7 — Final validation**
  - [x] Exactly three cluster-mesh qualification peer pins and matching wiring constant updated to mcp-auth0.2.2; gateway floor unchanged. Focused CI wiring GREEN (22 tests); startup binding preflight GREEN (7 composition tests).
  - [x] `rtk make typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` GREEN: 73 files / 585 tests passed, 9 files / 53 tests intentionally gated (packed fixtures run separately).
  - [x] `rtk make test-mcp-auth test-oauth-verify API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` GREEN: mcp-auth 73 tests / 8 files and oauth-verify 21 tests / 3 files, including unchanged service-auth, manifest, JWKS and DPoP tests.
  - [x] Update three CI qualification pins and wiring test; scoped `rtk make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` GREEN (22 tests).
  - [x] Before every commit: `rtk make scope-check API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; review every hunk. Accepted Opus review/R1-R6 applied; no new review per packet.
  - [x] Pushed origin feat/cluster-mesh-oauth-o1; DRAFT PR https://github.com/rhanka/sentropic/pull/689 with exact BRANCH.md body and five-step first comment. CI changes/package-bump GREEN; remaining jobs queued/running at checkpoint. Full registry qualification remains blocked BR125-FL7; no green CI/merge/publication claim.
  - [x] Final `rtk make down ps API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1` and e2e equivalent GREEN; no owned services remain. Commit audit: maximum 128 changed lines, no >150-line or >15-file violations.
