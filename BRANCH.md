# Feature: Preprod CD + publish-staleness fix + prod-deploy neutralization (BR-55c / ARCH-17)

## Objective
Materialize the main→PREPROD continuous-deploy of the deployment-plane (SPEC_DECISION_DEPLOYMENT_PLANE.md, RATIFIED; co-designed + signed-off by architect ARCH-17 and conductor, D-c1..D-c5): on every `main` merge, build the immutable per-content image tags (already produced by `make version`) and deploy them to the ISOLATED `sentropic-preprod` namespace via the preprod-scoped `KUBE_CONFIG_DATA_PREPROD` credential — and NEUTRALIZE the legacy prod-targeting `deploy-k8s` job so that NO main merge can touch the `sentropic` (prod) namespace (prod moves ONLY via the gated `release-prod` of BR-55d). Kills the floating `:main` staleness by pinning the immutable content-hash tag into the preprod overlay at deploy time (D-c1). Preprod migrations run via `MIGRATE_ON_BOOT` (D-c2; the decoupled migration Job + gated db-restore-prod are PROD/BR-55d). SEPARATELY, fix the publish-staleness paths-filter (include `packages/auth-ui/**` + ALL publishable `@sentropic/*` + API_VERSION) so package/image currency never silently drops (D-c3 publish-part) — this section is co-owned by 39etc (their artifact-version-skew fix + auth-ui paths) and is CO-DESIGNED with them before freeze (D-c5). EXPLICITLY OUT: `release-prod.yml` tag→prod + D7/D8/D9 (BR-55d), the validation tier + federation + D15 (BR-55e). ZERO change to `overlays/prod` or `base`.

## Scope / Guardrails
- main→PREPROD only; PROD untouched. The PR asserts: **no main merge can touch the `sentropic` (prod) namespace**.
- `KUBE_CONFIG_DATA_PREPROD` is a GitHub secret (poc-k8s operator, namespace-scoped to `sentropic-preprod`, prod-inaccessible); cd READS it, never embeds it.
- Image immutability: pin the content-hash `API_VERSION`/`UI_VERSION` (from `make version`) into the preprod overlay at deploy time — never the floating `:main`.
- Make-only; `kubectl apply -k` via a make target (mirrors `k8s-deploy`).
- Root `ENV=dev` reserved for the user.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.github/workflows/ci.yml` (BR-55c IS the CI/CD lot: replace the prod `deploy-k8s` job with a `deploy-preprod` job; the publish-filter widening is co-designed with 39etc)
  - `deploy/k8s/overlays/preprod/**` (only if an `images:` pin hook is needed; default deploy-time pin is CI-ephemeral)
  - `deploy/k8s/README.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/k8s/base/**` (shared base, never mutated)
  - `deploy/k8s/overlays/prod/**` (prod must not move)
  - `api/src/**`, `packages/**` (no app code; this is CI/CD infra only)
- **Conditional Paths (allowed only with explicit BR55c-EXn exception)**:
  - `Makefile` (BR55c-EX1 — add `k8s-deploy-preprod`; default-forbidden, but the preprod deploy target is inherent to this CD lot)

## Feedback Loop
- `acknowledge` (BR-55c GO — double sign-off): architect ARCH-17 (env:1782097680, co-design D-c1..D-c5) + conductor (env-1c27fa5a9b854738, APPROVED D-c1..D-c5) both GO. Priority: this lot kills the manual deploys.
- `BR55c-EX1` (Conditional-path exception, MANDATORY): touches `Makefile` — adds `k8s-deploy-preprod` (kubectl apply -k overlays/preprod into ns `sentropic-preprod` with the content-hash image pin). Rationale: the preprod CD needs a deploy target mirroring `k8s-deploy`; impact: additive target, no existing target changed; rollback: drop the target.
- `attention` (BR55c-39etc — publish-filter co-design, D-c5, PENDING): the publish-staleness fix (widen the `changes` paths-filter + publish gating to `packages/auth-ui/**` + all publishable `@sentropic/*`) is in 39etc's co-owned ci.yml section (their #147 artifact-version-skew fix + auth-ui paths). Coordination SENT (env:scale-39etc-br55c-coord:01). I build the NON-39etc parts (deploy-preprod job + prod neutralization + image pin) now; the publish-filter widening lands after 39etc co-signs. Share the final ci.yml diff with conductor (via architect relay while his put is ambiguous) + 39etc before freeze.
- `acknowledge` (D-c4 = the critical one): the legacy `deploy-k8s` job auto-applied `overlays/prod` to the `sentropic` prod ns on every main push — fully NEUTRALIZED (replaced by `deploy-preprod`; verified: no `make k8s-deploy`/`overlays/prod`/`-n sentropic`/`KUBECONFIG_B64` left in any deploy path; ci.yml YAML parses, `deploy-k8s` job gone).
- `attention` (BR55c-PRODCRED-SMOKE — flag to architect, NOT changed here): the `test-smoke-restore` job still decodes `KUBECONFIG_B64` (full prod kubeconfig) to run `make db-backup-prod` — a READ-ONLY prod DB backup feeding the restore-smoke test (runs on api/global changes, PR + main). It does NOT deploy/write the prod ns (so the D-c4 namespace assertion holds), but it IS a remaining prod-cred codepath. Question for architect: keep (read-only, test-only) or move the restore-smoke source to a preprod/scratch backup under the decoupling (possibly with BR-55d's gated `db-restore-prod`)? Left unchanged pending the ruling.
- `acknowledge` (api-WebAuthn finding RESOLVED): coexistence api-1st-party-WebAuthn + IdP-OIDC = by-design, no migration → preprod stays auth model (b) PERMANENTLY (BR-55b unchanged). The validation auth-gating (AUTH_MODE=federation) is BR-55e, not here.
- `acknowledge` (poc-k8s DNS-01): preprod certs emit via DNS-01 (Cloudflare TXT), independent of the A records; the 2 nested A records (preprod.sentropic + preprod.auth → 51.159.11.157) only gate real traffic, posted at bring-up.

## AI Flaky tests
- N/A — CI/CD workflow + Makefile + docs; validation is `actionlint`/CI self-run + assert no prod-targeting remains.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one cohesive CD addition; co-design gate with 39etc on the publish section)
- [ ] **Multi-branch**

## UAT Management (in orchestration context)
- No UI surface. Validation = the cd workflow self-runs on this PR's branch push? (the deploy job is `if: github.ref == 'refs/heads/main'` so it only fires post-merge). Pre-merge: assert via grep that no main-triggered job targets the `sentropic` prod ns + the preprod job decodes `KUBE_CONFIG_DATA_PREPROD`. First real preprod bring-up is the post-merge run; then ping poc-k8s for the 2 A records.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & scoping**
  - [x] Worktree `tmp/cd-preprod` from `origin/main` (2795f231b, post-#354); `cp ../../.env .env`.
  - [x] Map ci.yml (deploy-k8s job L1519, publish-{api,ui}-image L1126/1162, changes/paths-filter L89) + Makefile (`k8s-deploy` L2597, `version` L75) FROM the worktree.
  - [x] Double GO (architect ARCH-17 + conductor) on D-c1..D-c5; 39etc coordination sent.

- [x] **Lot 1 — deploy-preprod job + prod neutralization + image pin (NON-39etc)**
  - [x] `Makefile`: added `k8s-deploy-preprod` (+ `K8S_PREPROD_NAMESPACE`; pins content-hash API_VERSION/UI_VERSION into overlays/preprod via an appended `images:` block at deploy time, `kubectl apply -k`, rollout on ns `sentropic-preprod`). BR55c-EX1. Dry-run expansion verified.
  - [x] `.github/workflows/ci.yml`: REPLACED the prod `deploy-k8s` job with `deploy-preprod` (decode `KUBE_CONFIG_DATA_PREPROD`, `make k8s-deploy-preprod`, rollout on `sentropic-preprod`); `if: always() && main && !cancelled() && publish-{api,ui}.result != 'failure'` (deploys on every main merge, incl. overlay-only changes when publish skips). No `sentropic` prod-ns target, no `KUBECONFIG_B64` in the deploy path.
  - [x] Validate: grep proves no main-triggered prod-ns DEPLOY remains; ci.yml YAML parses (55 jobs); Makefile dry-run OK. (`actionlint` not installed locally → CI lints.)
  - [x] `deploy/k8s/README.md`: documented the preprod CD + the prod-deploy neutralization (prod via BR-55d only; `make k8s-deploy` now manual-only).

- [ ] **Lot 2 — publish-staleness paths-filter (39etc CO-DESIGN, D-c3 publish-part)**
  - [ ] On 39etc co-sign: widen the `changes` paths-filter + publish gating to `packages/auth-ui/**` + all publishable `@sentropic/*` (+ API_VERSION inputs) so currency never silently drops. Build-all-on-main for the deploy-feeding image builds (digest-dedupe = free no-op).

- [ ] **Lot N — Final validation**
  - [ ] Share the final ci.yml diff with conductor (via architect relay) + 39etc.
  - [ ] PR with `BRANCH.md` body + the explicit assertion 'no main merge can touch the sentropic prod namespace'; CI green.
  - [ ] **HOLD merge for architect ARCH-17 sign-off + 39etc co-sign of the publish bits**; on GO + CI green: remove BRANCH.md, merge (D2 preprod-CD). Then ping poc-k8s for the 2 A records + report conductor (via architect if still ambiguous).
