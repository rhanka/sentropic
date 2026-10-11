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
- [ ] **Lot 0 — Baseline & repro**
  - [ ] Read `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md` wire surface sections.
  - [ ] Read `packages/llm-gateway/src/router/index.ts`, `src/wire.ts`, `src/flow.ts`, `src/canonical-ingress.ts`.
  - [ ] Read `packages/llm-mesh/src/route-planner.ts`, `src/route-health.ts`, `src/routing-targets.ts`, enrollment service.
  - [ ] Baseline gates green: `make typecheck-llm-mesh ENV=test-gw-wires`, `make typecheck-llm-gateway ENV=test-gw-wires`, `make test-llm-mesh ENV=test-gw-wires`, `make test-llm-gateway ENV=test-gw-wires`.
  - [ ] Repro muse CLI pointed at local gateway: capture request path, headers, body; record why 400.
  - [ ] Repro vibe CLI pointed at local gateway: capture request; record why 503 no-route.
  - [ ] Record measured wire facts for muse + vibe CLIs in `## Feedback Loop`.
  - [ ] Confirm scope and guardrails.
- [ ] **Lot 1 — Muse ingress adapter**
  - [ ] Add muse wire ingress (models list route + OpenAI-compat passthrough incl. required headers/SSE shapes).
  - [ ] Unit tests: `packages/llm-gateway/tests/muse.test.ts` (new).
  - [ ] Update `packages/llm-gateway/tests/router.test.ts` (existing).
  - [ ] Update `packages/llm-gateway/tests/contract-snapshot.test.ts` (existing).
  - [ ] Mesh hooks if required for muse dispatch (list files touched).
  - [ ] Lot gate: `make typecheck-llm-gateway ENV=test-gw-wires`, `make test-llm-gateway ENV=test-gw-wires`.
- [ ] **Lot 2 — Vibe ingress adapter**
  - [ ] Add vibe wire ingress (resolve 503 path to eligible mistral-vibe account; models list).
  - [ ] Unit tests: `packages/llm-gateway/tests/vibe.test.ts` (new).
  - [ ] Update `packages/llm-gateway/tests/router.test.ts` (existing).
  - [ ] Mesh hooks if required for vibe dispatch (list files touched).
  - [ ] Lot gate: `make typecheck-llm-gateway ENV=test-gw-wires`, `make test-llm-gateway ENV=test-gw-wires`.
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
