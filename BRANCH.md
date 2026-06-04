# Feature: Externalize google-auth-library in API esbuild bundle

## Objective
Fix the production API image boot crash (`Error: Dynamic require of "child_process" is not supported`) by externalizing `google-auth-library` and its transitive deps from the boot esbuild bundle, the same way `pg`/`exceljs` are already treated.

## Scope / Guardrails
- Scope limited to `api/package.json` `build` script `--external:` list.
- No migration in this branch.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/fix-gcp-bundle`.
- Automated validation runs on dedicated env (`ENV=e2e-gcpfix`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (not used here)
  - `.github/workflows/**` (not used here)
- **Exception process**:
  - Declare exception ID `BR-FIXGCP-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`; never amend tests with additive timeouts; capture user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single-file build fix; single final test cycle)
- [ ] **Multi-branch**
- Rationale: One-line build-config fix on a single file; no sub-workstreams.

## Root Cause
- [x] PR #235 (BR-43 llm-mesh-gcp) added `google-auth-library` to the boot import chain (`api/src/services/providers/gcp-provider.ts` -> `provider-registry.ts` -> boot) but did NOT add it to the esbuild `--external:` list.
- [x] Result: `google-auth-library` (CJS, uses `require('child_process')`) gets bundled into the ESM `dist/index.js`; esbuild emits a `Dynamic require` shim that throws at boot in the production image only (dev uses tsx/native require).
- [x] Reproduced 100% locally on pure `main` (`4abf87aa`): API container crashes at boot, AFTER migrations complete. Repo-wide e2e red. BR-14e (#202) is innocent.
- [x] `google-auth-library`, `gcp-metadata`, `gtoken`, `gaxios`, `google-logging-utils` are all prod deps, hoisted top-level in `api/package-lock.json` -> survive `npm prune --omit=dev` and resolve at runtime via require once externalized.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm isolated worktree `tmp/fix-gcp-bundle` off `origin/main`.
  - [x] Confirm scope = `api/package.json` build script only.
  - [x] Define env mapping: `ENV=e2e-gcpfix`, API_PORT=8729, UI_PORT=5129, MAILDEV_UI_PORT=1029.

- [ ] **Lot 1 — Externalize google-auth-library**
  - [x] Add `--external:google-auth-library --external:gcp-metadata --external:gtoken --external:gaxios --external:google-logging-utils` to the first esbuild command (`src/index.ts`) in `api/package.json` `build` script.
  - [ ] Lot gate:
    - [ ] Local repro proof: `make build-api-image` then `make up-e2e` (`ENV=e2e-gcpfix`, REGISTRY=local) -> `make logs-api` shows server listening, no `Dynamic require` error.
    - [ ] `make down ENV=e2e-gcpfix`

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR (full e2e green = fix proven repo-wide).
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md`, push, and merge.
