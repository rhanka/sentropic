# Feature: Mistral Vibe account transport + Mistral Large 4 / Z.ai GLM 5.3

## Objective
Add Mistral Large 4 and Mistral-hosted Z.ai GLM 5.3 to the llm-mesh catalog, serve both through a new native-OAuth Mistral Vibe account transport (`mistral-vibe`, console.mistral.ai PKCE sign-in flow minting a plan-billed API key), and add GLM 5.3 as a supplemental gateway fallback for the Opus and Fable 5.1 launch aliases per the Artificial Analysis Intelligence Index (GLM-5.3 Max = 45 = Opus 5 Medium).

## Scope / Guardrails
- Scope limited to `packages/llm-mesh/**`, `packages/llm-gateway/**`, `api/src/**`, `api/tests/**`, `packages/llm-mesh/tests/**`, `BRANCH.md`.
- No DB migration expected (`llm_provider_accounts.provider_id` is provider-agnostic); if one becomes required, max 1 file in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker/npm commands.
- Branch development in isolated worktree `tmp/mistral-vibe-glm53`.
- Automated test campaigns on `ENV=test-mistral-vibe-glm53`, never on root `dev`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `api/src/**`
  - `api/tests/**`
  - `packages/cluster-mesh/package.json` (peer range widening for the llm-mesh 0.23.0 bump)
  - `packages/cluster-mesh/src/**` + `packages/cluster-mesh/tests/**` (LLM_MESH_RANGE widening to `>=0.22.0 <0.24.0` in `src/modules/catalog.ts` + test expectations and selected-train fixture)
  - `scripts/llm-model-equivalences/**` (council source, via `make refresh-llm-model-equivalences`)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `package-lock.json` / `api/package-lock.json` (semver bumps only)
- **Exception process**:
  - Declare exception ID `BR77-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- BR77-EX1 (conditional path `package-lock.json`): required by the `@sentropic/llm-mesh` 0.22.3→0.23.0 semver bump — root lockfile regenerated via `npm install --package-lock-only`. Impact: version/range fields only (mesh 0.23.0, cluster-mesh 0.13.1 peer range, gateway dep). Rollback: `git checkout package-lock.json` and re-run `make lock-api`.
- `attention`: Lot 4 (api wiring) intentionally NOT started yet — seams located for the next session:
  - `api/src/services/llm-account-transports.ts`: mirror `acquireMuseAccountTransport` (~line 2263) with `parseMistralVibeTokenSecret` (plain bearer-key secret, `refreshTokenIfNeeded` returns null — no refresh grant) + `MISTRAL_VIBE_{TARGET,TRANSPORT}_PROVIDER_ID` consts.
  - `api/src/services/provider-connections.ts`: add `resolveConnectedMistralVibeTransport` next to `resolveConnectedClaudeCodeTransport` (~line 364).
  - `api/src/services/llm-runtime/index.ts`: mirror the claude-code generate-site acquisition (`credentialResolution.source === 'none'` guard, ~line 1117) and stream-site (~line 1404) for `selection.providerId === 'mistral'`; pass `authOverride: createMistralVibeAccountAuthInput(transport)` (to add in `mesh-dispatch.ts` next to `createCodexAccountAuthInput`).
  - Enrollment HTTP routes (facade `enroll('mistral-vibe', …)` + poll) + settings surface + api tests still to wire.
- `attention`: Mistral Vibe OAuth flow facts (console.mistral.ai/api/vibe/sign-in PKCE S256 + poll_url + exchange → long-lived api_key, no refresh token) verified 2026-10-07 from the Vibe CLI-mirroring oh-my-pi PR #13875 and Mistral docs; wire endpoints must be re-validated live at UAT.
- `attention` (CI round 2): llm-gateway 0.19.2 was PUBLISHED by the #643 merge run, so its `^0.23.0` mesh dependency required a gateway version bump → 0.19.3 (validate-publishable-manifests + validate-llm-gateway). Cluster-mesh surface/skew tests refreshed for the 0.23.0/0.19.3 tuple (installedVersion pins + skew-invariants.ts range regex).
- `attention` (post-rebase): #643 (`fix/proxy-addr-cve`) MERGED into main (owner direction 2026-10-08); branch rebased onto main 197de20dc. proxy-addr 2.0.8 + MCP SDK 1.31.0 now in the lockfiles; the local api-image audit-gate blocker is resolved at the repo level.
- `attention` (env): `make typecheck-api` is blocked on this branch by the PRE-EXISTING SCA audit-gate failure in the api image build (proxy-addr GHSA-jqcg-44mw-7w3h critical + @modelcontextprotocol/sdk GHSA-6qxp-vccf-f47h high — unallowlisted on origin/main; fixed by open PR #643 `fix/proxy-addr-cve`, unmerged). Any branch touching `api/src` invalidates the cached image and re-runs the gate. API typecheck was validated standalone instead: `npm ci` (api lockfile) + `npm run typecheck` in node:24 → 0 errors, against the workspace `@sentropic/llm-mesh@0.23.0` (dist built by prepare-node-workspace). Full test campaign deferred to branch CI per owner direction.
- `attention`: semver consumers synchronized for the 0.23.0 bump: cluster-mesh peer range `>=0.22.0 <0.24.0` + version 0.13.1, gateway dep `^0.23.0`, root package-lock.json regenerated via `npm install --package-lock-only` (ERESOLVE otherwise).
- `attention`: `zai-glm-5-3` is the Mistral-hosted third-party model id (docs.mistral.ai/models/zai-glm-5-3); text-only input, reasoning_effort low/high/max.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: single tightly-coupled vertical (mesh catalog → transport → routing → gateway consumers); splitting would ripple through shared types.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/mistral-vibe-glm53` created off `origin/main` (52c1fdc63).
  - [x] `harness check branch` PASS.
  - [x] Model facts verified (Mistral docs, Artificial Analysis index, Vibe sign-in flow).
- [x] **Lot 1 — Mesh catalog + providers + auth ids**
  - [x] `providers.ts`: add `mistral-large-4`, `zai-glm-5-3` to `knownModelIds` + `knownModelIdsByProvider.mistral`.
  - [x] `catalog.ts`: model profiles (Large 4: advanced, vision, 1M ctx; GLM 5.3: advanced, text-only, 1M ctx, 131_072 max output) + mistral provider `accountTransports: ['mistral-vibe']`.
  - [x] `auth.ts`: `accountTransportProviderIds` + `executableAccountTransportProviderIds` += `mistral-vibe`.
  - [x] Tests: `packages/llm-mesh/tests` (auth, facade/catalog consumers).
  - [x] Gate: `make typecheck-llm-mesh`, `make test-llm-mesh ENV=test-mistral-vibe-glm53`.
- [x] **Lot 2 — Mistral Vibe native OAuth enrollment (mesh)**
  - [x] `enrollment/contracts.ts`: providerId union += `mistral-vibe`.
  - [x] `enrollment/mistral-vibe.ts`: sign-in PKCE S256 start (POST /api/vibe/sign-in), poll (GET poll_url), exchange (POST /vibe/sign-in/{process_id}/exchange) → PreparedCredential; refresh = reauth (no refresh token).
  - [x] `enrollment/index.ts` export.
  - [x] Tests: new `tests/enrollment/mistral-vibe.test.ts` (start/poll/exchange/expiry/denied).
  - [ ] Gate: `make typecheck-llm-mesh`, `make test-llm-mesh ENV=test-mistral-vibe-glm53`.
- [x] **Lot 3 — Routing + gateway mapping**
  - [x] `routing-targets.ts`: faithful `DEFAULT_TARGET_MAPPINGS` entries for `mistral-large-4` and `zai-glm-5-3` (transport `mistral-vibe`); `GLM_ROUTE_EFFORT` map + `glmTarget` insertion as supplemental fallback (after codex + cloud-code) for opus + fable-5-1 aliases.
  - [x] Generated council: refresh exclusions for the two new models.
  - [x] Tests: `routing-targets.test.ts`, gateway `target.test.ts` / contract snapshots.
  - [ ] Gate: `make typecheck-llm-mesh`, `make typecheck-llm-gateway`, `make test-llm-mesh ENV=test-mistral-vibe-glm53`.
- [ ] **Lot 4 — Api account transport wiring**
  - [x] `api/src/services/llm-account-transports.ts`: `acquireMistralVibeAccountTransport` + `parseMistralVibeTokenSecret` (no refresh; reauth on expiry) + `storeMistralVibeAccountTransport` + `getPrimaryMistralVibeAccountTransport`.
  - [x] `api/src/services/llm-runtime`: mistral dispatch authOverride via mistral-vibe account at both the generate and stream sites, guarded by `credentialResolution.source === 'none'` (env key / BYOK / workspace keep precedence), with full outcome accounting (abort → failed, catch → mapAccountTransportErrorOutcome, finally → recordOutcome).
  - [x] `api/src/services/provider-connections.ts`: `resolveConnectedMistralVibeTransport`; `api/src/services/llm-runtime/mesh-dispatch.ts`: `createMistralVibeAccountAuthInput`.
  - [ ] Enrollment HTTP routes (`mistral:start|import|disconnect` in `llm-mesh-enrollment*.ts`) + settings provider card: FOLLOW-UP — blueprint is the muse vertical (startMuseEnrollment/importMuseEnrollment/disconnectMuseEnrollment + toMuseProviderState); note muse itself is absent from `listProviderConnections`, so the Mistral card upgrade is a product decision.
  - [x] Tests: api unit tests for acquisition + dispatch auth selection — `api/tests/unit/mistral-vibe-account-transport.test.ts` (multi-tenant store/acquire isolation + dispatch auth input, no refresh grant; contributed externally against this branch's API surface).
  - [ ] Gate: `make typecheck-api`, `make test-api ENV=test-mistral-vibe-glm53`.
- [ ] **Lot 5 — Docs + semver + final validation**
  - [ ] Spec sync (`spec/` routing + accounts sections) if required by consumers.
  - [x] Semver bumps: `@sentropic/llm-mesh` 0.22.3 → 0.23.0; gateway dependency → `^0.23.0` (publish mesh before gateway).
  - [ ] `make scope-check` before each commit; final typecheck/lint/test pass; PR created with this file as body.
