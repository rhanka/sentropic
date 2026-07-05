# Feature: cited-source-viewer publish wiring (post-#385 follow-up, architect-commissioned)

## Objective
Wire `@sentropic/cited-source-viewer` (merged on main at 49a5ec470, v0.1.0) into the repo's standard publish pipeline: dist-form pack-time rewrite (chat-ui BR-PKG-EX1 pattern), OIDC steady-state publish + one-shot token bootstrap path, and the missing `validate-cited-source-viewer` CI job so the package's tests gate CI. No publish is executed in this branch (architect ref: env:architect-385-merged-followups-20260705T1710Z).

Note: this file also replaces the stale `BRANCH.md` of the merged #385 (its merge-prep removal step was skipped at merge time).

## Scope / Guardrails
- Scope limited to `packages/cited-source-viewer/scripts/**`, `Makefile` (package-scoped targets), `.github/workflows/ci.yml` (additive entries), this `BRANCH.md`.
- NO publish execution, NO merge — the architect gates the PR.
- Repo package.json stays src-form; dist-form exists ONLY inside the pack/publish transient rewrite (chat-ui precedent).
- Make-only workflow; small atomic commits; no Co-Authored-By.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cited-source-viewer/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `api/**`, `ui/**`, `e2e/**`, other `packages/*`
- **Conditional Paths (with declared exceptions below)**:
  - `Makefile` (BR-CSVP-EX1)
  - `.github/workflows/ci.yml` (BR-CSVP-EX2)
- **Exception process**: declared before touching, see Feedback Loop.

## Feedback Loop
- `attention` — **BR-CSVP-EX1 (Makefile)**: (1) refit `build-cited-source-viewer` from bare tsc to `svelte-package` dist (full publishable dist: transpiled TS + copied plain-JS .svelte + d.ts — chat-ui build precedent, minus the lang="ts" strip our sources do not need); (2) add `pack-cited-source-viewer`, `publish-cited-source-viewer` (OIDC), `publish-cited-source-viewer-token` (bootstrap) mirroring the chat-ui targets. Impact: package-scoped targets only. Rollback: restore tsc build, delete the three new targets.
- `attention` — **BR-CSVP-EX2 (.github/workflows/ci.yml, additive only)**: add `cited_source_viewer`/`cited_source_viewer_publish` change filters + outputs, `validate-cited-source-viewer` job (typecheck/test/test-dom/build/pack), `publish-cited-source-viewer` job (OIDC, main-only, needs validate), `cited-source-viewer` in the `bootstrap_publish_target` dispatch options + bootstrap step. Mirrors chat-ui verbatim. Rollback: delete the added blocks.
- `attention` — requirement (c) `enforce-package-bump`: NO change needed — the job iterates `packages/*/` dynamically (ci.yml `enforce-package-bump`); with the package on main at 0.1.0, the bump gate applies to every future `src/**` change automatically. Attested, not modified.
- `attention` — first-publish runbook (architect executes, NOT this branch): trigger `workflow_dispatch` on ci.yml with `bootstrap_publish_target=cited-source-viewer` (uses NPM_TOKEN via `publish-cited-source-viewer-token`), then attach the OIDC trusted publisher on npmjs.com (package → Settings → Trusted Publisher → rhanka/sentropic, workflow ci.yml); steady-state publishes then flow through `publish-cited-source-viewer` (OIDC, no token).

## AI Flaky tests
- None expected (wiring branch; package tests are deterministic).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single wiring concern, one test cycle.

## UAT Management (in orchestration context)
- No UI surface. Verification = make gates run locally (real outputs) + CI on the PR.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/cited-source-viewer-publish` on `feat/cited-source-viewer-publish` off origin/main (49a5ec470).
  - [x] Read chat-ui publish mechanics (make-publish-pkgjson.mjs, build/pack/publish/token targets, ci.yml validate/publish/bootstrap jobs, enforce-package-bump).
- [ ] **Lot 1 — Publish wiring**
  - [x] (a) `packages/cited-source-viewer/scripts/make-publish-pkgjson.mjs` (chat-ui pattern) + svelte-package dist build + `pack-cited-source-viewer`.
  - [x] (b) `publish-cited-source-viewer` (OIDC) + `publish-cited-source-viewer-token` (bootstrap) + ci.yml publish job + dispatch option + bootstrap step.
  - [x] (c) enforce-package-bump attestation (no change).
  - [x] (d) `validate-cited-source-viewer` ci.yml job + change filters.
  - [x] Lot gate (real outputs):
    - [x] `make typecheck-cited-source-viewer` (exit 0) + `make test-cited-source-viewer` (22/22) + `make test-cited-source-viewer-dom` (17/17)
    - [x] `make build-cited-source-viewer` (svelte-package dist: js + d.ts + plain-JS svelte + svelte.d.ts) + `make pack-cited-source-viewer` (PASS sanity; dist-form main/types/exports verified; src-form package.json restored — no diff)
- [ ] **Lot N — Final validation**
  - [ ] Version bump not required (no `src/**` change; enforce-package-bump skips) — verify in CI.
  - [ ] PR with BRANCH.md body; architect gates; no merge, no publish from this branch.
