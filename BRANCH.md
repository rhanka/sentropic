# BRANCH: feat/focus-publish

## Objective
Enable `@sentropic/focus` to be published to npm by mirroring the existing `@sentropic/cli` publish machinery.

## Scope

### Allowed Paths
- `packages/focus/package.json`
- `Makefile`
- `.github/workflows/ci.yml`
- `BRANCH.md`

### Forbidden Paths
- All paths not listed above (default-forbidden: `docker-compose*.yml`, `.cursor/rules/**`, etc.)

### Conditional Paths — Exceptions

#### BR-FOCUSPUB-EX1: Makefile (additive)
- **Path**: `Makefile`
- **Rationale**: Add `publish-focus` and `publish-focus-token` targets mirroring `publish-cli`/`publish-cli-token` verbatim; reuses existing `build-focus`/`pack-focus`/`.PHONY` declaration. Purely additive — no existing targets modified.
- **Impact**: New Makefile targets only; no change to existing build or dev workflows.
- **Rollback**: Remove the two new targets from `Makefile`.

#### BR-FOCUSPUB-EX2: .github/workflows/ci.yml (additive)
- **Path**: `.github/workflows/ci.yml`
- **Rationale**: Add `publish-focus` job (OIDC, mirrors `publish-cli`); add `focus` to `bootstrap_publish_target` options; add `focus_publish` filter output + paths-filter entry; add bootstrap step for focus. All changes are additive — no existing jobs or filters modified.
- **Impact**: New CI job activated only on main when `packages/focus/**` changes; bootstrap step gated on `focus` input. No impact on existing jobs.
- **Rollback**: Remove the `publish-focus` job, `focus_publish` output/filter, `focus` bootstrap_publish_target option, and bootstrap step.

## Checklist
- [x] `packages/focus/package.json`: removed `"private": true`, added `"publishConfig": { "access": "public" }`
- [x] `Makefile`: added `publish-focus` (OIDC) + `publish-focus-token` (bootstrap) targets, added to `.PHONY`
- [x] `.github/workflows/ci.yml`: `publish-focus` job, `focus` in `bootstrap_publish_target`, `focus_publish` output + filter, bootstrap step
- [x] `BRANCH.md`: created with scope exceptions documented
- [x] `make pack-focus` dry-run succeeded (dist/ present in tarball)
