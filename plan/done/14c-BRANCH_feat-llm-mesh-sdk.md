# Branch Plan: BR-14c LLM Mesh SDK

Current coordination source:

- `spec/SPEC_EVOL_SENTROPIC_BR14_ORCHESTRATION.md`
- `spec/SPEC_EVOL_LLM_MESH.md`
- `BRANCH.md` in `tmp/feat-llm-mesh-sdk`

Branch:

- BR-14c `feat/llm-mesh-sdk`

Ordering rule:

- BR-14c is the first BR-14 implementation branch.
- It defines the `@sentropic/llm-mesh` public model-access contract, cuts the application LLM runtime over to that package, and publishes the first `@sentropic` npm library before BR-14b chat-service modularization and BR-14a chat SDK extraction.

Scope summary:

- Published npm package boundary for `@sentropic/llm-mesh`.
- Providers: OpenAI, Anthropic/Claude, Google/Gemini, Mistral, Cohere.
- Auth modes: direct token, user token, Codex-account mode.
- Later account targets prepared: Gemini Code Assist, Claude Code.
- Normalized streaming, tool capability, and model capability contracts.
- Real API workspace import of `@sentropic/llm-mesh`; relative source imports are not sufficient.
- Strict application LLM runtime cutover to the package.
- Deletion of replaced app-local provider/runtime implementation in the same branch.
- Preservation of credential precedence, quotas, retries, streaming order, tool-call continuation, reasoning controls, traces/audit metadata, and live AI behavior.
- CI/CD package validation and npm publication for `@sentropic/llm-mesh`.

Lot outline:

- Lot 0 — Baseline and audit:
  - Read project rules and orchestration specs.
  - Validate Graphify-backed reusable/app-specific function classification.
  - Confirm branch environment, ports, exceptions, and package ownership.
- Lot 1 — Public package contract:
  - Define public provider/model IDs, capability matrix, auth descriptors, normalized generation/streaming/tool/result/error contracts.
  - Add deterministic package tests under `packages/llm-mesh/tests/**`.
  - Gates: `make typecheck-llm-mesh`, `make test-llm-mesh`, `make typecheck-api`, `make lint-api`.
- Lot 2 — Provider adapters and capability matrix:
  - Extract reusable provider descriptors and adapter scaffolds for OpenAI, Anthropic, Google, Mistral, and Cohere.
  - Preserve existing app behavior until the strict cutover lot.
  - Update provider/runtime unit tests at file level.
- Lot 3 — Auth modes and account transports:
  - Model direct token, user token, workspace/environment token, and Codex-account auth.
  - Keep Gemini Code Assist and Claude Code as future account transport hooks.
  - Preserve current credential precedence.
- Lot 4 — Application runtime cutover:
  - Declare `@sentropic/llm-mesh` as a real workspace dependency for the API.
  - Replace relative proof imports with `@sentropic/llm-mesh`.
  - Migrate `api/src/services/llm-runtime/**` dispatch to the package.
  - Delete app-local provider/runtime code replaced by the package; no dual path, no feature flag, no fallback alias.
  - Preserve quotas, retries, streaming order, tool-call continuation, reasoning controls, trace/audit metadata, and live AI behavior.
- Lot 5 — Live-provider split strategy:
  - Run deterministic package/API tests without credentials.
  - Run live AI tests only when branch credentials exist, split by provider so failures are attributable.
  - Record provider-specific pass/fail/flaky signatures in `BRANCH.md`.
- Lot 6 — npm publication lane:
  - Finalize `packages/llm-mesh/package.json`, package README, version policy, exports, files, and dist build.
  - Add make-backed `build-llm-mesh`, `pack-llm-mesh`, and `publish-llm-mesh` flow.
  - Adapt `.github/workflows/ci.yml` for package path filters, PR package validation, and `main`-only npm publication using CI npm credentials.
  - Keep BR-07/BR-12 publishing scope unchanged for UI/plugin artifacts.
- Lot 7 — Docs consolidation:
  - Consolidate the strict runtime cutover and npm publication contract into durable specs.
  - Keep BR14b scoped to chat-service core above the mesh runtime.
- Lot 8 — Final validation:
  - Rerun post-cutover package/API/live-AI gates.
  - Validate root UAT chat streaming and AI settings against the mesh-backed runtime.
  - Verify branch CI package validation before PR completion and npm publish after merge.

Exit criteria:

- The API imports `@sentropic/llm-mesh` as a real workspace package.
- The live app LLM runtime uses the package, and replaced app-local runtime/provider code is removed.
- The package builds, packs, and validates in CI.
- On merge to `main`, CI/CD can publish `@sentropic/llm-mesh` as the first `@sentropic` npm library.
