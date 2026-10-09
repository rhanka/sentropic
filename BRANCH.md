# Feature: Mistral runtime client for llm-mesh (mirror of the muse transport pattern)

## Objective
Add the mesh-side Mistral upstream transport (MistralRuntimeClient) serving the documented api.mistral.ai OpenAI-compatible chat wire, mirroring muse-runtime-client.ts, with strict wire projection so gateway ingress metadata never reaches Mistral.

## Scope / Guardrails
- Scope limited to the @sentropic/llm-mesh mistral runtime transport and its mirror surfaces in cluster-mesh tests.
- Make-only workflow, no direct Docker or npm commands on host.
- Branch development happens in isolated worktree .worktrees/llm-mesh-mistral-client.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/transport/mistral-runtime-client.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/tests/transport/mistral-runtime-client.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
  - `packages/cluster-mesh/tests/fixtures/types/llm-consumer.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `attention`: measured live 422 extra_forbidden on body.messages[0].user.metadata (Mistral rejects mesh-internal ingress metadata) — resolved by toWireMessage projection, regression test added.
- [x] `attention`: OpenAI SSE ` terminator would surface as a raw payload string — resolved by dropping it like muse.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`, with at least one success on the same commit and command; never amend tests with additive timeouts.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal SDK transport, no UI/API/E2E surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`.
  - [x] Confirm isolated worktree `.worktrees/llm-mesh-mistral-client` and develop there.
  - [x] Confirm Make-only command style (`make typecheck-llm-mesh`, `make lint-llm-mesh`, `make test-llm-mesh`, `make test-cluster-mesh`).
  - [x] Validate scope boundaries (Allowed/Forbidden/Conditional).
- [x] **Lot 1 — Mistral runtime client**
  - [x] `packages/llm-mesh/src/transport/mistral-runtime-client.ts` implements `MistralAdapterClient` (chat-completions wire, Bearer API key, no muse session header).
  - [x] `packages/llm-mesh/src/index.ts` re-exports `MistralRuntimeClient` (same leaf as muse/codex/cloud-code).
  - [x] Lot gate:
    - [x] `make typecheck-llm-mesh`
    - [x] `make lint-llm-mesh`
    - [x] `make test-llm-mesh` (34 files, 336 tests)
- [x] **Lot 2 — Strict wire projection**
  - [x] `toWireMessage` projects role/content/name/tool_calls/tool_call_id, maps developer to system, images to image_url, omits reasoning/file parts.
  - [x] Regression test: ingress metadata never reaches the wire.
  - [x] Lot gate: `make test-llm-mesh`
- [x] **Lot 3 — cluster-mesh mirror surfaces**
  - [x] `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts` lists `MistralAdapter`/`MistralRuntimeClient` leaves.
  - [x] `packages/cluster-mesh/tests/fixtures/types/llm-consumer.ts` compile fixture lists both.
  - [x] Lot gate: `make test-cluster-mesh SCOPE=tests/integrations/llm-surface.spec.ts` + `make typecheck-cluster-mesh`
- [x] **Lot 4 — Final validation**
  - [x] Typecheck & lint
  - [x] `make test-llm-mesh` full suite
  - [x] Bumped affected `packages/llm-mesh/package.json` version (minor 0.24.0, new exported runtime client) — enforced by CI `enforce-package-bump`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once CI is OK, commit removal of `BRANCH.md`, push, and merge.
