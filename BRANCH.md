# Fix(ci): cluster-mesh bootstrap publish fails on provenance (provider: null)

## Objective
- [x] Unblock the first publish of `@sentropic/cluster-mesh@0.1.0`: the bootstrap recipe `publish-cluster-mesh-token` ran `npm publish` inside a container that carries no GitHub Actions env, so `publishConfig.provenance:true` failed with `EUSAGE Automatic provenance generation not supported for provider: null` (CI run 32079323845). Disable provenance on the token bootstrap only; steady-state OIDC publish keeps provenance.

## Scope / Guardrails
- [x] `Makefile` `publish-cluster-mesh-token`: append `--no-provenance` to the bootstrap `npm publish`. No change to the OIDC steady-state recipe `publish-cluster-mesh` (which forwards `GITHUB_*` + `ACTIONS_ID_TOKEN_REQUEST_*` and keeps provenance) and no change to `ci.yml`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `BRANCH.md`
- **Forbidden Paths**: everything else.
- **Conditional Paths**: `Makefile` (only the `publish-cluster-mesh-token` recipe, one line) — see `BR-CMPROV-EX1`.

## Scope Exceptions
- [x] `BR-CMPROV-EX1` — `Makefile` is default-forbidden. Rationale: the blocker IS the Makefile bootstrap recipe; the fix is a single flag on one CI-plumbing line owned by the infra lane. Impact: bootstrap-only (steady-state OIDC untouched). Rollback: drop `--no-provenance` from `publish-cluster-mesh-token`.

## Feedback Loop
- [x] `CMPROV-RCA` — `npm whoami` returned `rhk` (token auth OK) and the tarball built; the failure was provenance generation (`provider: null`) because the token recipe container carries no GitHub Actions env. Root cause is provenance, not auth.
- [x] `CMPROV-FLEET` — All 20+ non-private packages carry `publishConfig.provenance:true` and were bootstrapped without provenance, then publish provenance via steady-state OIDC. This fix keeps cluster-mesh consistent with that fleet convention.
- [ ] `CMPROV-FOLLOWUP` — Latent: every other `publish-<pkg>-token` recipe shares the same pattern and would fail an identical way on a future first-publish (dormant today since those packages are already published). Track a durable fix (either `--no-provenance` fleet-wide on the token recipes, or forward env + add `id-token: write` to `bootstrap-publish`).
- [ ] `CMPROV-OIDC-ATTACH` — After publish, attach the OIDC trusted publisher on `npmjs.com -> @sentropic/cluster-mesh -> Settings -> Trusted Publisher` -> `rhanka/sentropic` workflow `ci.yml` (owner action; enables steady-state provenance publishes).

## AI Flaky tests
- Not applicable: Makefile CI-plumbing one-liner.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: single-line CI recipe fix; infra-lane plumbing.

## Plan / Todo (lot-based)
- [x] Lot 0 — RCA from run 32079323845 logs: provenance `provider: null`, not token/auth.
- [x] Lot 1 — Append `--no-provenance` to `publish-cluster-mesh-token`; OIDC recipe untouched.
- [ ] Lot 2 — PR CI green -> merge to main -> re-trigger bootstrap `workflow_dispatch bootstrap_publish_target=cluster-mesh` -> verify `@sentropic/cluster-mesh@0.1.0` on npm -> report; then owner attaches OIDC trusted publisher.
