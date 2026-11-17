# Feature: llm-mesh Muse client emulation for seat serving

## Objective
MuseRuntimeClient emulates the real Muse Code client (Responses wire `/v1/responses` + `muse-build` client headers) so enrolled Muse seats are served instead of refused with `403 client_attestation_denied` on the legacy Chat wire.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh` Muse transport + its tests, and the llm-gateway muse fixture consumer.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/fix-muse-headers`.
- Test campaigns on `ENV=test-muse-headers`, never on root dev.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/transport/muse-runtime-client.ts`
  - `packages/llm-mesh/tests/transport/muse-runtime-client.test.ts`
  - `packages/llm-mesh/tests/node/enroll-cli-probe.test.ts`
  - `packages/llm-gateway/tests/responses-cli-fixtures.test.ts`
  - `packages/llm-gateway/tests/request-model-receipt.test.ts`
  - `packages/llm-gateway/tests/fixtures/**`
  - `packages/llm-mesh/CHANGELOG.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge`: live A/B proof recorded 2026-11-17 — seat key on `POST /v1/chat/completions` returns `403 client_attestation_denied` with mesh and muse-client headers alike; the real muse client (captured locally) serves on `POST /v1/responses` with `muse-build/1.4.23` User-Agent + `x-client-id` + session headers, and that path returns 200 with the same seat key.

## AI Flaky tests
- [ ] No flaky accepted without same-commit success + sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single transport file, one test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one runtime client + its tests and one gateway fixture consumer.

## UAT Management (in orchestration context)
- [ ] No UI change, no UAT surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`.
  - [x] Create isolated worktree `tmp/fix-muse-headers` on `fix/llm-mesh-muse-client-headers` from `origin/main` (llm-mesh 0.38.1).
  - [x] Confirm live failure (403) and live success path (`/v1/responses`, 200) with the enrolled seat key.
- [x] **Lot 1 — Responses-wire Muse client emulation**
  - [x] Add failing tests: `/v1/responses` path, muse client headers, Responses SSE/JSON decoding.
  - [x] Rewrite `MuseRuntimeClient` on the Responses wire with muse client identity headers.
  - [x] Update the llm-gateway muse fixture to the Responses wire.
- [ ] **Lot 2 — Proof & publication**
  - [x] Mesh muse tests + full llm-mesh suite + typecheck green.
  - [x] Live seat call through the built client returns 200 text.
  - [x] Cross-provider cascade check (codex/mistral/cloud-code transports untouched, suites green).
  - [ ] Scope-check, commit, push, open PR.
