# Perf: API image slim — install only the API dependency closure

## Objective
- [ ] `api/Dockerfile` installs only the dependency closure of the api workspace and the packages it builds (explicit `-w` `npm ci`, lockfile-exact per #846), with a derived reduced lock/manifest set and a BuildKit npm cache mount, so unrelated workspace version bumps stop invalidating the dependency layer and the image stops shipping UI dependencies.

## Scope / Guardrails
- [ ] Branch `perf/api-image-slim` from `origin/main` (`1b7f8ab94`); worktree `tmp/worktrees/api-image-slim`.
- [ ] Environment `ENV=test-api-slim` for any stack command; ENV always LAST; never `ENV=dev`.
- [ ] One Docker build at a time under the flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; `make down ENV=test-api-slim` after stack steps.
- [ ] Make targets for repo operations; `make commit MSG="..."` only; each commit under 150 changed lines; selective staging.
- [ ] 0 Python; English only; no time estimates; no `make clean-all`; draft PR, no merge.
- [ ] Keep every gate: audit gate (`.security/audit-gate.mjs`), canonical-tag contract (`scripts/test-api-image-canonical.sh`), toolbox contract (`scripts/test-api-tooling.sh`), `make check-ci-version-filters`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/Dockerfile` (only under `BRIS-EX1`)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/**`
  - `scripts/**`
  - `packages/**`
  - `api/**` except `api/Dockerfile`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file; none expected)

## Feedback Loop
- `BRIS-EX1` (`attention`): scope exception to touch `api/Dockerfile` (declared before any edit).
  - Reason: the `dependencies` stage runs `npm ci --workspaces --include-workspace-root` over every copied workspace manifest (ui included), installing the whole monorepo (~2.7 G dev image); any workspace version bump or lockfile change invalidates that layer, so every lane rebuilds a private 2.7 G dependency layer and nothing is shared beyond the node base. The stage must install only the api closure (explicit `-w`, lockfile-exact per the #846 lockfile rule) from a derived reduced lock/manifest set with a BuildKit npm cache mount, so unrelated workspace bumps do not invalidate the dependency layer.
  - Impact: `api/Dockerfile` is an `API_VERSION` and `API_TOOL_VERSION` content-hash input, so the api image and CI toolbox tags change once on merge; CI `build-api-image`/`ci-build-api-tool` and local lanes rebuild on the new tags. Dev (`development`), test (`ci-tools`) and prod (`production`) targets keep their current runtime contract: same sources, same builds, same audit gates; only the installed dependency set shrinks (ui deps and their lock entries leave the image; `ui/package.json` stays a shipped, hashed input via the production stage per the canonical-tag contract). No migration, no data, no API surface change.
  - Rollback: single-file revert of `api/Dockerfile` to `origin/main`; the full-workspace install and the previous tags return with the next build; no coordinated changes elsewhere.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: single-file build change, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT surface (Dockerfile dependency selection only; no UI/runtime behavior change).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, packet `.tmp/packets/api-image-slim.md` + `COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/api-image-slim` from `origin/main`; `harness check branch` PASS.
  - [x] Baseline measurements (before): warm rebuild `B0` and version-bump-only rebuild `B1` (unrelated workspace bump: `packages/mcp-connector-slack`), recorded in the PR.
- [ ] **Lot 1 — BRANCH.md + exception**
  - [x] `BRIS-EX1` declared in `## Feedback Loop` before touching `api/Dockerfile`.
- [ ] **Lot 2 — Dockerfile dependency slimming**
  - [ ] `deps-manifests` stage: derive the reduced manifest + pruned lock set (api closure only; no ui manifest).
  - [ ] `deps` stage: `npm ci --legacy-peer-deps --include-workspace-root -w api -w <closure workspaces>` with `--mount=type=cache,target=/root/.npm`, then the existing audit gate on the installed tree. `--legacy-peer-deps` is required for lockfile exactness: with the ui workspace gone, nothing satisfies chat-core's optional `@sentropic/chat-ui` peer, and npm would re-resolve it from the registry instead of the committed lock; all non-optional peers of the installed set resolve from the pruned lock.
  - [ ] `base`/`ci-tools`/`production` stages re-parented onto the slim install; `ui/package.json` retained in the production image per the canonical-tag contract.
  - [ ] `make scope-check` before each commit.
- [ ] **Lot 3 — Local verification gates**
  - [ ] `TARGET=development` image builds; audit gate passes in-build.
  - [ ] `--target ci-tools` image builds.
  - [ ] `TARGET=production` image builds; prune + audit gate pass in-build.
  - [ ] `make test-ci-api-image-canonical` (all cases) green.
  - [ ] `make test-ci-api-tooling` green.
  - [ ] `make check-ci-version-filters` green.
  - [ ] After-measurements: warm rebuild `A0` + version-bump-only rebuild `A1` (same unrelated bump), recorded in the PR.
- [ ] **Lot 4 — Final validation**
  - [ ] Revert the measurement-only version bump; `make scope-check`; atomic commits.
  - [ ] Draft PR with before/after sizes and rebuild times in the body.
  - [ ] One CI run on the final head; CI completed/success.
  - [ ] Report to `.tmp/rv/api-image-slim-vibe.md`; stop (no merge).
