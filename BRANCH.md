# Feature: PR #572 clean-install parity residual

## Objective

- [x] Make clean root workspace installation and the five residual CI gates deterministic from `package-lock.json`.
- [x] Preserve Cluster Mesh behavior while keeping `packages/llm-mesh/**` and `packages/llm-gateway/**` identical to `origin/main`.
- [x] Preserve the persisted folder context on a direct Matrix load so lock/presence hydration can complete.

## Scope / Guardrails

- [x] Keep work on `feat/cluster-mesh-central-control-plane` in `tmp/feat-cluster-mesh-central-control-plane`.
- [x] Use Make-only Docker-first commands with the owner-requested `ENV=test-cm-572fix3` lane (API 9397, UI 5597, Maildev 1497); retain the independent audit lane `ENV=test-cm-572fix4` (API 9399, UI 5599, Maildev 1499).
- [x] Keep changes limited to clean-install hydration, API-image build order, and API-local compatibility with mainline LLM packages.
- [x] Never bypass hooks, inflate timeouts, use `ENV=dev`, or merge to main.

## Branch Scope Boundaries (MANDATORY)

- [x] **Allowed Paths (implementation scope)**
  - [x] `BRANCH.md`
  - [x] `package-lock.json`
  - [x] `packages/chat-core/package.json`
  - [x] `packages/comments/package.json`
  - [x] `packages/mcp-platform/package.json`
  - [x] `packages/build-cli/templates/chat-app/**`
  - [x] `packages/build-cli/tests/**`
  - [x] `api/src/routes/namespaces/**`
  - [x] `api/src/services/llm-runtime/gateway-route-plane.ts`
  - [x] `.dockerignore`
- [x] **Forbidden Paths (must not change in this residual)**
  - [x] `packages/llm-mesh/**`
  - [x] `packages/llm-gateway/**`
  - [x] `.github/workflows/**`
  - [x] `docker-compose*.yml`
  - [x] `rules/**`
  - [x] `plan/**`
  - [x] `.track/**`
- [x] **Conditional Paths (allowed only through `BR75-EX9`)**
  - [x] `Makefile`
  - [x] `api/Dockerfile`
  - [x] `ui/src/routes/+layout.svelte` (allowed only through `BR75-EX13`)
- [x] **Exception process**
  - [x] Declare reason, exact paths, impact, rollback, and disposition in `## Feedback Loop` before commit.

## Feedback Loop

- [x] `BR75-EX9` — `acknowledge` — reason: clean CI has no stale root dependencies and the standalone targets plus API image build Cluster Mesh before its bumped Events dependency is hydrated; exact paths: `Makefile` and `api/Dockerfile`; impact: hydrate declared workspaces, use Contracts' declared build script, and compile contracts then events before Cluster Mesh; rollback: revert the target prerequisites, workspace install list, Contracts build runner, Events manifest copy, and image build order; disposition: directly authorized by the owner request to make clean install and all five red jobs green.
- [x] `BR75-RV91` — `acknowledge` — the top-level workspace versions and links were correct, but clean parity exposed stale nested Chat Core/Comments dependency ranges that installed registry Contracts/Events 0.1 copies; the exact consumer compile failure was missing `hono`, `@sentropic/contracts`, and `@sentropic/events`.
- [x] `BR75-RV92` — `acknowledge` — full clean `prepare-node-workspace` passes, lock regeneration is byte-stable, and `package-lock.json` retains 1,675 package entries.
- [x] `BR75-RV93` — `acknowledge` — the main merge removed the prior branch plan before residual CI repair; this compact residual plan restores the mandatory scope-check source while preserving the historical plan in commit `61812ce9b`.
- [x] `BR75-RV94` — `acknowledge` — the owner-mandated recursive consumer audit found stale published-package ranges in the build-cli chat-app templates; exact paths: `packages/build-cli/templates/chat-app/**` and matching version-lock tests under `packages/build-cli/tests/**`; impact: generated apps consume the branch package versions instead of excluded 0.1 releases; rollback: restore the old template ranges and golden assertions.
- [x] `BR75-RV95` — `acknowledge` — the final clean cycle exposed `npm error code ENOTCACHED` for an inferred `https://registry.npmjs.org/tsc` request from `npx --offline tsc`; invoking Contracts' declared `npm run build` prevents npm from inferring the unrelated `tsc` package and keeps the offline build deterministic.
- [x] `BR75-EX10` — `acknowledge` — CI run `34040626703` exposed that API source imports `@sentropic/chat-server` while the image never compiled Chat Server or its Chat Core workspace dependency; exact paths: `api/Dockerfile` and `.dockerignore`; impact: copy both manifests, build Contracts/Events then Chat Core/Chat Server, and exclude host workspace `dist/` outputs so local image builds cannot mask a fresh-checkout failure; rollback: remove the two manifest/build steps and the workspace-dist ignore rule; disposition: required by the owner's clean-image acceptance.
- [x] `BR75-EX11` — `acknowledge` — CI run `34041253178` exposed the same missing Chat Server declarations in `typecheck-lint-api`; exact path: `Makefile`; impact: make Chat Server build after Chat Core and include it in `prepare-node-workspace` so fresh API typechecks cannot consume an unbuilt workspace link; rollback: remove the prerequisite and preparation entry; disposition: required by the owner's clean API-gate acceptance.
- [x] `BR75-RV97` — `acknowledge` — one persistent clean execution from `clean-node-modules` passed API typecheck/lint, Cluster Mesh 82/82 plus pack, MCP Platform 94/94 plus pack/API Extractor, Flow typecheck/build/pack, and the no-cache production API image `1b0b35db97c2`; selective/full/image installs resolved 280/1,490/1,187 packages from the 1,675-entry lock.
- [x] `BR75-EX12` — `acknowledge` — CI run `34042409057` exposed that the `test-api-unit-integration` matrix failed at runtime with `ERR_MODULE_NOT_FOUND` for `@sentropic/chat-server/dist/index.js`: `up-api-test-ci` (CI test-stack preparation) omitted `build-chat-server` while `prepare-node-workspace` already builds it, so the mounted API imported an unbuilt workspace link (branch-new `api/src/routes/namespaces/streams-product-events.ts` is the first API runtime consumer of Chat Server; `main` never imported it); exact path: `Makefile`; impact: add `build-chat-server` to `up-api-test-ci` prerequisites so the CI test runtime builds Chat Server (transitively Chat Core, Events, Contracts) before the API starts; rollback: remove the prerequisite; disposition: required to make the API unit/integration matrix green for the cluster-mesh→main merge.
- [x] `BR75-EX13` — `acknowledge` — CI run `34043685103` exposed that the root layout deleted the persisted `currentFolderId` while hydrating the initial authenticated session, so a direct `/matrix` load could not build its workspace-scoped lock key; exact path: `ui/src/routes/+layout.svelte`; impact: preserve the persisted folder only through initial session hydration while retaining clears for later user and workspace changes; rollback: remove the initial-hydration guard; disposition: required for the intended direct Matrix lock/presence flow and explicitly authorized by the owner.

## AI Flaky tests

- [x] No AI-flaky result is used for acceptance.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch**
- [x] Keep the residual correction on the existing PR branch because all failures share clean-workspace dependency and version-boundary causes.

## Plan / Todo (lot-based)

- [x] **Lot 1 — Clean workspace dependency parity**
  - [x] Hydrate Cluster Mesh, Flow, and MCP Platform declared workspaces before standalone gates.
  - [x] Align Chat Core and Comments internal dependency ranges with Contracts 0.3.0 and Events 0.2.1, then remove their obsolete nested 0.1 lock entries.
  - [x] Add Hono as MCP Platform's build-time development dependency and regenerate the root lock.
  - [x] Invoke Contracts' declared build script so clean offline builds resolve the installed TypeScript compiler deterministically.
  - [x] Copy/build Events before Cluster Mesh in the API image.
  - [x] Pass clean `prepare-node-workspace`, Cluster Mesh 82/82 plus pack, MCP Platform 94/94 plus pack/API Extractor, Flow typecheck/build/pack, and no-cache API image build.
  - [x] Align build-cli chat-app template ranges and pass its typecheck plus 120/120 tests.
- [x] **Lot 2 — API compatibility with mainline LLM packages**
  - [x] Keep the LLM Mesh Hono transport API-local after `packages/llm-mesh/**` is reset to main.
  - [x] Adapt product caller projection and route-intent observation to the mainline gateway ports without changing `packages/llm-gateway/**`.
  - [x] Pass API typecheck/lint and the focused gateway, cutover, and mesh-contract regressions at 11/11.
- [x] **Lot 3 — Final verification and handoff**
  - [x] Pass `make scope-check` on the complete intended diff.
  - [x] Confirm lock entry count/version links, no LLM package diff, and final disk space above the 30G guard.
  - [x] Commit atomically, stop the isolated stack, and push this branch without merging.
  - [x] Build the API image without host workspace outputs after CI exposed the missing Chat Core/Chat Server image build order.
  - [x] Build Chat Core and Chat Server declarations during clean workspace preparation before API typecheck/lint.
  - [x] Preserve persisted Matrix folder context through initial session hydration without weakening later account/scope isolation.
