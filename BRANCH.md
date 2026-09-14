# Fix: CloudCode model reachability via account catalogue (0.19.2)

## Objective
Resolve the CloudCode `daily` 404 by fetching the account's model catalogue (`fetchAvailableModels`) and sending the catalogue-announced wire id for the requested model x effort, refusing fail-closed any model absent from the catalogue. Bump `@sentropic/llm-mesh` 0.19.1 to 0.19.2.

## Scope / Guardrails
- Build on the measured probe verdict (root cause = wire identifier); do not re-run live network probing.
- Never read, print, or modify keyring, credential, or secret material.
- Do not change `@sentropic/contracts`.
- Keep the `@sentropic/llm-mesh` public contract backward-compatible; bump `0.19.1` to `0.19.2`.
- Do NOT change the stream request envelope/headers: ping G proved the 0.19.1 envelope is accepted with the correct id. Fix is catalogue + mapping + fail-closed only.
- Make-only gates on `ENV=test-*`; never `ENV=dev`.
- Do not push, open a pull request, publish, or add attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/enrollment/cloud-code.ts`
  - `packages/llm-mesh/src/transport/cloud-code-runtime-client.ts`
  - `packages/llm-mesh/tests/enrollment/cloud-code.test.ts`
  - `packages/llm-mesh/tests/transport/cloud-code-runtime-client.test.ts`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/contracts/**`
  - `packages/llm-mesh/src/errors.ts`
  - `packages/llm-mesh/src/transport/cloud-code-transport.ts`
  - `packages/llm-gateway/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Declare a `BRCAT-EXn` item in `## Feedback Loop` before touching a forbidden path.

## Feedback Loop
- [x] No exception is required for the scoped package correction.

## AI Flaky tests
- [x] N/A; all scoped tests mock Cloud Code catalogue and stream responses.

## Orchestration Mode
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] The catalogue, mapping, and version lots are sequential and independently committed.

## Plan / Todo
- [ ] **Lot 1 - Catalogue fetch**
  - [x] Add `fetchAvailableModels` (POST `/v1internal:fetchAvailableModels`, body `{"project": <cloudaicompanionProject>}`, Antigravity headers) to the CloudCode path.
  - [x] Parse root fields: `models` (keys), `tieredModelIds`, `defaultAgentModelId`, `deprecatedModelIds`.
  - [ ] Cache per session/lease (avoid a network call per stream); focused tests with mocked fetch.
- [ ] **Lot 2 - Wire-id mapping + fail-closed**
  - [ ] Resolve model x effort -> wire id: `<model>-<effort>` if in `models`, else `<model>-tiered` + `thinkingLevel`, else refuse fail-closed (clear error) before streaming.
  - [ ] Wire the resolved id into `providerRequest` (replace verbatim base id).
  - [ ] Tests: suffixed-exists, tiered-fallback, fail-closed-absent, no-regression.
- [ ] **Lot 3 - Patch version and final gates**
  - [ ] Bump `@sentropic/llm-mesh` 0.19.1 -> 0.19.2.
  - [ ] Pass llm-mesh typecheck, build, and tests on a dedicated test ENV.
  - [ ] Commit atomically; confirm no push, PR, or publish.
