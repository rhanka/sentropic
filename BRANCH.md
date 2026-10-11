# Feature: llm-gateway muse+vibe wires

## Objective
- Serve muse and vibe CLIs through llm-gateway with enrolled accounts, fix 5 operational gaps, ship CI integration tests, merge, publish npm bumps.

## Scope / Guardrails
- Scope limited to `packages/llm-gateway/src/**`, `packages/llm-gateway/tests/**`, `packages/llm-mesh/src/**`, `packages/llm-mesh/tests/**`, `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`.
- One migration max in `api/drizzle/*.sql` (not expected; none planned).
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` reserved for user dev/UAT (`ENV=dev`) and stays stable.
- Branch development happens in isolated worktree `tmp/llm-gateway-muse-vibe-wires`.
- Automated test campaigns run on dedicated environments (`ENV=test-gw-wires` / `ENV=e2e-gw-wires`), never on root `dev`.
- UAT qualification worktree stays commit-identical to branch under qualification (same HEAD SHA).
- In every `make` command, `ENV=<env>` passed as last argument.
- All new text in English.
- h2a `--gw` guard relaxation + dep bump owned by h2a lane (external dependency, not this branch).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
  - `packages/llm-gateway/package.json`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `package-lock.json`
- **Exception process**:
  - Declare exception ID `GWV-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `attention`: owner brief received via `agent:conductor:38f44695f2ad` (`env:send:a7b2be1d`), targeted at `muse:sentropic:369322cd9b39`, deposited on live lane `muse:sentropic:1ced6e4393e1`.
- `attention`: h2a `--gw` claude-only guard relaxation + dep bump owned by h2a lane; this branch delivers gateway+mesh only.
- `attention`: local `main` was stale at `cb618e190`; worktree based on `origin/main` `dc95f7e4f` (train mesh 0.25.0 + gateway 0.19.5 + cluster-mesh 0.13.3).
- `acknowledge`: Lot 0 evidence (live gateway `127.0.0.1:3002`, h2a 0.98.3, personal-passthrough, ready): bad JSON -> OpenAI 400 `invalid request`; valid muse body no-auth -> 401 `authentication failed` (wire parses, auth gates pre-pool); `GET /muse-code/models` -> plain 404 (route missing); `POST /v1/messages/count_tokens` -> plain 404 (route missing).
- `acknowledge`: vibe default model alias `mistral-medium-3.5` absent from `routing-targets.ts` static routes, catalog, council (only `mistral-large-4` + `zai-glm-5-3` ride `mistral-vibe`).
- `acknowledge`: sticky fail-closed confirmed in code (`route-planner.ts` affinity block empties candidates when affinity account missing/not-ready); negative-cache default TTL 300s confirmed (`routing-policy.ts`); sticky file purged to `{}`.
- `attention`: evening muse-400 exact trigger bytes unconfirmed (parse-then-auth order proves body-level failure); vibe-503 exact trigger unconfirmed (unknown-model vs no-eligible-account); owner captures requested if repro diverges.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: gateway+mesh wires and gaps share one contract surface and one CI gate; single test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT performed on integrated branch only (after Lot 5, real muse + vibe CLIs pointed at local gateway).
- UAT checkpoints listed as checkboxes inside Lot 6.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/llm-gateway-muse-vibe-wires`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/llm-gateway-muse-vibe-wires` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & repro**
  - [x] Read `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` wire surface sections (2-wire surface, §3b shapes, §14 muse enrollment).
  - [x] Read `packages/llm-gateway/src/router/index.ts`, `src/wire.ts`, `src/flow.ts`, `src/router/errors.ts` (base `origin/main`).
  - [x] Read `packages/llm-mesh/src/route-planner.ts` affinity block, `src/route-health.ts`, `src/routing-targets.ts`, `src/routing-policy.ts`.
  - [x] Baselines green: mesh typecheck + 593 tests (37 files); gateway typecheck + 390 tests (28 files).
  - [x] Repro muse: bad JSON 400 live, valid muse body 401 live (wire parses, auth gates pre-pool), `GET /muse-code/models` 404 live.
  - [x] Repro vibe: default alias `mistral-medium-3.5` absent from static routes/catalog/council (code); evening 503 trigger unconfirmed.
  - [x] Measured wire facts recorded in `## Feedback Loop` (muse ELF paths, vibe Python backend, live probe statuses).
  - [x] Scope confirmed; no exception needed; worktree verified on `origin/main` `dc95f7e4f`.
- [x] **Lot 1 — Muse ingress adapter**
  - [x] `GET /muse-code/models` shares the caller-filtered catalog handler with `GET /v1/models` (legacy pool + route-planner modes, 401 pre-pool).
  - [x] Chat passthrough unchanged: `POST /v1/chat/completions` parses muse OpenAI bodies; muse models already map to the `muse` transport in mesh `routing-targets.ts`; SSE relayed verbatim (B3); no ingress header change needed.
  - [x] Unit tests: `packages/llm-gateway/tests/muse.test.ts` (new, 2 tests).
  - [x] Updated `packages/llm-gateway/tests/contract-snapshot.test.ts` (frozen inventory 5 -> 6, deliberate golden edit).
  - [x] No mesh source change required for muse dispatch (verified existing mappings).
  - [x] Lot gate green: typecheck + lint + full suite 392 passed (29 files).
- [x] **Lot 2 — Vibe routing**
  - [x] Vibe speaks OpenAI-compat `POST /v1/chat/completions` (no new ingress route needed; verified against installed CLI 2.26.1: `api_base` + `/v1`, endpoint `/chat/completions`, Bearer auth).
  - [x] Root cause of vibe failure: CLI default alias `mistral-medium-3.5` absent from mesh static routes (only `mistral-large-4` + `zai-glm-5-3` rode `mistral-vibe`).
  - [x] Added `mistral-medium-3.5` -> `{mistral, mistral-vibe}` faithful mapping in `packages/llm-mesh/src/routing-targets.ts` (propagates to canonical + candidates resolvers; no catalog profile required by `firstTargetThatResolvesProfile` fallback).
  - [x] Regression test in `packages/llm-mesh/tests/routing-targets.test.ts` (resolve + candidates).
  - [x] Equivalence council check green (`make check-llm-model-equivalences`).
  - [x] Lot gate green: typecheck + lint + full suite 594 passed (37 files).
- [ ] **Lot 3 — count_tokens on anthropic wire**
  - [ ] Implement or map `POST /v1/messages/count_tokens` faithfully.
  - [ ] Unit tests: extend `packages/llm-gateway/tests/router.test.ts` + new fixture if needed.
  - [ ] Lot gate: `make test-llm-gateway ENV=test-gw-wires`.
- [ ] **Lot 4 — Mesh operational gaps**
  - [ ] Gap 1: silent account expiry → pre-expiry warning or diagnostic in error.
  - [ ] Gap 2: negative cache 300s + single eligible account kills all routes → graceful degrade.
  - [ ] Gap 3: sticky fail-closed on deleted accounts → auto-drop affinities to deleted accounts at resolve.
  - [ ] Gap 4: inventory not reloaded after enroll → hot-reload or systematic warning.
  - [ ] Unit tests per gap in `packages/llm-mesh/tests/` (new + existing file list).
  - [ ] Lot gate: `make typecheck-llm-mesh ENV=test-gw-wires`, `make test-llm-mesh ENV=test-gw-wires`.
- [ ] **Lot 5 — CI integration tests (real process)**
  - [ ] Spawn real gateway process: boot, restart, hot enroll, old-token re-presentation.
  - [ ] New: `packages/llm-gateway/tests/gateway-lifecycle.test.ts` (or equivalent path).
  - [ ] Wire into CI (declare `GWV-EX1` first if `.github/workflows/**` touched).
  - [ ] Lot gate: full `make test-llm-gateway ENV=test-gw-wires` + `make test-llm-mesh ENV=test-gw-wires`.
- [ ] **Lot 6 — UAT (real CLIs)**
  - [ ] UAT muse CLI via gateway with enrolled muse account (chat + stream).
  - [ ] UAT vibe CLI via gateway with enrolled mistral-vibe account (chat + stream).
  - [ ] UAT Claude Code count_tokens path.
  - [ ] Record results in `## Feedback Loop`.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` (muse/vibe wires, count_tokens, gap fixes).
  - [ ] No `spec/BRANCH_SPEC_EVOL.md` needed (single-spec update).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint for impacted packages.
  - [ ] Retest: `make test-llm-mesh ENV=test-gw-wires`, `make test-llm-gateway ENV=test-gw-wires`.
  - [ ] Pre-bump check: `npm view @sentropic/llm-mesh version`, `npm view @sentropic/llm-gateway version`; bump `packages/llm-mesh/package.json` + `packages/llm-gateway/package.json` semver (patch or minor per change).
  - [ ] Equivalence council check: `make check-llm-model-equivalences` (or CI equivalent) green.
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve blockers.
  - [ ] Final gate step 3: once UAT + CI `OK`, commit removal of `BRANCH.md`, push, merge.
  - [ ] Publish via CI OIDC (`publish-llm-mesh`, `publish-llm-gateway`); verify npm versions.
  - [ ] Mark loop `gw-muse-vibe-wires` done; reply to `agent:conductor:38f44695f2ad`.
