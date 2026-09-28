# Feature: Opus 5.5 Route To Astra

## Objective
- Route every `claude-opus-5-5` request coming from Claude Code to `gpt-6-astra` (owner decision "Astra systematique", relayed by conductor session `sentropic-46` on 2026-09-27); the served provider/model stays visible in diagnostics, an astra-served answer is never presented as an Anthropic classifier verdict, and no `safeguard_results` is ever synthesized.

## Scope / Guardrails
- Base: `origin/main` at `bc675bd7b`; branch `feat/llm-mesh-opus55-route`; worktree `tmp/llm-mesh-opus55-route`.
- Make-only and Docker-first. Never use the root checkout or `ENV=dev` for development/testing.
- Dedicated test mapping: `ENV=test-llm-opus55-route`, `API_PORT=9471`, `UI_PORT=5671`, `MAILDEV_UI_PORT=1571`, with `ENV` last on each Make invocation.
- No real provider tokens, publication, push or merge in this branch without the conductor session.
- The unknown-model 404 error contract is owned by `feat/llm-gateway-automode-relay` (BR-REL-Q3); this branch only keeps the mesh typed errors it relies on.
- All new code, comments, docs and commits in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-mesh/package.json` (semver bump after registry pre-check, before PR)
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (Opus 5.5 route contract only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/src/adapter-auth.ts` (owned by another lane)
  - `packages/llm-gateway/**` (owned by `feat/llm-gateway-automode-relay`)
  - `.github/**`, `package-lock.json`, `PLAN.md`
- **Conditional Paths (require an approved BR-OPR-EXn before any change)**:
  - `scripts/llm-model-equivalences/council.source.json` and its generated output (BR-OPR-EX1) only if the v2 design proves the equivalence check classifies an astra-only route alias.
  - `api/**` product catalog or `apps/llm-gateway/**` host catalog (BR-OPR-EX2) only if the route is not active through the package alone.
- **Exception process**:
  - Record ID, evidence, reason, impact, rollback and decision in `## Feedback Loop` before touching any conditional path. Owner questions go through the conductor session `sentropic-46`, never directly.

## Feedback Loop
- [x] BR-OPR-Q1: The overloaded response comes from `packages/llm-gateway/src/router/errors.ts:174` (unknown-model falls through to 503 `overloaded_error`, read by Claude Code as 529); served on :3002 by installed h2a runtime 0.97.9 / gateway 0.19.0. Fix owned by BR-REL-Q3. Status: resolved (Astra design + Muse review).
- [x] BR-OPR-Q2: Product catalog auto-discovers mesh profiles; installed h2a registers no Claude client and local `claude-code` enrollment is portal-only, so no native Anthropic route exists there today. Status: resolved (Muse review).
- [x] BR-OPR-Q3: Exposed as an exclusive launch alias `claude-opus-5-5` to `openai/gpt-6-astra/codex` with no Anthropic catalog profile, so no capability copy is needed (capabilities come from the existing Astra profile). Status: resolved (v2 design + Muse v2 review).
- [x] BR-OPR-Q4: Third Cloud candidate removed by the owner decision "Astra systematique" (single `gpt-6-astra` target). Status: resolved by owner via conductor.
- [x] BR-OPR-Q5: Same-request fallback after a Claude failure is N-A (no Anthropic target). Status: resolved by owner via conductor.
- [x] BR-OPR-EX1: Not needed; council completeness iterates catalog profiles and alias metadata derives from launch mappings, so no council source or generated output change. Status: closed (v2 design + Muse v2 review).
- [x] BR-OPR-Q7: Established non-Astra sticky affinity follows the `/model` switch: automatic migration to Astra with affinity reset on success; failure leaves the stale affinity untouched; an Astra affinity violating a per-request explicit restriction still yields `no-route`. Status: resolved by owner via conductor `sentropic-46` (2026-09-27, "follow the /model").
- [x] BR-OPR-Q6: When `gpt-6-astra` has no ready account, return a clear explicit availability error with no Anthropic or Gemini fallback. Status: resolved by owner via conductor `sentropic-46` (2026-09-27).

## AI Flaky tests
- [ ] Only provider/network nondeterminism with a passing rerun on the same commit may be proposed for explicit owner sign-off; no timeout increases.

## Orchestration Mode (AI-selected)
- [ ] Mono-branch + cherry-pick
- [x] Multi-branch
- [x] Rationale: separate from the gateway relay branch because the mesh package owns model ids, catalog and route targets while the relay owns wire fidelity and the unknown-model error contract; each has its own package gate and review.

## UAT Management (in orchestration context)
- [ ] Claude Code session selecting `claude-opus-5-5` behind an isolated gateway: always served by `gpt-6-astra`, served provider/model visible in diagnostics, no `safeguard_results` in JSON or SSE.
- [ ] `claude-opus-5-5` with no ready astra account: explicit availability error, no loop of overloaded retries.
- [ ] No web/Chrome/VSCode UI edits or UI-specific UAT for this package-only lot.

## Build Steps (M0-M11, design v2 + Muse v2 BUILD_READY_WITH_CHANGES corrections)
- [ ] M0 — Branch plan commit
- [x] M1 — Exclusive alias in routing-targets
- [x] M2 — Selection guards (override + council)
- [x] M3 — Selection availability and restrictions
- [x] M4a — Plan-time affinity migration
- [x] M4b — Success-time rebind, failure untouched
- [x] M5 — Health suppression and rotation
- [x] M6 — Error identity and diagnostics
- [x] M7 — listModels hides the alias
- [x] M8 — Quote as a single Astra candidate
- [x] M9 — Quote guards and matrix note
- [ ] M10 — Execution rewrite, effort passthrough, negative sweep
- [ ] M11 — Council pin, spec contract, 0.23.0

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and isolation**
  - [x] Create isolated worktree from `origin/main` and verify active branch.
  - [x] Reserve unique environment and three ports (verified free with `ss -ltn`).
  - [x] Astra xhigh design pass and independent Muse 1.3 max review (APPROVE_WITH_CHANGES).
  - [x] Astra xhigh v2 design applying the owner decision and review findings; sent to the conductor before build (Muse v2 review: BUILD_READY_WITH_CHANGES).
- [ ] **Lot 1 — Opus 5.5 astra route**
  - [ ] Add the `claude-opus-5-5` route with a single `gpt-6-astra` target in `packages/llm-mesh/src/routing-targets.ts`, plus any provider/catalog entry the v2 design requires.
  - [ ] Keep `requestedModel` distinct from the served provider/model in plan diagnostics.
  - [ ] Tests in `packages/llm-mesh/tests/routing-targets.test.ts`, `route-selection.test.ts`, `route-planner.test.ts`: always astra, never an Anthropic candidate, explicit error when astra is unavailable, `/v1/models` visibility rules, served model diagnostics.
- [ ] **Lot 2 — Unknown-model typed errors**
  - [ ] Keep `RoutePlanError`/`RouteQuoteError` `unknown-model` typed and structurally identifiable (code plus name) for the gateway 404 mapping of BR-REL-Q3.
  - [ ] Tests in `packages/llm-mesh/tests/route-planner.test.ts` and `budget-quote.test.ts`: unknown model versus known model without route.
- [ ] **Lot 3 — Documentation, package gate and final validation**
  - [ ] Update `packages/llm-mesh/CHANGELOG.md` Unreleased and the routing spec.
  - [ ] Check the published package version before bumping `packages/llm-mesh/package.json`; do not publish directly.
  - [ ] Build by Muse 1.3 xhigh, review by Astra high; resolve findings.
  - [ ] `make test-llm-mesh API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-opus55-route`.
  - [ ] `make typecheck-llm-mesh API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-opus55-route`.
  - [ ] `make build-llm-mesh API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-opus55-route`.
  - [ ] `make scope-check API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-opus55-route`.
  - [ ] `make down API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-opus55-route`; report local checks separately from CI.
