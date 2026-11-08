# Feature: Preprod GB4 live and builder configuration

## Objective
- [x] Carry the GB4 preprod configuration under Git (owner GO 2026-11-07 « Oui, GB4 GO préprod », preprod only): cm/api builder composition and SG0-app broker values, cm/artifact-content supervisor relay and live edge flags.

## Scope / Guardrails
- [x] Branch deploy/preprod-gb4-live from main 591f5eee1; worktree tmp/worktrees/preprod-gb4-live; ENV=test-gb4-iac.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Prod untouched: `overlays/prod` and base unchanged; selftests change preprod expectations only.
- [x] Secrets stay out of Git: Secret sentropic-api keys were written by the ops lane, names only here.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `apps/**`
  - `packages/**`
  - `deploy/k8s/base/**`
  - `deploy/k8s/overlays/prod/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `deploy/k8s/overlays/preprod-a4/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: merge ONLY after the builder-composition PR is merged and deployed (s-archi order); a ConfigMap apply restarts nothing, so `rollout restart deploy/api deploy/artifact-content` follows the merge.
- [x] `attention`: `APP_ARTIFACT_CONTENT_ENABLED` stays `0`: content serving needs `DATABASE_URL`, dedicated `APP_ARTIFACT_S3_*`, Secret `artifact-content-signing` and an object-store egress change, all absent in preprod; with the flag on the content process refuses startup and takes the supervisor relay down with it.
- [x] `attention`: `APP_ARTIFACT_LIVE_ENABLED=1` is inert until content serving opens (the edge is composed inside it).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one overlay PR, one CI.

## Plan / Todo (lot-based)
- [ ] **Lot 1 — Preprod overlay and selftests**
  - [ ] cm/api: `ARTIFACT_BUILDER_ENABLED=1`, placement, `d2-4-preprod`, relay and live-edge internal URLs, remote host URL, host bindings, GitHub App broker values (live values, unchanged).
  - [ ] cm/artifact-content: `APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED=1`, `APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS` (public SPKI, kid sentropic-preprod-supervisor-1), `APP_ARTIFACT_LIVE_ENABLED=1`.
  - [ ] Selftests: per-tier relay/builder/live expectations (prod declares none), runtime-parser checks of the preprod values, deny cases.
  - [ ] Lot gate: `make test-artifact-content-manifests API_PORT=8841 UI_PORT=5241 MAILDEV_UI_PORT=1141 ENV=test-gb4-iac`.
- [ ] **Lot 2 — PR**
  - [ ] PR « deploy(preprod): GB4 live and builder configuration », CI green on the exact head, GLM review; merge by s-conductor after builder-composition is deployed.
