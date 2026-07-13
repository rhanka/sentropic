# Feature: cited-source-viewer publish wiring (bootstrap → npm 0.2.0)

## Objective
Wire the CI/Makefile publish path for `@sentropic/cited-source-viewer` so 0.2.0 (graphify-iso, merged via PR #412) can be published to npm — unblocking the graphify 0.5 non-regression pivot. Owner-authorized publish ("publie", 2026-07-13). Recreates the stale/conflicting PR #386's publish wiring cleanly on current main.

## Scope / Guardrails
- Publish infra only: CI validate+publish jobs, Makefile publish targets, the dist-form package.json rewriter, .gitignore.
- Package code unchanged (0.2.0 already on main).
- Publish pattern MIRRORS the current main Svelte-src package pattern (identical to `publish-auth-ui`: OIDC `id-token: write`, `make publish-...`, bootstrap `make publish-...-token`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cited-source-viewer/scripts/**`
  - `BRANCH.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — `BR-CSVP-EX1`
  - `.github/workflows/ci.yml` — `BR-CSVP-EX1`
  - `.gitignore` — `BR-CSVP-EX1`
- **Forbidden Paths**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`

## Scope Exceptions
- `BR-CSVP-EX1` — touch `Makefile` + `.github/workflows/ci.yml` + `.gitignore` (default-forbidden infra). Rationale: publish wiring for a package that must reach npm (owner-authorized "publie"). Impact: additive publish/validate jobs + Makefile targets + a publish-time package.json rewriter, mirroring the existing per-package publish pattern; no change to other packages' jobs. Rollback: revert this commit (no runtime/app effect; the package code is untouched).

## Feedback Loop
- `acknowledge`: owner GO "publie" (2026-07-13) — first publish requires the one-shot bootstrap (`workflow_dispatch bootstrap_publish_target=cited-source-viewer`, NPM_TOKEN) then attach the OIDC trusted publisher on npmjs.com. Steady-state publishes then run tokenless via OIDC.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single small infra PR recreating PR #386's wiring on current main.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Publish wiring**
  - [x] `ci.yml`: add `cited-source-viewer` to bootstrap options + path filters (validate/publish) + `validate-cited-source-viewer` (typecheck/test/dom/build/pack) + `publish-cited-source-viewer` (OIDC) + bootstrap step (token).
  - [x] `Makefile`: `build-` (svelte-package), `pack-`, `publish-`, `publish-*-token` targets (BR-CSVP-EX1).
  - [x] `packages/cited-source-viewer/scripts/make-publish-pkgjson.mjs`: dist-form package.json rewriter (chat-ui pattern).
  - [x] `.gitignore`: publish artefact ignore.
  - [x] typecheck green.
  - [ ] Lot gate: CI `validate-cited-source-viewer` GREEN (proves build + pack).

- [ ] **Lot 2 — Publish (owner-gated infra)**
  - [ ] Merge this PR.
  - [ ] Bootstrap: `workflow_dispatch` `bootstrap_publish_target=cited-source-viewer`.
  - [ ] Attach OIDC trusted publisher on npmjs.com (Playwright).
  - [ ] Verify `npm view @sentropic/cited-source-viewer version` = 0.2.0.
  - [ ] Relay to graphify: run the 0.5 non-regression pivot (consume 0.2.0, delete local interim, its 4 viewer test files green).
