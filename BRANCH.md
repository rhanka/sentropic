# Feature: BR-14f Node Workspace Monorepo Infra

## Objective
Introduce the minimal repo/tooling baseline required for `api`, `ui`, and future internal Node packages to coexist cleanly in one monorepo. The branch must unblock BR-14c's thin app proof path without switching away from `make`, without introducing Nx, and without moving `api/` or `ui/` under `packages/`.

## Scope / Guardrails
- Scope limited to Node workspace metadata, Docker/make wiring, and compatibility documentation for active branches.
- Make remains the root orchestrator.
- `api/` and `ui/` stay as application roots; reusable packages stay under `packages/*`.
- The branch must not introduce `@entropic/llm-mesh` itself; BR-14c keeps ownership of the package contract and proof after rebase.
- Branch development happens in isolated worktree `tmp/chore-node-workspace-monorepo-14f`.
- Automated tests must run on dedicated environments, never root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `PLAN.md`
  - `plan/14f-BRANCH_chore-node-workspace-monorepo.md`
  - `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`
  - `package.json`
  - `package-lock.json`
  - `docker-compose.yml`
  - `docker-compose.dev.yml`
  - `docker-compose.test.yml`
  - `Makefile`
  - `api/package.json`
  - `api/package-lock.json`
  - `ui/package.json`
  - `ui/package-lock.json`
  - `ui/Dockerfile`
- **Forbidden Paths (must not change in this branch)**:
  - `README.md`
  - `README.fr.md`
  - `TRANSITION.md`
  - `packages/llm-mesh/**`
  - `tmp/feat-llm-mesh-sdk/**`
  - `tmp/feat-gdrive-sso-indexing-16a/**`
  - `tmp/feat-pptxgenjs-tool-21a/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `scripts/**`
  - `api/src/**`
  - `ui/src/**`
- **Exception process**:
  - Declare exception ID `BR14f-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `clarification` BR14f-D1 — Keep `make` as the top-level orchestrator. This branch adds a root Node workspace baseline only; it does not switch the repo to Nx.
- [x] `clarification` BR14f-D2 — Keep `api/` and `ui/` at repo root as application roots. The target layout is app roots plus reusable `packages/*`, not `packages/api` and `packages/ui`.
- [x] `clarification` BR14f-D3 — Root workspace lockfile strategy: keep per-app lockfiles intact for now and add a root `package.json` workspace immediately; generate/commit a root `package-lock.json` through `make lock-root` once the workspace-aware containers boot successfully.
- [x] `clarification` BR14f-D4 — Pin the UI-side Svelte workspace resolution explicitly (`@sveltejs/kit` + `@sveltejs/vite-plugin-svelte`) so root workspace installs resolve to the already-known compatible line instead of drifting to a newer peer set during Docker builds.
- [x] `attention` BR14f-I1 — BR-14c depends on BR-14f for the thin API proof path only. BR-14f must not absorb the mesh contract or product behavior.
- [x] `attention` BR14f-I2 — BR-16a can continue in parallel, but will need a shallow rebase after BR-14f lands because its test/runtime paths depend on the same `api`/`ui` container wiring.
- [x] `attention` BR14f-I3 — BR-21a is low-impact and should preferably merge before BR-14f to avoid needless rebase churn on a near-finished branch.
- [x] `attention` BR14f-T1 — `npm run typecheck` in the `api` workspace now boots from the root-mounted container but no longer returns in a reasonable time, while `tsc --showConfig` and service startup remain healthy. Treat this as a real follow-up blocker before merge rather than masking it with looser flags.
- [x] `fix` BR14f-F1 — Root workspace hoisting made API typecheck resolve the UI-pinned `typescript@5.9.3` from `/workspace/node_modules` instead of the API-intended `5.4.5`, and `make typecheck-api`/`make lint-api` were running inside the long-lived dev container path. Pin root `typescript` to `5.4.5`, keep UI on its own `5.9.3`, and route API typecheck/lint through ephemeral image-backed `docker compose run --rm --no-deps api ...` so the command uses the deterministic workspace lockfile toolchain and returns.
- [x] `fix` BR14f-F2 — CI still assumed pre-workspace paths and node_modules behavior in two places: `build-ext-chrome` / `build-ext-vscode` were validating artifacts under `/app/...` instead of `/workspace/ui/...`, and `make up-api-test-ci` started the root-mounted dev command from the prebuilt API image without restoring workspace dev dependencies into `/workspace/node_modules`. Point the artifact checks at `/workspace/ui/...` and prime the mounted workspace lockfile install before booting the CI API stack.
- [x] `validation` BR14f-V1 — Fresh proof on commit `3ddb6d71`: `make typecheck-api`, `make lint-api`, `make typecheck-ui`, and `make lint-ui` all return under `ENV=test-chore-node-workspace-monorepo-14f`. API lint still reports the existing 184 `no-console`-heavy warnings with 0 errors, and UI typecheck still reports the existing 6 Svelte warnings with 0 errors.
- [x] `validation` BR14f-V2 — Rebase simulations on 2026-04-25 show BR-14c (`813a4d3f`), BR-16a (`59dc47af`), and BR-21a (`df41d0ed`) replay onto BR14f after resolving only branch-tracker docs (`BRANCH.md`, plus `PLAN.md` for BR-16a). No workspace, compose, lockfile, or runtime code conflicts surfaced in the simulated rebases.
- [x] `validation` BR14f-V3 — Fresh CI-path proof on 2026-04-25: `make build-ext-chrome`, `make build-ext-vscode`, and `make up-api-test-ci` all complete under `ENV=test-chore-node-workspace-monorepo-14f` with the workspace-root mounts and the updated artifact paths.
- [x] `attention` BR14f-EX1 — `ui/Dockerfile` joins BR14f scope because the branch moved the UI image build context to repo root. The production stage still copied `nginx/default.conf` as if the context were `ui/`, which breaks `make build-ui-image` after the workspace baseline rebase. Impact: packaging path only. Rollback: revert the Dockerfile path change and restore the previous UI-only build context strategy.
- [x] `validation` BR14f-V4 — Rebasing BR14f onto `origin/main` on 2026-04-25 surfaced one real workspace follow-up: `make build-ui-image` failed because `ui/Dockerfile` still used the pre-workspace `nginx/default.conf` path, and the rebased root workspace lockfile no longer included newer `main` dependencies such as `pptxgenjs`. After correcting the root-relative nginx path and making `make lock-root` refresh the root lockfile through an ephemeral Node container, local CI-targeted proofs all passed again under `ENV=test-chore-node-workspace-monorepo-14f`: `make lock-root`, `make build-ui-image`, `make up-api-test-ci`, `make test-api-unit`, and `make test-api-smoke`.
- [x] `fix` BR14f-F3 — PR `#125` run `24956801574` showed every red `test-api-unit-integration` shard shared the same narrower bootstrap/runtime mismatch: `make up-api-test-ci` restored workspace dev dependencies with `docker-compose.dev.yml`, then restarted the API stack with `docker-compose.yml + docker-compose.test.yml` only. That second leg dropped the root repo bind mount and `workspace_node_modules` volume, so the test stack fell back to the production image filesystem and failed immediately on `sh: vitest: not found`. Keep the `up -d api --wait` leg on `docker-compose.dev.yml + docker-compose.test.yml` so CI reuses the same workspace mount/volume contract that the bootstrap install populated.
- [x] `validation` BR14f-V5 — Fresh cold-path proof on 2026-04-26 under `ENV=test-chore-node-workspace-monorepo-14f-ci`: `make build-api-image`, `make up-api-test-ci`, `make test-api-unit`, and `make test-api-smoke` now pass after restoring `docker-compose.dev.yml` on the CI `up -d api --wait` leg. This reproduces the prior `vitest: not found` failure on a new named-volume namespace, then clears it with the minimal wiring change.
- [x] `validation` BR14f-V6 — PR `#125` run `25415161869` is green on the rebased head `760f0f48` after rerunning the single failed live-AI shard `test-api-unit-integration (ai, initiative-generation-async,executive-summary-sync)`. The first failure signature was `api/tests/ai/initiative-generation-async.test.ts:470` (`expected false to be true`, no generated initiative with `organizationId`); rerun success on the same commit records it as accepted live-AI flakiness with user sign-off on 2026-05-06.
- [x] `validation` BR14f-V7 — Dev/UAT capacity proof on 2026-05-06: `make dev API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f` boots the isolated workspace stack; `make ps API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f` shows API, Postgres, and Maildev healthy, UI up on `http://localhost:5115`, and API exposed on `http://localhost:8715`.
- [x] `validation` BR14f-V8 — Activation plan tightened in `PLAN.md` and `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`: BR14f is useful only if BR14c creates the first `packages/*` package and proves `api/` consumes it through the root workspace; BR14b and BR14a then activate the runtime and chat package layers on that contract.
- [x] `attention` BR14f-T3 — PR `#125` fresh CI rerun on the rebased head is green. The previous red API shards were explained by the workspace mount/volume loss in `up-api-test-ci`; the later single red live-AI shard is accepted as flaky after a same-commit success rerun.
- [x] `attention` BR14f-T2 — BR16a and BR21a are already merged into the current `main` baseline used by BR14f. PR `#125` now validates BR14f against that post-merge baseline; BR16c and later connector branches keep their own branch gates/UAT after rebasing.

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
- Rationale: BR-14f is a tight infra baseline branch. It must stay small and become the shared base for BR-14c and any still-open app branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only if local dev flows materially change.
- UAT checkpoints must be listed as checkboxes inside each relevant lot.
- Execution flow:
  - Develop and run tests in `tmp/chore-node-workspace-monorepo-14f`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`/home/antoinefa/src/entropic`, `ENV=dev`) only after branch is pushed and ready.
  - Switch back to `tmp/chore-node-workspace-monorepo-14f` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/chore-node-workspace-monorepo-14f`.
  - [x] Copy root `.env` into the branch worktree.
  - [x] Confirm active branch `chore/node-workspace-monorepo-14f`.
  - [x] Define environment mapping: `API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`.
  - [x] Define test mapping: `API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`.
  - [x] Confirm scope and guardrails.
  - [x] Update orchestration docs (`PLAN.md`, `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`) to include BR-14f and branch impact.

- [x] **Lot 1 — Root Node workspace baseline**
  - [x] Add a private root `package.json` with workspace metadata for `api`, `ui`, and `packages/*`.
  - [x] Decide lockfile strategy for the root workspace without breaking current `api`/`ui` flows.
  - [x] Keep `make` as the only supported entrypoint.
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make typecheck-ui API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`

- [x] **Lot 2 — Container and make wiring**
  - [x] Move `api`/`ui` container mounts to the repo root with explicit working directories.
  - [x] Adjust `make` / compose commands so workspace installs and service runs still work through `make`.
  - [x] Keep the resulting setup polyglot-ready: Node workspace for Node projects, no assumption that future Python services must join the same toolchain.
  - [x] Lot gate:
    - [x] `make up-api-test API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make typecheck-api API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make lint-api API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make typecheck-ui API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make lint-ui API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`

- [ ] **Lot 3 — Compatibility proof and branch impact**
  - [x] Prove the workspace baseline is sufficient for BR-14c to consume internal packages after rebase, without adding the `@entropic/llm-mesh` package itself in BR-14f.
  - [x] Record exact rebase impact and required follow-up for BR-14c, BR-16a, and BR-21a.
  - [x] Keep BR-16a and BR-21a behavior stable under the new container/runtime wiring.
  - [x] Record the downstream activation plan: BR14c must be the first real workspace package consumer, then BR14b and BR14a must consume the package contracts.
  - [x] Lot gate:
    - [x] `make ps API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
    - [x] `make down API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`

- [x] **Lot 4 — Docs consolidation**
  - [x] Consolidate final ordering and branch-contract notes in `PLAN.md` and `spec/SPEC_EVOL_ENTROPIC_BR14_ORCHESTRATION.md`.
  - [x] Update `BRANCH.md` feedback loop before final validation.

- [ ] **Lot 5 — Final validation**
  - [x] `make typecheck-api API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
  - [x] `make lint-api API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
  - [x] `make typecheck-ui API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
  - [x] `make lint-ui API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=test-chore-node-workspace-monorepo-14f`
  - [x] `make dev API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`
  - [x] `make ps API_PORT=8715 UI_PORT=5115 MAILDEV_UI_PORT=1015 ENV=chore-node-workspace-monorepo-14f`
  - [x] Create/update PR using `BRANCH.md` text as PR body.
  - [x] Verify branch CI and resolve blockers.
  - [ ] After merge, rebase BR-14c and any remaining active branches on the workspace baseline.
