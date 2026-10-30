# Perf: API image slim — install only the API dependency closure

## Objective
- [x] `api/Dockerfile` installs only the dependency closure of the api workspace and the packages it builds (explicit `-w` `npm ci`, lockfile-exact per #846), with a derived reduced lock/manifest set and a BuildKit npm cache mount, so unrelated workspace version bumps stop invalidating the dependency layer and the image stops shipping UI dependencies.

## Scope / Guardrails
- [x] Branch `perf/api-image-slim` from `origin/main` (`1b7f8ab94`); worktree `tmp/worktrees/api-image-slim`.
- [x] Environment `ENV=test-api-slim` for any stack command; ENV always LAST; never `ENV=dev`.
- [x] One Docker build at a time under the flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; `make down ENV=test-api-slim` after stack steps.
- [x] Make targets for repo operations; `make commit MSG="..."` only; each commit under 150 changed lines; selective staging.
- [x] CI lockfile-lane policy acknowledged (review_by=2026-11-30T00:00:00Z); installs resolve committed tool profiles, frozen consumer closures, or the api image's derived pruned lock (`npm ci`; every entry verbatim from the committed root lock).
- [x] 0 Python; English only; no time estimates; no `make clean-all`; draft PR, no merge.
- [x] Keep every gate: audit gate (`.security/audit-gate.mjs`), canonical-tag contract (`scripts/test-api-image-canonical.sh`), toolbox contract (`scripts/test-api-tooling.sh`), `make check-ci-version-filters`.

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, packet `.tmp/packets/api-image-slim.md` + `COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/api-image-slim` from `origin/main`; `harness check branch` PASS.
  - [x] Baseline measurements (before): warm rebuild `B0` (102 s, 2.7 GB dev image) and version-bump-only rebuild `B1` (unrelated workspace bump: `packages/mcp-connector-slack` 0.0.0→0.0.1; 311 s, 2.7 GB); bump reverted after measuring.
- [x] **Lot 1 — BRANCH.md + exception**
  - [x] `BRIS-EX1` declared in `## Feedback Loop` before touching `api/Dockerfile`.
- [x] **Lot 2 — Dockerfile dependency slimming** (commits `1477ae2e4`, `67bd43287`)
  - [x] `deps-manifests` stage: derive the reduced manifest + pruned lock set (api closure only; no ui manifest). Offline validation: pruned output byte-stable across the unrelated bump; `npm ci` dry run against the pruned tree resolves 776 packages lockfile-exact.
  - [x] `deps` stage: `npm ci --legacy-peer-deps --include-workspace-root -w api -w <closure workspaces>` with `--mount=type=cache,target=/root/.npm`, then the existing audit gate on the installed tree. `--legacy-peer-deps` is required for lockfile exactness: with the ui workspace gone, nothing satisfies chat-core's optional `@sentropic/chat-ui` peer, and npm would re-resolve it from the registry instead of the committed lock. `--legacy-peer-deps` also drops peer-only lock entries at install time; the installed set's only such entry is `jose` (peer of `oauth-verify`, `auth-client`, `auth-hono`, `mcp-auth`), so the prune stage re-declares it as a regular dependency of the derived root manifest and mirrors it in the pruned lock's root entry — the lock-pinned version installs in dev and survives the production prune (offline validation: `JOSE_DEV=present`, `JOSE_PROD=present`, both audit gates OK).
  - [x] `base`/`ci-tools`/`production` stages re-parented onto the slim install; `ui/package.json` retained in the production image per the canonical-tag contract.
  - [x] `make scope-check` before each commit (PASS C2 x3).
- [x] **Lot 3 — Local verification gates**
  - [x] `make test-ci-api-image-canonical` resolve + tag-inputs + guard-collision cases (host-only) — PASS (8+7+1 cases). `retained-exclusions` runs in CI against the built production image (no local image: disk floor breach, see below).
  - [x] `make test-ci-api-tooling` — PASS (5 cases).
  - [x] `make check-ci-version-filters` — PASS.
  - [x] Offline lock/toolchain validation: nested `esbuild@0.18.20`, `esbuild@0.19.12`, `vitest@4.1.5`, `tsx@4.23.1`, `typescript@5.4.5`, `@sentropic/track@0.91.1`, `isolated-vm@6.1.2`, `gray-matter@4.0.3`, `hono@4.13.0`, `vite@7.3.7` all present in the pruned lock (994/1700 entries).
  - [x] `TARGET=development` local build + `A0` after-measurements — cold build 186.8 s (compose-reported), dev image 1.78 GB; warm rebuild 4 s (compose 3.7 s), all layers cache hits.
  - [x] `A1` bump-only rebuild — `packages/mcp-connector-slack` 0.0.0→0.0.1 (manifest + lock `packages["packages/mcp-connector-slack"].version`), build, revert: 8 s (compose 8.2 s); `deps-manifests` re-derived and the `npm ci` layer was CACHED (content-addressed proof the re-derived prune output is bit-identical); image unchanged at 1.78 GB.
  - [x] `TARGET=production` local build (`make build-api-image`, no-cache canonical flow) — 284 s wall (compose 262.1 s); canonical tag `498618`, image 829 MB, artifact receipt recorded.
  - [ ] `--target ci-tools` local build — still deferred: CI-verified on the exact head (run 2 `build-api-tool-image` green; the toolbox ran the whole 26/26 api-test-matrix), locally withheld again at 9.9 G free (below the 15 G floor, other lanes building, image removal forbidden).
  - Instrument disclosure: every build under the lane flock, timing after lock acquisition, `ENV=test-api-slim`/`COMPOSE_PROJECT_NAME=test-api-slim`; the first `A0` cold invocation escaped the flock through a quoting bug in the flock wrapper (no concurrent image build; another lane's container-run workspace builds overlapped) and its wall clocking was broken, so `A0` cold is compose-reported; the warm, `A1` and production runs were correctly flocked (the warm run visibly queued behind another lane's lock). `make down ENV=test-api-slim` done after the builds.
- [x] **Lot 4 — Final validation**
  - [x] Measurement-only bump already reverted (nothing to revert: `A1` never ran; worktree clean).
  - [x] Draft PR with before/after sizes and rebuild times in the body (after-measurements marked blocked with the exact instrument to re-run).
  - [ ] One CI run on the final head; result recorded in the report. Run 1 (`41103381243`, head `b2a030bb8`) failed: the pruned install lost `jose` — `--legacy-peer-deps` drops peer-only lock entries, so `oauth-verify`'s tsc hit `TS2307: Cannot find module 'jose'`. Fixed by the prune-stage jose re-declaration (root regular dep, mirrored in the pruned lock root entry; offline validation E7/E8: all 18 workspace builds + api build + idp bundle + both audit gates green, jose kept through the production prune). Run 2 (`41108398571`, head `ed3307793`): every job green except `validate-publishable-manifests` — the lockfile guard regression fails on `assert.ok(plan.includes('review_by=<BRLOCK-EX1 review_by>'))` because this branch's `BRANCH.md` replaced the root `BRANCH.md` and dropped the lockfile-lane policy acknowledgment the guard requires on branches whose scope touches container installs (`BRLOCK-EX1` scope). All policy `review_by` dates are unexpired: the run-1 note calling this a pre-existing calendar expiry was wrong, and the slim install itself is already lockfile-exact (the guard's scan-tree regression passes against this tree). Fix: carry the acknowledgment (`review_by=2026-11-30T00:00:00Z`) in `## Scope / Guardrails`; the guard is untouched and not weakened. The next push is the definitive run on the new head; its result goes in the report.
  - [x] Report to `.tmp/rv/api-image-slim-vibe.md`; stop (no merge).
