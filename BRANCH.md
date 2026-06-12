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
  - `api/drizzle/*.sql` (only if a schema field proves necessary — not expected).

## Feedback Loop
- `BR39l-GATE1` (attention) — **Lot 2 (variable `aud` / `resource` on the user flow) is a CLAIMS-CONTRACT mutation → gated on D11/ARCH-12** (architect verdict E3). It MUST NOT merge until rhanka+architect ratify the contract change (fixtures + RP compat commitments: radar-immobilier, design-system, openerp, h2a-gateway pin auth-hono). Lots 1 & 3 (package extraction + mcp-auth, additive/refactor) are NOT gated and can land first.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — one coherent activation (2 packages + auth-hono delegation + 1 api consumer); single migration-free test cycle. Lot 2 split-out to a follow-up branch IF the D11/ARCH-12 gate stalls.
- Rationale: oauth-verify/mcp-auth/api are tightly coupled (extraction + first consumption must co-land per architecture rules); only the contract lot is independently gated.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline**
  - [x] Worktree `tmp/auth-39l` off `origin/main`; studies (`SPEC_STUDY_39_MCP_*`) carried in + architect verdict baked (§10).
  - [ ] Confirm env/ports (`test-auth-39l`, `e2e-auth-39l`); confirm `actions/*-artifact@v7` (post-#305) when adding CI jobs.

- [ ] **Lot 1 — `@sentropic/oauth-verify` 0.1 (NEW) + auth-hono dedup**
  - [ ] New package: framework-free verify core (jose peer): `verifyAccessToken`, `verifyDpopProof` (move from auth-hono `dpop.ts`/`service-auth-middleware.ts`), `TokenKeySource` port (`fromRemoteJwks(url,{cache})` / `fromJwksPort(jwksPort)`), canonical claim types (`AccessTokenClaims`, `ActClaim{sub,iss,h2a_eng?}` OPAQUE, `IdentityType`). **NO MCP scope grammar** (architect override).
  - [ ] `auth-hono` 0.5→0.6: delete its 4 duplicate verify paths (`service-auth-middleware.ts:101`/`jwks-service.ts:86` token-verify; `service-auth-middleware.ts:191`/`dpop.ts:34` DPoP) → delegate to `oauth-verify` (via `fromJwksPort`). Re-export claim types for back-compat.
  - [ ] Tests: `packages/oauth-verify/tests/**` (verify + DPoP + key-source); auth-hono regression green (no behavior change). contract-test fixtures for the verify primitives.
  - [ ] Lot gate: `make test-auth-hono ENV=test-auth-39l` + the new package test target; typecheck.

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
