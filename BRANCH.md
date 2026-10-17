# Feature: Cluster-mesh OAuth composition for Immo (O1)

## Objective
- [ ] Deliver additive MCP auth leaves, typed OAuth composition and a qualified twelve-tool consumer contract for Immo; preserve address, issuer, accounts and consent.
- [ ] Deliver cluster-mesh 0.20.0 as a draft PR; never merge or publish. Immo owns restore and i-cond owns Radar adoption.

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-oauth-o1`, worktree `tmp/worktrees/cluster-mesh-oauth-o1` (existing repository convention); harness branch check passed; clean baseline containing #679.
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
  - [x] `packages/cluster-mesh/tests/modules/{capabilities,registry,namespace-loading,topology-ranges}.spec.ts`; `packages/cluster-mesh/tests/loaders/mcp-auth.spec.ts`; `packages/cluster-mesh/tests/integrations/mcp-auth-surface.spec.ts`.
  - [x] `packages/cluster-mesh/tests/mcp-oauth-*.spec.ts`; `packages/cluster-mesh/tests/packaging/{prepare.sh,types-and-bundlers.spec.ts,mcp-oauth-consumer.spec.ts}`.
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/{package.json,package-lock.json}`; `packages/cluster-mesh/tests/packaging/fixtures/mcp-oauth/**` (typed consumer, manifest and generated lock).
  - [x] `.github/workflows/ci.yml` (three cluster-mesh qualification mcp-auth pins only); `scripts/ci/publishable-ci-wiring.test.mjs` (matching peer string only), authorized BR125-EX3/R1.
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`; `docker-compose*.yml`; `.cursor/rules/**`; `rules/**`; agent instructions; other branch plans; `.track/**`; credentials and backup payloads.
  - [x] `packages/cluster-mesh/src/storage/**`; `packages/cluster-mesh/assets/**`; `packages/cluster-mesh/src/comments/**`; `packages/cluster-mesh/src/live*/**`.
  - [x] `packages/cluster-mesh/src/compose/mcp.ts`; `packages/cluster-mesh/src/mcp/registry.ts`; `packages/cluster-mesh/src/token-exchange.ts`; `packages/cluster-mesh/src/trust/token-exchange-http.ts`.
  - [x] `packages/{auth-hono,mcp-auth,oauth-verify,mcp-platform,llm-gateway,llm-mesh}/**`; `api/**`; `ui/**`; `apps/**`; `deploy/**`; all Radar files.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `PLAN.md` (conductor registration, BR125-EX1); `packages/cluster-mesh/src/modules/{registry,topology-guard-mcp}.ts` (evidenced auth preflight gap, BR125-EX2); `packages/cluster-mesh/packaging.mk` (evidenced runner gap, BR125-EX3).
- [x] **Exception process**:
  - [x] Record reason, bounded impact and rollback before conditional edits; existing packet authorizations apply. No speculative exceptions.

## Feedback Loop
- [x] `acknowledge` BR125-D1: reviewed O1 design and R1-R6 binding; no new plan review required. OAUTH-RESTORE-T3 is offline-only; live injection blocked and non-gating; T4/T6 accepted, T8 withdrawn, T7 operational only.
- [x] `acknowledge` BR125-EX3/R1: three CI cluster-mesh auth peer pins 0.2.1 -> 0.2.2 plus wiring assertion and selected/ OAuth fixture manifests/locks are authorized; reason: new static floor; impact: qualification only; rollback: revert with OAuth leaves. Gateway service-auth floor unchanged.
- [x] `acknowledge` R4: relax new ingress client restriction; bind optional signed azp/client_id when present, reject conflicts, and restrict originating client at exchange only. No new immo-mcp-only ingress denial.
- [ ] `attention` BR125-FL1, release maintainer/conductor: #684 merge/publication and single-writer ordering before O1 final rebase; select free minor above main/npm, retain #685 ranges if merged first; closure: base SHA and registry tuple receipts. Local archives are not publication.
- [ ] `attention` BR125-FL2, i-cond: Radar main >=7a2a1daf contains #869 T2 and #870 T1/T3/T5; #866 must rebase, then #865 onto R-O1. Supply registry adapter, account resolver and real service Make runner; retain server.test.ts twelve-tool/scope checks plus server-http/session, data-source, raw-data, discovery and deployed-baseline tests.
- [ ] `attention` BR125-FL3, i-cond/T3 owner: defect on Radar main: bascule.mjs:723 and bascule-preprod.yml:545-553 check only O_MIGRATE/O_RESTORE/O_DOCS. Wire O_RECON/O_FLIP; allow skipped flip only for SKIP_FLIP=true; refuse other skipped/cancelled/missing outcomes. Offline recon/flip failure tests plus workflow-to-CLI assertion required; no Radar edit here. O1 can ship; cutover acceptance waits.
- [ ] `attention` BR125-FL4, IdP operator/i-cond: record immo-mcp required_acr values in preprod/prod; optional requiredAcr fails closed at MCP ingress. Exchange drops acr/amr/auth_time; receiver cannot enforce human assurance. Policy changes remain owner decisions.
- [ ] `attention` BR125-FL5, IdP operator/i-cond: provision via `make oauth-provision-exchange-client`, rotate via `make oauth-rotate-service-client CLIENT_ID=immo-mcp-workload`; distinct per-environment secrets. Record owner-selected cadence and variable/.env custody; rotate after every IdP DB restore. Identity sync copies exchange_policy prod -> preprod with host rewrite, never secret hashes; no sync during quiesce.
- [ ] `attention` BR125-FL6, Immo operations: positive exchanged search_signals receipt in each environment before #865 strict activation; tenant restore/DR and existing-connection/browser smoke remain required. Never consumer-rollback to raw bearer after strict activation.

## AI Flaky tests
- [x] Accept only non-systematic provider/network/model nondeterminism, with a success on the same commit/command; document signature, command and file and obtain owner sign-off before merge. Never inflate timeouts.
- [x] O1 authentication tests are deterministic/blocking; no AI generation tests apply. Network/package-install failures are not flaky passes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one O1 writer, sequential lots; harness rebase discipline supersedes legacy cherry-pick wording.
- [ ] **Multi-branch**: not selected; existing Radar/#684/#685 owners retain their lanes.
- [x] Rationale: one additive package capability; no new delegation or plan review.

## UAT Management (in orchestration context)
- [ ] Qualify the integrated candidate; bind source SHA, exact SDK/Hono/jose/platform/auth tuple and archive hashes. Keep automated tests in this worktree.
- [ ] Execute local package UAT in Lot 5; external Radar/IdP/restore receipts remain owned pending items, never completed cutover acceptance.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read current rules (legacy .mdc absent), README, TODO/PLAN, reviewed branch plan and template; verify branch mechanically and check ps-all/disk.
  - [x] Read feasibility v4 and owner decisions; npm cluster-mesh=0.18.0 via container npm view, candidate=0.20.0; original ranges mesh<0.27/gateway<0.21/auth>=0.2.1 retained; #684 rebase dependency recorded. Recheck ports before listeners.
  - [ ] Prepare manifest-context.json from real branch diff/CI filters before manifest gates. API/UI/E2E test edits: none.
- [ ] **Lot 1 — Optional auth leaves and typed loaders**
  - [x] Auth loader contracts RED: missing loader import; static leaves/loaders/catalog and provider-identity tests now implemented; verification pending.
  - [ ] Add static mcp/auth + mcp/auth/hono, typed loaders/barrel, selected-only >=0.2.2 <0.3.0 topology guard, explicit exports/sideEffects; preserve provider identity and gateway >=0.2.1 floor.
  - [ ] Package tests updated: modules/capabilities.spec.ts, registry.spec.ts, namespace-loading.spec.ts, topology-ranges.spec.ts; new loaders/mcp-auth.spec.ts and integrations/mcp-auth-surface.spec.ts. Cover disabled/missing/skew/export failures, shared loads and selected-only evaluation.
  - [ ] Scoped gates: `rtk make test-cluster-mesh SCOPE=tests/loaders/mcp-auth.spec.ts API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; repeat for integrations/mcp-auth-surface.spec.ts and tests/modules.
  - [ ] Gate: `rtk make typecheck-cluster-mesh lint-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`. UI/E2E files: none.
- [ ] **Lot 2 — Metadata, request authority and sessions**
  - [ ] Implement oauth-contracts/context/sessions and compose/mcp-oauth; public canonical PRM plus aliases, 401/403 challenges, exact issuer/audience, requiredAcr, per-tool scope/current-account checks and preflight before listen.
  - [ ] Preserve existing compose/mcp. Reuse registry policy/bridge/result codec. Bind immutable request authority with leaf-local AsyncLocalStorage; no trusted headers or captured/shared bearer; defaults idle 30 min/absolute 8 h.
  - [ ] New tests/mcp-oauth-composition.spec.ts and mcp-oauth-sessions.spec.ts: positive/negative ACR, mounts, live scopes/account, owner POST/GET/DELETE uniform 404, overlap, cancellation/SSE, expiry/restart/close. Existing unchanged: mcp-composition.spec.ts and mcp-registry.spec.ts.
  - [ ] Scoped gate: Lot 1 test command with SCOPE=tests/mcp-oauth-composition.spec.ts, then sessions, existing composition and registry; same typecheck/lint gate. UI files: none.
- [ ] **Lot 3 — Controlled exchange egress and service proof**
  - [ ] Implement oauth-egress using existing exchange/HTTP contracts; tool-bound profiles only, immutable trusted origin/audience/method/path/scopes/params, no URL/header/token getter, no redirects; invalidate retained/cancelled capabilities.
  - [ ] New tests/mcp-oauth-egress.spec.ts: positive exchanged API bearer, no passthrough, isolation, path attacks, outage/cache bounds, cancellation/redaction; retain all six tests/token-exchange*.spec.ts and O2 races.
  - [ ] New tests/mcp-oauth-http.spec.ts: loopback issuer/MCP/independent API verifier, real Basic RFC8693 + SDK, positive search, inverse audiences, same client automatic reinitialization after restart. Synthetic keys, port 0 inside container.
  - [ ] Scoped gates: Lot 1 command with SCOPE=tests/mcp-oauth-egress.spec.ts and SCOPE=tests/token-exchange; service gate uses SCOPE=tests/mcp-oauth-http.spec.ts and ENV=e2e-feat-cluster-mesh-oauth-o1. No UI tests.
- [ ] **Lot 4 — Packed API, compatibility and release tuple**
  - [ ] After #684 merge, rebase only onto main; choose target 0.20.0 above registry/main; widen comments self-range only; preserve storage/comments and gateway peer ranges; rerun affected gates.
  - [ ] Update selected manifest and refresh generated lock via `rtk make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; root lock via lock-root only if actual root resolution changes require it.
  - [ ] Add mcp-oauth fixture manifest/lock and exact typed twelve-tool host adapter; pin SDK and Hono to Radar lock patches (^1.32.1 / ^4.13.13). Retain ordinary SDK1.31.0/Hono4.10.7 and gateway-only floor0.2.1 tests.
  - [ ] New packaging/mcp-oauth-consumer.spec.ts; update prepare.sh and types-and-bundlers.spec.ts: strict NodeNext/Bundler compile, installed ESM/HTTP, bare root/unused loader isolation, static/selected auth floor and skew refusals. Retain full existing packaging matrix.
  - [ ] Gate: `rtk make typecheck-cluster-mesh lint-cluster-mesh pack-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`.
  - [ ] Manifest gate: `rtk make check-publishable-manifests MANIFEST_CONTEXT_FILE=.tmp/cluster-mesh-oauth-o1/manifest-context.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; then pack-candidate-siblings with PACKAGE=cluster-mesh and SIBLING_DIR=tmp/ci-manifest-guard/siblings/cluster-mesh, same context/ports/env.
  - [ ] Packed gate: `rtk make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`.
  - [ ] Clean qualification: `rtk make qualify-published-install TARBALL=<candidate> SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json PEERS=<CI-list-with-mcp-auth0.2.2> REPORT_DIR=tmp/ci-manifest-guard/qualify-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`.
  - [ ] Comments regression: `rtk make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-test CM_COMMENTS_TARBALL=<candidate> API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`. UI files: none.
- [ ] **Lot 5 — UAT and consumer/restore handoff**
  - [ ] Package HTTP: read PRM and aliases unauthenticated; inspect canonical 308/resource/issuer/scopes; POST without bearer ->401 and insufficient ingress scope ->403 with canonical metadata; mount exactly once at /mcp.
  - [ ] Package MCP: initialize approved synthetic user, list twelve tools, exercise search/raw/stub/schema results; change token/scopes, overlap calls, reject foreign-owner POST/GET/DELETE, expire/restart/reconnect.
  - [ ] i-cond hosted MCP: unchanged preprod URL/client/consent/account, automatic reconnect and twelve tools, exchanged search_signals plus raw-data; bind candidate image digest. Repeat prod receipt before strict receiver.
  - [ ] i-cond browser: login/renewal/status screens, T1 missing-account no renewal, T5 suspended+pending invitation stays suspended. Existing Radar server.test.ts inventory/scopes, server-http/session, discovery, deployed baseline, raw-data/data-source; new mesh parity/exchange/service tests.
  - [ ] Immo restore: complete manifest/checksum/G1/G2/annotation guards, normal restore then MCP fresh-exchange/raw/login smoke, isolated empty-target DR, reconcile later suspensions/admin removals; record hashes/times. T3 offline recon/flip/wiring proof pending with i-cond; live injection remains blocked/non-gating.
  - [ ] Sentropic web/Chrome/VSCode code/tests unaffected; no application test/build campaign. Gate: local package UAT complete; external receipts explicitly pending.
- [ ] **Lot 6 — Docs consolidation**
  - [ ] Update README, CHANGELOG and existing lazy-surface spec with exact typed API/tuple, Node-only compose leaf, 2FA boundary, secret rotation/custody, policy sync/cache bound, tenant state/restore and R-O1/#865 sequence.
  - [ ] Write `.h2a/build/o1_report.md`: changes, checks, owned feedback, risks, scope exceptions and read set; no secrets or messages to others. Gate: docs match packed types; no duplicate issuer/recovery spec.
- [ ] **Lot 7 — Final validation**
  - [ ] Run `rtk make typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; reuse final-SHA passing gates, document intentional environment gating.
  - [ ] Run `rtk make test-mcp-auth test-oauth-verify API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; auth core/hono/prm/challenge/scopes/application-scopes/service-auth/manifest and oauth verifier/JWKS/DPoP existing tests unchanged.
  - [ ] Update three CI qualification pins and wiring test; scoped `rtk make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`.
  - [ ] Before every commit: `rtk make scope-check API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; review every hunk. No new plan review per packet; required implementation review remains separate from plan approval.
  - [ ] Push origin feat/cluster-mesh-oauth-o1, create DRAFT PR with exact BRANCH.md body and 3-6 step first comment, monitor CI and fix branch failures. Never merge/publish/remove plan to simulate acceptance.
  - [ ] Cleanup per lot/final: `rtk make down ps API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-cluster-mesh-oauth-o1`; repeat e2e env; leave no owned services.
