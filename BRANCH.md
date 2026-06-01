# Fix: Cowork Desktop K8s Env

## Objective
Propagate Sentropic Cowork desktop download configuration into the Kubernetes API Secret so a secret redeploy can expose the configured desktop installer URL in the portal.

## Scope / Guardrails
- Scope limited to Kubernetes secret bundling and deployment documentation.
- No application behavior changes.
- No package source changes.
- Branch development happens in isolated worktree `tmp/fix-cowork-desktop-k8s-env`.
- Automated checks use focused static validation only; no dev services are started.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile`
  - `deploy/k8s/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `deploy/k8s/*.yaml`
- **Exception process**:
  - `BR41OPS-EX1` authorizes the minimal `Makefile` edit because `k8s-bundle-secret` is the source of truth for creating the live `sentropic-api` Secret from `K8S_ENV_FILE`.

## Feedback Loop
- `BR41OPS-EX1` — status: `acknowledge`; reason: `Makefile` is default-forbidden, but the root cause is missing keys in `k8s-bundle-secret`; impact: the target will include optional Cowork desktop release/prerelease download metadata in `sentropic-api`; rollback: remove the added variable reads and `--from-literal` entries.

## AI Flaky tests
- Not applicable. No AI tests are changed or run for this config-only ops fix.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one isolated ops wiring fix with no parallel workstream.

## UAT Management (in orchestration context)
- No UI UAT is required for the code change itself.
- Operational validation after merge/deploy: run `make k8s-bundle-secret KUBECONFIG=<path> K8S_ENV_FILE=<env-file> ENV=<env>` with `COWORK_DESKTOP_DOWNLOAD_URL` set, then restart/deploy API and confirm the Settings Cowork card returns a download URL.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/fix-cowork-desktop-k8s-env` and verify branch `fix/cowork-desktop-k8s-env`.
  - [x] Confirm root cause: API reads `COWORK_DESKTOP_*`, but `make k8s-bundle-secret` does not add those keys to `sentropic-api`.
  - [x] Declare `BR41OPS-EX1` for the minimal `Makefile` edit.

- [ ] **Lot 1 — Secret bundle propagation**
  - [x] Add Cowork desktop release/prerelease download variables to `k8s-bundle-secret`.
  - [x] Update `deploy/k8s/README.md` with the optional Cowork variables and operator redeploy step.
  - [ ] Lot gate:
    - [x] Focused red check before fix: `k8s-bundle-secret` lacks `COWORK_DESKTOP_DOWNLOAD_URL`.
    - [x] Focused static check after fix: `k8s-bundle-secret` includes all `COWORK_DESKTOP_*` literals.
    - [x] `make -n k8s-bundle-secret KUBECONFIG=/tmp/fake-kubeconfig K8S_ENV_FILE=/tmp/fake-sentropic.env ENV=fix-cowork-desktop-k8s-env`.

- [ ] **Lot 2 — Final validation**
  - [x] Review diff scope.
  - [x] Record live operator command needed after merge.
