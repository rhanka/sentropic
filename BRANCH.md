# Feature: Start the cm-account-approve Job through the A4 launcher composition (T1)

## Objective
- [ ] The governed account approval Job (`deploy/k8s/base/38-cm-account-approve-job.yaml`) starts through `/run/cm-runtime/launch.mjs --script cm-account-approve`, so it receives the same composed email-code HMAC custody as the api pod (preprod 08/11 04:00: the Job could not run and the script was started by hand in the api pod).
- [ ] The A4 launcher gains a `--script <name>` mode that runs `/workspace/api/dist/scripts/<name>.js` under the same composition; the api, `--idp` and `--custodian` modes are unchanged.

## Scope / Guardrails
- [ ] Train T1 wagon (s-archi verdict `.tmp/rv/app-plan-archi-verdict.md`, inventory `.tmp/rv/app-cm-inventory.md` §3.1.3); branch `fix/cm-account-approve-launcher` from origin/main `c22163106`; worktree `tmp/worktrees/t1-cm-account-approve-launcher`; no PR (train lane assembles).
- [ ] Make-only, Docker-first, no Python; `ENV=test-t1b-launch` last; ports API_PORT=9282 UI_PORT=5482 MAILDEV_UI_PORT=1182 (no stack started by this wagon); never ENV=dev; end with `make down-volumes ENV=test-t1b-launch`.
- [ ] No version bump, lock, fixture or image pin change (train lane).
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/38-cm-account-approve-job.yaml`
  - `deploy/k8s/overlays/preprod/a4-runtime/launch.mjs`
  - `deploy/ci/preprod-a4/launch-script.test.mjs`
  - `scripts/ci/cm-account-approve-job.test.mjs`
  - `docs/oauth-client-rotation.md`
  - `Makefile` (`cm-account-approve-job` target only, under BRCMAL-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `**/package.json`, `**/package-lock.json` (train lane)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `deploy/k8s/overlays/prod/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] `BRCMAL-EX1` (Makefile, `cm-account-approve-job` target only): Opus review M1, an operator checkout newer than the namespace launcher would boot `dist/index.js` (second api, migrations, `object_locks` purge). Reason: one read-only preflight line refusing before any Secret or Job unless ConfigMap `sentropic-a4-runtime` serves the `--script` mode. Impact: the target fails closed earlier; no other target touched. Rollback: delete the preflight line.
- [ ] `attention`: the Job now requires the A4 runtime in its namespace (ConfigMap `sentropic-a4-runtime`, Secret `email-code-hmac`, ConfigMap `api` with the Q-K policy); prod gets it from `feat/prod-a4-operator`, whose launcher must keep the `--script` mode and the same ConfigMap name.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (train T1 wagon; the train lane merges the wagon branches)
- Rationale: owner WAGON MODEL, one PR and one CI per train.

## UAT Management (in orchestration context)
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read verdict, inventory §3.1.3, `.tmp/rv/cm-account-approve-job.md`, night plan 04:00 entry.
  - [x] Worktree on origin/main `c22163106`, ENV and ports above.
- [ ] **Lot 1 — Launcher script mode (tests first)**
  - [x] `deploy/ci/preprod-a4/launch-script.test.mjs`: `--script cm-account-approve` maps to the dist script; traversal, empty, uppercase and suffixed names are refused; the main block refuses an invalid target with `launch_target_invalid` before composing secrets; api and `--idp` targets unchanged.
  - [x] `launch.mjs`: `--script` mode and distinct target refusal.
- [ ] **Lot 2 — Job composition (tests first)**
  - [x] `scripts/ci/cm-account-approve-job.test.mjs`: command through the launcher; HMAC env only by `secretKeyRef` and identical to the preprod-a4 api wiring; read-only `cm-runtime` ConfigMap volume; no custody PVC; envFrom unchanged.
  - [x] `38-cm-account-approve-job.yaml` and `docs/oauth-client-rotation.md`.
- [ ] **Lot 3 — Final validation**
  - [ ] `make test-preprod-a4 ENV=test-t1b-launch`.
  - [ ] `make test-publishable-manifests SCOPE="scripts/ci/cm-account-approve-job.test.mjs scripts/ci/oauth-service-client-job.test.mjs" ENV=test-t1b-launch`.
  - [ ] `make test-preprod-a4-manifests ENV=test-t1b-launch`.
  - [ ] Opus read-only review `.h2a/reviews/t1-cm-account-approve-launcher-opus.md`; push branch (no PR).
