# Fix: llm-mesh transport contract-fidelity (0.19.3)

## Objective
Close three measured transport contract-fidelity defects (CloudCode + Codex) so the public contract reaches the wire and terminal states are reported truthfully. Bump `@sentropic/llm-mesh` 0.19.2 -> 0.19.3.

## Scope / Guardrails
- Build on i-cond's measured receipts; do not re-run live network probing.
- Never read, print, or modify keyring, credential, or secret material.
- Do not change `@sentropic/contracts`. Additive-only, backward-compatible changes to llm-mesh's own public types.
- Make-only gates on `ENV=test-*`; never `ENV=dev`.
- Do not push, open a pull request, publish, or add attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/generation.ts`
  - `packages/llm-mesh/src/streaming.ts`
  - `packages/llm-mesh/src/codex.ts`
  - `packages/llm-mesh/src/transport/cloud-code-runtime-client.ts`
  - `packages/llm-mesh/src/transport/codex-runtime-wire.ts`
  - `packages/llm-mesh/tests/transport/cloud-code-runtime-client.test.ts`
  - `packages/llm-mesh/tests/transport/codex-runtime-wire.test.ts`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/contracts/**`
  - `packages/llm-gateway/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Declare a `BRFID-EXn` item in `## Feedback Loop` before touching a forbidden path.

## Feedback Loop
- [x] No exception is required for the scoped package correction.

## AI Flaky tests
- [x] N/A; all transport responses are mocked.

## Orchestration Mode
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] The transport fidelity and version lots are sequential and independently committed.

## Plan / Todo
- [x] **Lot 1 - CloudCode responseFormat**
  - [x] Map `responseFormat: json-object` -> `generationConfig.responseMimeType = "application/json"`.
  - [x] Map `responseFormat: json-schema` -> project `responseFormat.schema` to the Cloud Code subset (reuse `projectCloudCodeSchema`) -> `generationConfig.responseSchema`, with dropped-constraint diagnostics.
  - [x] Wire-body test (json-object + json-schema). NOTE: responseMimeType is necessary-not-sufficient for the markdown fence (do not claim it fixes the fence).
- [x] **Lot 2 - CloudCode finishReason fidelity**
  - [x] `generate()` derives finishReason from the aggregated terminal event (mirror stream() MAX_TOKENS->'length'); stop hardcoding 'stop'.
  - [x] Add `providerRawFinishReason` (additive optional) carrying the raw provider reason.
  - [x] Expose `thoughtsTokenCount` from `usageMetadata` when present.
  - [x] Tests: MAX_TOKENS SSE via BOTH generate() and stream().
- [x] **Lot 3 - Codex max_output_tokens**
  - [x] Stop dropping `max_output_tokens` (codex.ts:78 destructures it out); pass `maxOutputTokens` -> `max_output_tokens` on the Codex wire.
  - [x] Wire-body test (cap present/enforced).
- [ ] **Lot 4 - Version + gates**
  - [x] Bump `@sentropic/llm-mesh` 0.19.2 -> 0.19.3.
  - [ ] Pass llm-mesh typecheck, build, tests on a dedicated test ENV; commit atomically; no push/PR/publish.
