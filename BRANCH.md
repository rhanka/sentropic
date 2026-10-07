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
- `attention`: Mistral Vibe OAuth flow facts (console.mistral.ai/api/vibe/sign-in PKCE S256 + poll_url + exchange → long-lived api_key, no refresh token) verified 2026-10-07 from the Vibe CLI-mirroring oh-my-pi PR #13875 and Mistral docs; wire endpoints must be re-validated live at UAT.
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
  - [ ] `api/src/services/llm-account-transports.ts`: `acquireMistralVibeAccountTransport` + token secret parse (no refresh; reauth on auth_failed).
  - [ ] `api/src/services/llm-runtime`: mistral dispatch authOverride via mistral-vibe account when `mistral-large-4`/`zai-glm-5-3` (env key stays fallback).
  - [ ] `api/src/services/provider-connections.ts` + settings routes: enrollment start/poll/exchange endpoints.
  - [ ] Tests: api unit tests for acquisition + dispatch auth selection.
  - [ ] Gate: `make typecheck-api`, `make test-api ENV=test-mistral-vibe-glm53`.
- [ ] **Lot 5 — Docs + semver + final validation**
  - [ ] Spec sync (`spec/` routing + accounts sections) if required by consumers.
  - [ ] Semver bumps: `packages/llm-mesh`, `packages/llm-gateway` (publish mesh before gateway).
  - [ ] `make scope-check` before each commit; final typecheck/lint/test pass; PR created with this file as body.
