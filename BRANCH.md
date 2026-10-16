# Feature: immo-861-mcp-registry (Sentropic consolidation: 1a + 2-IdP + 2a)

## Objective
Consolidate origin/feat/mcp-registry-config-codec (1a), origin/feat/auth-token-exchange (2-IdP) and origin/feat/cluster-mesh-token-exchange (2a) onto ONE branch with linear history, then execute the open findings and the next Sentropic lots in spec order on this single branch with ONE PR and ONE final CI cycle.

## Scope / Guardrails
- Scope limited to Sentropic-side immo #861 lots: carried 1a/2-IdP/2a, then 1b-core, 3-policy/4a, 2b-MCP Sentropic support, 4b-leaves (incl. 1b-facade), 5a pages contracts.
- Radar-side lots (861-a/861-b, 2b receiver, PRM) are i-cond owned: do not touch the Radar repo.
- One migration max in `api/drizzle/*.sql`: `0042_immo_token_exchange.sql` only.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/immo-861-mcp-registry`.
- Automated test campaigns on `ENV=test-immo-861-mcp-registry`, never on root `dev`.
- UAT branch/worktree must be commit-identical to the branch under qualification.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/**`
  - `packages/auth-hono/**`
  - `packages/cluster-mesh/**`
  - `packages/connector-host/package.json` (dependency-range only, no source change)
  - `packages/llm-gateway/package.json` (consumer range bump only)
  - `packages/auth-ui/package.json` (version bump only)
  - `api/src/routes/auth/**`, `api/src/routes/namespaces/**`
  - `api/src/services/auth/**`, `api/src/db/schema.ts`
  - `api/src/scripts/oauth-provision-exchange-client.ts`
  - `api/tests/**`
  - `deploy/ci/idp-identity-sync/**`, `deploy/k8s/overlays/preprod/idp-identity-sync/**`
  - `spec/DATA_MODEL.md` (0042 documentation only)
  - `package-lock.json` (lockfile sync only)
  - `.h2a/build/**` (untracked reports only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (except I861-EX1/EX2 below)
  - `docker-compose*.yml`
  - `rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/mcp-auth/**` (main already holds qualified 0.2.2)
  - Radar repository (separate repo, i-cond owned)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file: 0042)
  - `api/drizzle/meta/_journal.json` (0042 journal entry)
  - `api/package.json` (one additive script entry, I861-EX2)
  - `.github/workflows/**` (none touched; any future touch needs a new exception)
- **Exception process**:
  - Declare exception ID `I861-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.
  - Carried exceptions (declared on source branches, now consolidated here):
  - `I861-EX1` (was BR1a-EX3): `Makefile` probe hardening — `test-mcp-platform` builds dist first + `probe-mcp-platform-clean-consumer` target. Reason: R2-M4/R3-m4 packed clean-consumer proof needs a runnable Make target. Impact: two additive Makefile hunks, no existing-target behavior change except the dist-first prereq. Rollback: delete the probe target, restore the old prereq line.
  - `I861-EX2` (was ATX-EX4): `Makefile` + `api/package.json` workload provisioning — `oauth-provision-exchange-client` Make target + `oauth:provision-exchange-client` npm script + `api/src/scripts/oauth-provision-exchange-client.ts`. Reason: M3 protected idempotent creation needs a runnable target. Impact: additive only. Rollback: delete target, script entry and script.
  - `I861-EX3` (was ATX-EX5): search-only narrowing (`api/src/services/auth/oauth-client-seed.ts`, service-policy.sql, fixtures) + `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs` + `lock-integrity.spec.ts` optional-only-absent-sibling follow-through. Reason: M4 downstream scope + m11 path declaration. Impact: no supply-chain gate weakening. Rollback: revert narrowing, restore stricter gate.
  - `I861-EX4` (was BR2A-EX1..EX4): new `packages/cluster-mesh/src/trust/token-exchange-http.ts`, new `tests/token-exchange-integration.spec.ts`, README + CHANGELOG 0.18.0 entries, `catalog.ts` range line + peer range + selected fixtures. Reason: B1/M8/m10/m13 findings. Impact: additive + declared range widening, now inside Allowed Paths. Rollback: not applicable (paths are Allowed on this branch; kept for traceability).

## Feedback Loop
- `attention` I861-F1 (recorded, sign-off batched with the final merge request per conductor decision): 2-IdP m10 e2e flake, non-systematic. Test `e2e/tests/05-usecase-detail.spec.ts:690`, command `test-e2e (group-e, 05 07)`, signature `expect(acquiredByA.status()).toBe(201)` got 409. Same job passed on run `38833429815` at identical product code; rerun `gh run rerun --job 116765363067` concluded success. No branch change touches locking/initiatives/UI; no test or timeout touched.
- `attention` I861-F2 (open, owner: conductor): r4 review of carried 1a work bound to the consolidated head (was bound to `2829fbaa7` on PR #673). Not dispatched yet.
- `acknowledge` I861-F3 (fixed 2026-10-16): run `38873705146` on head `84098e350` failed `test-smoke-restore` at `docker compose stop` with daemon `502 Bad Gateway` before any branch code ran (backup step itself succeeded; delta since the green run was 1 BRANCH.md line). Reran failed jobs with `gh run rerun 38873705146 --failed`: `test-smoke-restore` pass (7m15s), `ci-gate` pass. No branch change involved.
- `attention` I861-F4 (watch, owner: conductor): #662 will publish cluster-mesh 0.16.0 / llm-gateway 0.20.0 / llm-mesh 0.26.0. Current consolidated versions (cluster-mesh 0.18.0, llm-gateway 0.19.6) stay above npm and main today; re-bump above merged main per the Post-Rebase Gate if #662 merges first.
- `attention` I861-F5 (pending, owner: conductor): close #673, #674, #676 with pointer comments after the ONE draft PR opens. Not done yet.
- `attention` I861-F6 (carried, owner: planning conductor): V4-REV1 independent spec review of spec-v6 remains open; not approval of this branch.
- `acknowledge` CMT-GAP1-CLOSED: carried from 2a fix (spec-v3 sha recorded).
- `blocked` none.

## AI Flaky tests
- `e2e/tests/09-chat-org-update-tool.spec.ts:49` (assertion line 167, `toolCallObserved=false`): failed run `38833573638` attempt 1 at `90831b41a`, same-command/same-commit green attempt 2, later green group-d on `cba46c559`. Owner GO + sign-off recorded at `442e034f8` on main. Carried as accepted; no repeat sign-off required.
- `e2e/tests/05-usecase-detail.spec.ts:690` (2-IdP m10): 409 vs 201, same-commit rerun success recorded on the source branch. Unrelated to this branch. Owner sign-off PENDING (I861-F1).
- No other flaky accepted. No timeout inflation anywhere.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single PR, single final test cycle per owner decision 2026-10-16)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: owner decision verbatim: one branch, ONE PR, ONE final CI/review/merge cycle for the whole Sentropic side of immo #861.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/immo-861-mcp-registry`.
  - Push branch before UAT.
  - No Sentropic UI changes in carried lots; hosted-client continuity UAT is owner-executed in 2b.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, consolidation and constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`.
  - [x] Read spec-v6 (`/home/antoinefa/src/sentropic/.tmp/immo-mcp-enablers/spec-v6.md`) §§1-13 and the three fix reports (`.h2a/build/immo_1a_fix3_report.md`, `immo_2idp_fix_report.md`, `immo_2a_fix_report.md`).
  - [x] Confirm worktree `tmp/worktrees/immo-861-mcp-registry` on `feat/immo-861-mcp-registry` from `origin/main` (`6138a8d55`, #675 merged).
  - [x] Confirm environment mapping: `ENV=test-immo-861-mcp-registry`, `API_PORT=9550`, `UI_PORT=5750`, `MAILDEV_UI_PORT=1650`.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm `make ps-all ENV=test-immo-861-mcp-registry` shows no running projects before Docker work.
  - [x] Replay 1a (40 commits), 2-IdP (22), 2a (34) in order as linear history; drop 14 BRANCH-only commits; resolve 4 content conflicts (cluster-mesh 0.18.0 version, root lockfile, selected fixtures, catalog parity comment). Result: 82 commits, 0 merges, clean tree.
  - [x] Verify versions above npm and main: mcp-platform 0.3.0 (npm 0.2.0 / main 0.2.0), auth-hono 0.16.0 (npm 0.15.0 / main 0.15.2), cluster-mesh 0.18.0 (npm 0.15.0 / main 0.15.0), llm-gateway 0.19.6 (npm 0.19.5 / main 0.19.5), auth-ui 0.7.5 (npm 0.7.4 / main 0.7.4). connector-host range-only `^0.3.0`, no bump. mcp-auth untouched (main 0.2.2 stands).
  - [x] Validate scope boundaries and declare I861-EX1..EX4 (carried).
  - [x] Confirm `.track/` untouched by replay (no merge, no event write; branch-lifecycle containment has no applicable artifact).
  - [ ] Lot gate:
    - [x] `make scope-check ENV=test-immo-861-mcp-registry` -> `PASS C2 (sentropic)`

- [ ] **Lot 1 — Carried 1a codec (mcp-platform 0.3.0) + r4/final-CI closure**
  - [ ] Verify carried source: `packages/mcp-platform/src/tool-configuration.ts`, `tests/tool-configuration.test.ts`, `README.md`, `docs/ADOPTION_GUIDE.md` (P5 settled, consumer-local provenance, bounded heuristics).
  - [ ] Retain R3-M1 (`token` family + typed `maxTokens` allowlist), R3-M2 (doc/model delta), R3-m1..m6 proofs from the fix3 report.
  - [ ] Obtain r4 review bound to the consolidated head (I861-F2).
  - [ ] Run final CI on the consolidated PR and require e2e groups + `security-container` green (I861-F3).
  - [ ] Lot gate:
    - [x] `make typecheck-mcp-platform test-mcp-platform api-extract-mcp-platform pack-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> 12 files / 138 passed, pack PASS 0.3.0 (consolidated head)
    - [ ] **API tests**
      - [x] `packages/mcp-platform/tests/tool-configuration.test.ts` (existing, 44 tests incl. R3-M1/m1/m2/m5 regressions)
      - [x] `packages/mcp-platform/tests/manifest.test.ts` (existing regression)
      - [x] `packages/mcp-platform/tests/authz.test.ts` (existing regression)
      - [ ] Scoped runs while evolving: `make test-mcp-platform SCOPE=tests/tool-configuration.test.ts API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
      - [x] Sub-lot gate: `make test-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **UI tests (TypeScript only)**
      - [ ] None for this pure library slice.
    - [ ] **E2E tests**
      - [ ] None for this pure library slice; real consumer parity belongs to 1b-Immo/4b-parity.
    - [ ] UAT (probe, owner-verifiable on this branch):
      - [ ] `make probe-mcp-platform-clean-consumer API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` returns `CLEAN_CONSUMER_OK` with frozen `payloadDigest=81148c5dfeade5f39a71b6bc9eb72082a53a9e5d8a2e741c5470f4cb9a5c8547`, `handlersDigest=163e199a420dd97b7832368ab70bd6e572ca7b03b3d217a686526abeeef206b8`, `compiledDigest=121fbcb194e06a1c66ae6859e9a8aaa60d53c6213dc0c95d8a6e2a47ac58c9b5`, `fetchCalls=0`.

- [ ] **Lot 2 — Carried 2-IdP issuer/workload (auth-hono 0.16.0) + remaining gates**
  - [ ] Verify carried source: `packages/auth-hono/src/oauth/token-handler.ts`, `src/oauth/token-exchange-handler.ts`, `src/oauth/state-store-types.ts`, `src/ports.ts`, `src/oauth/router.ts`, `src/oauth/wellknown-handler.ts`, `api/src/routes/auth/oauth.ts`, `api/src/routes/namespaces/oauth-ingress.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/db/schema.ts`, `api/drizzle/0042_immo_token_exchange.sql` (+ journal + `spec/DATA_MODEL.md`), `api/src/scripts/oauth-provision-exchange-client.ts`, `deploy/ci/idp-identity-sync/**` (creation path, fixtures, CRED_CYCLE).
  - [ ] Retain M1 fail-closed eligibility, M2 subject validation, M3 protected creation, M4 search-only policy, M5 refusal codes, m6/m7/m8 handler hardening.
  - [x] Record m10 e2e flake precisely (I861-F1: test, command, signature, runs); sign-off batched with the final merge request per conductor decision.
  - [ ] Run full `test-api` serially on the consolidated head plus final CI (I861-F3).
  - [ ] Lot gate:
    - [x] `make typecheck-auth-hono test-auth-hono pack-auth-hono API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> 40 files / 214 passed, pack PASS 0.16.0 (consolidated head)
    - [x] `make test-idp-sync-selftest API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> 47 PASS, 0 failures
    - [x] `make test-idp-sync-sql API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> PASS
    - [ ] **API tests**
      - [ ] `packages/auth-hono/tests/token-exchange.test.ts` (existing)
      - [ ] `packages/auth-hono/tests/token-exchange-security.test.ts` (existing, 35 tests)
      - [ ] `packages/auth-hono/tests/oauth-token.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-authorize.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-client-credentials.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-resource-indicator.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-revoke.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-dpop-proof.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-wellknown.test.ts` (existing regression)
      - [ ] `packages/auth-hono/tests/oauth-router-factory.test.ts` (existing regression)
      - [x] `api/tests/api/auth/oauth-token-exchange.test.ts` (new carried, 4/4 consolidated head)
      - [x] `api/tests/unit/auth/oauth-state-adapter.test.ts` (updated carried, 5/5 consolidated head)
      - [x] `api/tests/api/auth/oauth-wellknown.test.ts` (updated carried, 6/6 consolidated head)
      - [x] `api/tests/api/cluster-mesh-oauth-roots.test.ts` (updated carried, 3/3 consolidated head)
      - [x] Sub-lot gate: `make test-api API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> exit 0, 261 files passed, 0 failures (consolidated head)
    - [ ] **UI tests (TypeScript only)**
      - [ ] None; no login UI change.
    - [ ] **E2E tests**
      - [ ] Existing-client E2E is the cross-repository receipt in 2b (owner-executed).
    - [ ] UAT (owner-executed, 2b cutover):
      - [ ] Exchange a subject from the unchanged public client with the workload credential; verify exact claims, human subject, scope intersection, expiry.
      - [ ] Repeat negatives (public client, wrong workload/audience/type, forged actor, revoked, excess scope); all fail before any Radar call.
      - [ ] Both metadata documents advertise the grant and Immo scopes; public authorization/renewal works without new consent.

- [ ] **Lot 3 — Carried 2a exchange binding/cache (cluster-mesh 0.18.0) + consolidated gates**
  - [ ] Verify carried source: `packages/cluster-mesh/src/trust.ts`, `src/mesh.ts`, `src/index.ts`, `src/token-exchange.ts`, `src/trust/token-exchange-policy.ts`, `src/trust/token-exchange-cache.ts`, `src/trust/token-exchange-http.ts`, `src/modules/catalog.ts` (AUTH_HONO_RANGE parity), selected fixtures at 0.18.0, `README.md` + `CHANGELOG.md` 0.18.0 entry.
  - [ ] Retain B1 HTTP binding (no redirects, bounded timeout/body, redacted errors, crypto port), B2 minted-token validation, M3 caller-actor removal, M4 nonempty scope, M5 construction allowlist, M6 cache key, M7 bounded cache/single-flight/invalidation, M8 faithful #674 integration double, m9 300s cap.
  - [ ] Consolidation satisfied the post-#674 rebase structurally (2-IdP commits precede 2a commits); version re-check 0.18.0 above npm/main done in Lot 0.
  - [ ] Re-run package gates on the consolidated head; real auth-hono/Radar acceptance stays in 2b.
  - [ ] Lot gate:
    - [x] `make typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh pack-cluster-mesh API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry` -> 60 passed / 5 skipped files, 515 passed / 34 skipped tests, pack PASS 0.18.0 (consolidated head)
    - [ ] **API tests**
      - [x] `packages/cluster-mesh/tests/token-exchange.spec.ts` (existing carried)
      - [x] `packages/cluster-mesh/tests/token-exchange-security.spec.ts` (existing carried)
      - [x] `packages/cluster-mesh/tests/token-exchange-cache.spec.ts` (existing carried)
      - [x] `packages/cluster-mesh/tests/token-exchange-integration.spec.ts` (existing carried, faithful #674 double)
      - [x] `packages/cluster-mesh/tests/token-exchange-no-passthrough.spec.ts` (retained regression)
      - [x] `packages/cluster-mesh/tests/trust.spec.ts` (updated carried)
      - [x] `packages/cluster-mesh/tests/mesh.spec.ts` (updated carried)
      - [x] `packages/cluster-mesh/conformance/h2a-contract.spec.ts` (updated carried)
      - [x] Sub-lot gate: `make test-cluster-mesh API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **UI tests (TypeScript only)**
      - [ ] None for this package slice.
    - [ ] **E2E tests**
      - [ ] None for this package slice; real-user acceptance in 2b.
    - [ ] UAT (cache/outage, isolated stack):
      - [ ] Warm the cache, stop the issuer, cross the effective deadline, restart: bounded warm success then fail closed; zero original-token fallback.
      - [ ] Revoke/invalidate a cached identity and rotate credentials/scopes mid-session; no old entry authorizes the next call.
      - [ ] Measure cold-call extra latency and warm-call token-endpoint avoidance.

- [ ] **Lot 4 — 1b-core portable registry kernel (in progress, spec-v6 §5; spec-v7 still generating, v6 applies)**
  - [x] New `packages/mcp-platform/src/registry.ts`, registry subpath/export/type declarations, `tests/registry.test.ts`, `tests/registry-configuration.test.ts`, `tests/registry-dispatch.test.ts`; package/API docs and reports. Reuse manifest/runtime/config compiler. No cluster-mesh source in this lot.
  - [x] Test-first: new suites RED before impl (`Cannot find module '../src/registry.js'`), GREEN after (11 + 6 + 3).
  - [x] provider-cascade checked: not applicable (MCP provider registry; no `api/src/services/llm-runtime/**` or `providers/**` change, no `test-api-ai` trigger).
  - [ ] Version bump 0.3.0 -> 0.4.0 with goldens reseal (TOOL_CONFIGURATION_PLATFORM_VERSION + probe digests).
  - [ ] Packed-subpath import proof with zero registry I/O (isolated process).
  - [ ] Lot gate:
    - [ ] `make typecheck-mcp-platform test-mcp-platform api-extract-mcp-platform pack-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **API tests**
      - [ ] `packages/mcp-platform/tests/registry.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/registry-configuration.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/registry-dispatch.test.ts` (new)
      - [ ] Sub-lot gate: `make test-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **UI tests (TypeScript only)**
      - [ ] None for this pure kernel.
    - [ ] **E2E tests**
      - [ ] None; transport acceptance belongs to 4b-leaves.
    - [ ] UAT (packed kernel, isolated process):
      - [ ] Import the packed platform registry subpath, reproduce the immutable plan with zero registry I/O.
      - [ ] Register/select/configure two synthetic providers; changing one leaves the other unchanged.

- [ ] **Lot 5 — 3-policy + 4a guarded SDK dispatch (future, sequential on 1b-core)**
  - [ ] Update `packages/mcp-platform/src/hono.ts`, new `src/transport/dispatch.ts`, `streamable-http.ts`, `stdio.ts`, `result-codec.ts`; add `tests/capability-scopes.test.ts`, `streamable-http.test.ts`, `stdio.test.ts`, `wire-parity.test.ts`, `request-identity.test.ts`; update `tests/hono.test.ts`, `transport.test.ts`; regress `authz.test.ts`, `writes.test.ts`, `elicitation.test.ts`; API consumer regression `api/tests/api/mcp-resource-server.test.ts`.
  - [ ] Lot gate:
    - [ ] `make typecheck-mcp-platform test-mcp-platform api-extract-mcp-platform pack-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **API tests**
      - [ ] `packages/mcp-platform/tests/capability-scopes.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/wire-parity.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/request-identity.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/streamable-http.test.ts` (new)
      - [ ] `packages/mcp-platform/tests/stdio.test.ts` (new)
      - [ ] `api/tests/api/mcp-resource-server.test.ts` (existing regression)
      - [ ] Sub-lot gate: `make test-mcp-platform API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **UI tests (TypeScript only)**
      - [ ] None.
    - [ ] **E2E tests**
      - [ ] None; Immo parity stays open until 1b-Immo/4b-parity.
    - [ ] UAT (both transports, synthetic providers):
      - [ ] Both transports discover/call the same compiled surface with exact wire envelopes.
      - [ ] Effective overlays enforced; missing/unknown/unguarded/stale calls have no effects.

- [ ] **Lot 6 — Sentropic support for 2b-MCP cutover (coordination; Radar integration owned by i-cond)**
  - [ ] Hand immutable published receipts to 2b-MCP: auth-hono 0.16.0, cluster-mesh 0.18.0, mcp-auth 0.2.2 (main), exchange policy + cache contract.
  - [ ] Keep the faithful `#674` request/response/refusal contract stable for `mesh-token-exchange` integration.
  - [ ] Verify `PREPROD_CD_ENABLED=true` and production protections at merge time (read-only check, no deployment act).
  - [ ] UAT (owner-executed with i-cond, per environment preprod then prod):
    - [ ] `search_signals` uses a valid exchanged token as the same human; results unchanged.
    - [ ] Original MCP token to Radar is 401; exchanged token to MCP is 401; actor/scope denials hold.
    - [ ] Valid token without `immo:read` is 403 `insufficient_scope` on the upgraded tuple without reconnect.

- [ ] **Lot 7 — 4b-leaves incl. 1b-facade through mesh (future, after Lot 5 + 2a gates)**
  - [ ] Update `packages/cluster-mesh/src/modules/contracts.ts`, `catalog.ts`, `registry.ts`, `topology.ts`, `topology-guard.ts`, package/export/type maps, README, changelog. New `src/integrations/mcp/**`, `src/loaders/mcp/**`, `src/compose/mcp.ts`, `src/modules/topology-guard-mcp.ts`. Extend `peerDependencies`/`peerDependenciesMeta` with optional `@sentropic/mcp-platform` + `@modelcontextprotocol/sdk`.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh pack-cluster-mesh API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] `make -f packages/cluster-mesh/packaging.mk test-lazy-package API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **API tests**
      - [ ] `packages/cluster-mesh/tests/mcp-registry.spec.ts` (new)
      - [ ] `packages/cluster-mesh/tests/mcp-composition.spec.ts` (new)
      - [ ] `packages/cluster-mesh/tests/packaging/mcp-tuple.spec.ts` (new)
      - [ ] `packages/cluster-mesh/tests/packaging/mcp-registry-consumer.spec.ts` (new)
      - [ ] `packages/cluster-mesh/tests/integrations/mcp-surface.spec.ts` (new)
      - [ ] Sub-lot gate: `make test-cluster-mesh API_PORT=9550 UI_PORT=5750 MAILDEV_UI_PORT=1650 ENV=test-immo-861-mcp-registry`
    - [ ] **UI tests (TypeScript only)**
      - [ ] None in this slice.
    - [ ] **E2E tests**
      - [ ] None; consumer proof is the packed-consumer spec.
    - [ ] UAT (clean synthetic host, packed tarballs):
      - [ ] Register/select/configure two providers and list/call both over HTTP and stdio with exact names.
      - [ ] Disabled/missing/duplicate/wrong-version cases refuse startup with optional-dependency isolation.

- [ ] **Lot 8 — 5a web-pages provider contracts (future, launchable when a lane frees)**
  - [ ] Settle durable package name/namespace at public-contract review; implement `contracts.ts`, `codecs.ts`, `client.ts`, `server/**`, `parameters.ts`, `provider-definition.ts` + `tests/contracts.test.ts`, `canonical-manifest.test.ts`, `authorization.test.ts`, `bindings.test.ts`, `idempotency.test.ts`, `parameters.test.ts`. No Immo defaults in generic source.
  - [ ] Lot gate: package `typecheck`/`lint`/`test`/`pack` targets once implemented under a declared exception.
  - [ ] UAT (contract review + two-client binding test per spec-v6 §9).

- [ ] **Lot N-2** UAT
  - [ ] Carried probes (Lot 1 clean-consumer, Lot 3 cache/outage) green on the consolidated head.
  - [ ] Hosted-client continuity (existing connection, discovery, consent/renewal) verified in 2b per environment.
  - [ ] No reconnect, no account recreation, no expanded consent for carried changes.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Sync `spec/*.md` behavior changes from this branch (none yet beyond DATA_MODEL 0042 entry).
  - [ ] Record r4 verdict, final CI run, owner sign-offs and PR numbers in this file before merge-prep.

- [ ] **Lot N — Final validation**
  - [x] Typecheck & Lint (touched packages + api: typecheck-mcp-platform/auth-hono/cluster-mesh/api exit 0; lint-cluster-mesh exit 0; lint-api 0 errors / 217 warnings).
  - [x] Retest carried suites (Lots 1-3 gates: package gates + scoped API suites green on the consolidated head; full test-api running).
  - [ ] Retest e2e groups + security-container on the consolidated PR.
  - [ ] Retest AI flaky set only under the acceptance rule; record signatures + sign-off.
  - [ ] Bumped versions verified strictly above npm and merged main for every touched package (Post-Rebase Gate, incl. #662 watch I861-F4).
  - [x] Final gate step 1: create/update PR using this `BRANCH.md` text as PR body (draft PR #679 opened; #673/#674/#676 closed with pointers).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK` and owner sign-offs recorded, commit removal of `BRANCH.md`, push, and merge (owner-gated; never in this execution).
