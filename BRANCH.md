# Fix(ci): wire steady-state OIDC publish for @sentropic/cluster-mesh

## Objective
- [x] Complete the cluster-mesh publish path: after the 0.1.0 bootstrap (#543), there was no CI job to publish future version bumps via OIDC. Add the missing `cluster_mesh_publish` change-filter output and the `publish-cluster-mesh` job so a version bump on main auto-publishes (mirrors `publish-contracts`). Enables the OIDC trusted-publisher the owner is attaching on npmjs.com.

## Scope / Guardrails
- [x] `.github/workflows/ci.yml`: (1) `changes` job output `cluster_mesh_publish`; (2) `filter` step `cluster_mesh_publish` paths (`package.json`, `package-lock.json`, `packages/cluster-mesh/**` — identical to `contracts_publish`); (3) `publish-cluster-mesh` job (`needs: [changes, validate-cluster-mesh]`, `if: cluster_mesh_publish == 'true' && ref == main`, `id-token: write`, `make publish-cluster-mesh`). Purely additive; no existing job touched.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `BRANCH.md`
- **Forbidden Paths**: everything else.
- **Conditional Paths**: `.github/workflows/ci.yml` (only the 3 additive cluster-mesh entries) — see `BR-CMSTEADY-EX1`.

## Scope Exceptions
- [x] `BR-CMSTEADY-EX1` — `.github/workflows/ci.yml` is default-forbidden. Rationale: the steady-state publish path IS the workflow; the fix mirrors the established `publish-<pkg>` pattern (line-for-line from `publish-contracts`/`contracts_publish`). Impact: adds one conditional main-only job + one change-filter; no existing job/gate depends on it (verified: only `publish-llm-gateway` and the deploy job depend on other publish jobs). Rollback: drop the 3 additive blocks.

## Feedback Loop
- [x] `CMSTEADY-PATTERN` — Verified `validate-cluster-mesh` already exists (typecheck/test/build/pack) and the `cluster_mesh` source-filter already exists; only the `_publish` filter + publish job were missing versus every other publishable package.
- [x] `CMSTEADY-ENV` — Publish jobs use no GitHub Environment and carry `permissions: id-token: write`; the npmjs.com trusted-publisher Environment field must stay blank (owner action).
- [ ] `CMSTEADY-FLEET` — Latent (from #543): all `publish-<pkg>-token` bootstrap recipes share the provenance-in-container defect; dormant today. Track a durable fleet-wide fix.

## AI Flaky tests
- Not applicable: CI-config wiring only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: additive CI wiring mirroring an exact existing pattern; infra-lane plumbing, owner-flagged urgent.

## Plan / Todo (lot-based)
- [x] Lot 0 — Confirm gap: no `cluster_mesh_publish` output, no `publish-cluster-mesh` job; `validate-cluster-mesh` + source-filter present.
- [x] Lot 1 — Add output + filter + job mirroring `publish-contracts`.
- [ ] Lot 2 — PR CI green -> merge to main -> report; steady-state auto-publish active once owner attaches the OIDC trusted publisher.
