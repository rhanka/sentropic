# Feature: Preprod repin to the 7990bc182 main build

## Objective
- [x] Repin the preprod overlay image digests to the main 7990bc182 CI build (run 42463322455) so continuous deployment brings preprod to #951/#954/#956 (incl. the cm-account-approve job assets) as a plain digest swap after the A4 cutover, and keep the preprod-only bundle selftest asserts in lockstep.

## Scope / Guardrails
- [x] Branch deploy/preprod-repin-7990bc182 from main 7990bc182 (head of run 42463322455); worktree tmp/worktrees/preprod-repin-7990; ENV=test-preprod-repin-7990.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Prod untouched: `overlays/prod`, `overlays/preprod-a4` and base unchanged; prod digest asserts stay as-is.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `packages/**`
  - `.github/workflows/**`
  - `deploy/k8s/overlays/prod/**`
  - `deploy/k8s/base/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql` (max 1 file)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - No exception used in this branch.

## Feedback Loop
- [x] `attention`: digests are sourced only from run 42463322455 (head 7990bc182, branch main) publish-api-image / publish-ui-image job receipts; each digest verified in GHCR by `docker manifest inspect` with the config digest matching the publish receipt, and anonymously pullable via `make check-preprod-images`.
- [x] `attention`: auth-idp, artifact-content and the cm-account-approve job all ride the `ghcr.io/rhanka/sentropic-api` image pin (base uses `sentropic-api:main` for all four workloads); only the api and ui digests exist to repin, both swapped here.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one mechanical digest swap with its selftest assert; one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repin**
  - [x] `overlays/preprod`: api `sha256:6e382dc1…19`, ui `sha256:ec201329…54` (both from the 7990bc182 build); provenance comment updated; auth-idp/artifact-content/cm-account-approve inherit the api pin.
  - [x] `bundle.selftest.mjs` preprod asserts follow the new digests; prod asserts unchanged.
  - [x] Lot gate: `make check-preprod-images ENV=test-preprod-repin-7990` (both digests anonymously pullable) and `make test-artifact-content-manifests ENV=test-preprod-repin-7990` (32/32 offline tests, A4 bundle selftest PASS on all three tiers).
- [ ] **Lot 2 — PR**
  - [ ] PR « deploy(preprod): repin api and ui to the 7990bc182 build », CI green on the exact head, GLM review, merge by s-conductor.
