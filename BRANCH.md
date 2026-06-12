# Feature: BR-39l-mcp-authz — MCP authorization activation (oauth-verify + mcp-auth + user-flow resource)

## Objective
Activate the two ratified new libraries and unblock the #1 gap (a user token can target an MCP server): extract `@sentropic/oauth-verify` (verify core, dedups auth-hono's 4 verify paths), create `@sentropic/mcp-auth` (RFC 9728 PRM + MCP token validation + challenges + `/hono`), and add RFC 8707 `resource` → variable `aud` on the user `authorization_code` flow. First real consumption: an api/ MCP endpoint consumes `mcp-auth/hono`.

## Scope / Guardrails
- Library-first: every capability is an `@sentropic/*` package, framework-agnostic (ports/BYO host), MIT, semver + contract-tests + compat matrix.
- Activation-by-real-consumption (`rules/architecture.md`): the 2 new packages ship in the SAME PR train as their first api/ consumer.
- Architect verdict §10 of `spec/SPEC_STUDY_39_MCP_LIBRARIZATION.md` is binding: `oauth-verify` = verify + claim types ONLY (NO MCP scope grammar — that lives in `mcp-auth`); `oauth-verify` below both `auth-hono` and `mcp-auth`.
- Make-only; branch worktree `tmp/auth-39l`; tests on `ENV=test-auth-39l` / `ENV=e2e-auth-39l`; `ENV` last.
- One migration max (likely ZERO — no schema change expected in 39l).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/oauth-verify/**` (NEW package)
  - `packages/mcp-auth/**` (NEW package)
  - `packages/auth-hono/**` (delegate verify to oauth-verify + compat wrapper + `resource`/`aud` on user flow)
  - `api/src/**`, `api/tests/**` (the MCP endpoint consuming `mcp-auth/hono`; `resource` plumbing)
  - `spec/SPEC_STUDY_39_MCP_AUTHKIT_ELICITATION_GAPS.md`, `spec/SPEC_STUDY_39_MCP_LIBRARIZATION.md`
  - `BRANCH.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, other app/package source.
- **Conditional Paths**:
  - `.github/workflows/ci.yml` — `BR39l-EX1`: add `validate-oauth-verify` + `validate-mcp-auth` + `publish-*` jobs (mirror `validate-auth-hono`/`validate-auth-client` pattern) + the `changes` filter entries. Reason: new published packages need their CI gates. Rollback: revert the workflow hunk. Coordinate with scale (CI=scope:foundations).
  - `Makefile` — `BR39l-EX2` (orchestrator-applied; OUT of Lot-1 subagent scope): add `typecheck-/build-/test-oauth-verify` targets + wire the `@sentropic/oauth-verify` dist build + symlink into `typecheck-/build-/test-auth-hono`. Reason: auth-hono `src` now imports the new workspace package; its package targets cannot resolve it otherwise (see Feedback Loop BR39l-FL2). Rollback: revert the Makefile hunk. Coordinate with scale (Makefile=scope:foundations).
  - `api/drizzle/*.sql` (only if a schema field proves necessary — not expected).

## Feedback Loop
- `BR39l-GATE1` (attention) — **Lot 2 (variable `aud` / `resource` on the user flow) is a CLAIMS-CONTRACT mutation → gated on D11/ARCH-12** (architect verdict E3). It MUST NOT merge until rhanka+architect ratify the contract change (fixtures + RP compat commitments: radar-immobilier, design-system, openerp, h2a-gateway pin auth-hono). Lots 1 & 3 (package extraction + mcp-auth, additive/refactor) are NOT gated and can land first.
- `BR39l-FL1` (Lot 1, info, for Lot 3) — **`fromJwksPort` provider signature changed vs the index.ts skeleton.** Skeleton declared `{ getActiveKey(); listKeys?() }`; implementation requires `JwksProviderLike { findKeyByKid(kid); getActiveKey() }` because access-token verification resolves the key by the token header `kid` (auth-hono `JwksPort` has `findKeyByKid`; spec §10 `JwksPortLike`). `getActiveKey` is the no-kid fallback; `listKeys` dropped (unused). All other skeleton exports (`verifyAccessToken(opts)`, `verifyDpopProof(opts)`, `fromRemoteJwks`, `TokenKeySource.resolveKey`, claim types, error classes) are unchanged. Lot 3 (`@sentropic/mcp-auth`) consumes `fromRemoteJwks` + `verifyAccessToken` + `TokenKeySource` + claim types — none affected.
- `BR39l-FL2` (Lot 1, BLOCKER, owner=orchestrator) — **Lot 1 gate cannot run inside the subagent scope: it needs Makefile targets (forbidden path here).** `make test-auth-hono` fails with `Cannot find package '@sentropic/oauth-verify'` because the target installs deps in an isolated tool_dir and does not build/symlink the new workspace package. Direct `docker run` is sandbox-denied. Required (BR39l-EX2): (a) NEW `typecheck-oauth-verify` / `build-oauth-verify` / `test-oauth-verify` targets mirroring `*-auth-client` (peer = `jose` only; `tsc -p tsconfig.json` for build, `vitest run tests --environment node` for test); (b) in `typecheck-auth-hono` + `build-auth-hono` + `test-auth-hono`, build oauth-verify dist first and add `mkdir -p node_modules/@sentropic; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify` (oauth-verify's `exports` resolve to `./dist/index.js`, so dist must exist). Impact: enables the gate; no behavior change to existing targets. Rollback: revert the Makefile hunk. Coordinate with scale (CI/Makefile = scope:foundations) — also covers the `BR39l-EX1` CI jobs.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — one coherent activation (2 packages + auth-hono delegation + 1 api consumer); single migration-free test cycle. Lot 2 split-out to a follow-up branch IF the D11/ARCH-12 gate stalls.
- Rationale: oauth-verify/mcp-auth/api are tightly coupled (extraction + first consumption must co-land per architecture rules); only the contract lot is independently gated.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline**
  - [x] Worktree `tmp/auth-39l` off `origin/main`; studies (`SPEC_STUDY_39_MCP_*`) carried in + architect verdict baked (§10).
  - [ ] Confirm env/ports (`test-auth-39l`, `e2e-auth-39l`); confirm `actions/*-artifact@v7` (post-#305) when adding CI jobs.

- [ ] **Lot 1 — `@sentropic/oauth-verify` 0.1 (NEW) + auth-hono dedup**
  - [x] New package: framework-free verify core (jose peer): `verifyAccessToken`, `verifyDpopProof` (moved from auth-hono `dpop.ts`/`service-auth-middleware.ts`), `TokenKeySource` port (`fromRemoteJwks(url,{cacheMaxAgeSec})` / `fromJwksPort(jwksProvider)`), canonical claim types (`AccessTokenClaims`, `ActClaim{sub,iss,h2a_eng?}` OPAQUE, `IdentityType`) + `parseScopes`. README + LICENSE (mirror auth-client). **NO MCP scope grammar** (architect override). Skeleton signature change: `fromJwksPort` provider now requires `findKeyByKid` (kid lookup) — flagged for Lot 3 (see Feedback Loop BR39l-FL1).
  - [x] `auth-hono` 0.5→0.6: delegate its 4 duplicate verify paths (`service-auth-middleware.ts` token-verify + `jwks-service.ts:verifyJwt` kid-lookup; `service-auth-middleware.ts` DPoP + `dpop.ts`) → `oauth-verify` (via `fromJwksPort`). Re-export `AccessTokenClaims`/`ActClaim`/`IdentityType`/`TokenKeySource` for back-compat. Added `@sentropic/oauth-verify` workspace dependency.
  - [x] Tests: `packages/oauth-verify/tests/**` (verify happy/expired/wrong-aud/wrong-iss/scope-missing/no-kid/malformed; DPoP valid/replay/ath-mismatch/htm/htu/iat/typ/expectedJkt; remote + in-process key sources).
  - [ ] Lot gate: BLOCKED on Makefile targets — see Feedback Loop BR39l-FL2 / BR39l-EX2. `make test-auth-hono` currently fails (`Cannot find package '@sentropic/oauth-verify'`); new `*-oauth-verify` targets do not exist. Orchestrator must apply the Makefile hunk, then run the gate.

- [ ] **Lot 2 — RFC 8707 `resource` → variable `aud` on the USER flow (auth-hono) [GATED BR39l-GATE1 / D11-ARCH-12]**
  - [ ] authorize-handler: accept `resource` (validated allowlist per client/tenant); token-handler: emit `aud=resource` (default-aud=userinfo for legacy RPs; reject multi-audience) on `authorization_code` access tokens.
  - [ ] Compat: existing RPs (no `resource`) unchanged (aud=userinfo). contract-test + compat matrix entry.
  - [ ] Tests: auth-hono oauth-token/authorize tests (resource→aud, legacy default, reject multi-aud, negative).
  - [ ] **DO NOT MERGE until D11/ARCH-12 ratified.** If gate stalls → split to `feat/auth-39l-resource-aud`.

- [ ] **Lot 3 — `@sentropic/mcp-auth` 0.1 (NEW) + first api consumption**
  - [ ] New package (consumes `oauth-verify`): `createMcpAuth({resource, authorizationServers, scopesSupported})` → `.handle(req)` serves RFC 9728 PRM `/.well-known/oauth-protected-resource`; `.verify(req,{requiredScopes})` (aud=resource, scope, DPoP, `tid`); `.challenge(err)` → 401/403 + `WWW-Authenticate` w/ `resource_metadata`. Fetch-style core + `/hono` adapter (`mcpAuthRoutes`, `requireMcpAuth`). **MCP scope grammar lives HERE.**
  - [ ] E2: relocate `createRequireServiceAuth` → `mcp-auth/hono`; `auth-hono` keeps a delegating compat wrapper (no 1.0 yet).
  - [ ] **First consumer**: an api/ MCP endpoint mounts `requireMcpAuth(...)` (activation-by-consumption). 
  - [ ] Tests: `packages/mcp-auth/tests/**` (PRM doc, verify accept/reject, challenge shape, hono adapter) + api integration (protected MCP route 401→token→200).
  - [ ] Lot gate: typecheck + scoped tests `ENV=test-auth-39l`.

- [ ] **Lot N — Final validation + publish wiring**
  - [ ] Bumps: `oauth-verify` 0.1.0, `mcp-auth` 0.1.0 (new), `auth-hono` 0.6.0; peer-widen consumers.
  - [ ] CI (`BR39l-EX1`): add `validate-oauth-verify`/`validate-mcp-auth`/`publish-*` jobs + `changes` filters (mirror auth-hono).
  - [ ] First-publish bootstrap for the 2 new packages (`workflow_dispatch bootstrap_publish_target=<pkg>`) + OIDC trusted-publisher attach (Playwright MCP) — per publish memory; NOT a deferred TODO.
  - [ ] Compat matrix + contract-tests per published package.
  - [ ] `make lint-api` + full `make test-api ENV=test-auth-39l` + retest auth-hono.
  - [ ] PR (body=BRANCH.md); CI green; remove BRANCH.md; merge (--merge). Lot 2 lands only post-gate.

## Deferred to follow-up (per ratified plan)
- `39h`+`39-nhi-bridge` (identityType additive + attestation + opaque `h2aRef`) · `39l-dcr` (CIMD+DCR) · `39i⊕39e-Lot5` (RFC8693 exchange + `act`) · `39q-elicitation` (`mcp-auth/elicitation` + auth-ui verify page) · `auth-client` 0.2 (stable DPoP key — bug `index.ts:91`) · `mcp-registry` → api/ then Resource-Plane (BR-70).
