# Feature: deliver SECRET_ENCRYPTION_KEY to running environments

## Objective
- [ ] Give `SECRET_ENCRYPTION_KEY` a delivery path. The auth lane shipped the versioned keyring (PR #464, draft) but the variable reaches no runtime: it is absent from the k8s secret bundle and from every docker-compose file, so step 1 is INERT and its acceptance gate cannot distinguish "correctly provisioned" from "never provisioned".
- [ ] Deliver the pipe EMPTY. Provisioning an actual value is a data migration, not a config change — see the hazard below.

## Scope / Guardrails
- [ ] Delivery only. No app code, no key generation, no value set anywhere.
- [ ] The variable must default to EMPTY on every path. The api resolves the at-rest key as `env.SECRET_ENCRYPTION_KEY || '<literal>'`, so any non-empty default silently re-keys the cipher.
- [ ] No `deploy/k8s/**` change needed: `30-api.yaml` and `35-auth-idp.yaml` consume the secret via `envFrom.secretRef: sentropic-api`, so a key added to the bundle propagates automatically.
- [ ] Security work is under embargo — dedicated branch, no cross-mixing with the CI branches.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`, `ui/**`, `packages/**` (the keyring itself belongs to the auth lane, PR #464)
  - `deploy/k8s/**` (owned by the sibling preprod-postgres branch, and not needed here)
  - `.github/workflows/ci.yml` (owned by the sibling filter-guard branch)
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `BR-INFRA-EX4`
  - `docker-compose*.yml` — covered by `BR-INFRA-EX5`

## Feedback Loop
- `BR-INFRA-EX4` — **Makefile** (default Forbidden Path).
  - Reason: `k8s-bundle-secret` is the only place that materialises the `sentropic-api` Secret consumed by prod. A key absent there can never reach a container.
  - Impact: two added lines — one `get` read, one `--from-literal`. Every other key untouched. When `.env` carries no value the emitted key is present-but-empty, which the api treats exactly as absent, so behaviour is unchanged.
  - Rollback: remove the two lines.
  - Owner ratification: WP-INFRA scope exception on dedicated branches (2026-07-29).
- `BR-INFRA-EX5` — **docker-compose.yml, docker-compose.idp.yml** (default Forbidden Path).
  - Reason: the same variable must reach dev/test runtimes, otherwise the keyring is untestable outside prod. The owner-ratified exception named `ci.yml` + `Makefile`; compose is required by the nature of the assigned delivery and is declared here rather than silently taken.
  - Impact: one added `environment` entry per file, both defaulting to empty.
  - Rollback: remove the two entries.
- `attention` — **provisioning a value is a breaking data migration, not a config edit.** The api derives the v1 key as `sha256(SECRET_ENCRYPTION_KEY || 'dev-secret-key-change-in-production-please')`. Live environments carry no value today, so every stored envelope is sealed with the literal. Writing a real key without first adding it to the keyring as a READER makes all BYOK connection secrets and drive tokens undecryptable at once — silently, because GCM only fails on read. Sequencing that migration is the auth lane's call (PR #464), not this branch's.
- `deferred` — no `.env.example` created. None has ever existed in this repo, and authoring a complete one means enumerating every secret the platform consumes — a separate piece of work with its own review. The delivery here does not depend on it.

## AI Flaky tests
- Not applicable: no AI-backed test is touched.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one narrow delivery. Kept separate from the CI branches (PR #471, #472) because the security work is embargoed and moves at a different cadence.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change. Acceptance is asserted by the auth lane once PR #464 lands, by observing that a provisioned value actually reaches the container.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm `SECRET_ENCRYPTION_KEY` has zero occurrences on `origin/main`.
  - [x] Read the contract from PR #464: optional in the zod schema, `||` fallback to a literal, empty-string must fall through.
  - [x] Confirm `envFrom.secretRef` propagation, so no `deploy/k8s/**` edit is required.
  - [x] Create isolated worktree `tmp/infra-secret-key`.
  - [x] Declare `BR-INFRA-EX4` and `BR-INFRA-EX5`.

- [x] **Lot 1 — Delivery paths**
  - [x] Add `SECRET_ENCRYPTION_KEY` to the `sentropic-api` Secret in `k8s-bundle-secret`.
  - [x] Add it to the `api` service in `docker-compose.yml`, defaulting to empty.
  - [x] Add it to `docker-compose.idp.yml`, defaulting to empty.
  - [x] Document in-file why the empty default is load-bearing.
  - [x] Lot gate:
    - [x] `docker-compose.yml` and `docker-compose.idp.yml` parse as YAML.
    - [x] The key appears once per compose file and twice in the Makefile (read + emit).
    - [x] No `deploy/k8s/**`, `api/**` or `ci.yml` path touched.

- [ ] **Lot N — Handover**
  - [ ] Notify the auth lane that the pipe exists and that the value must be sequenced as reader-before-writer.
