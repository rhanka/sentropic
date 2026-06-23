# Feature: WP16 Layer-B — @sentropic/llm-gateway publish wiring (CI/Makefile)

## Objective
Wire the npm publish pipeline for the new `@sentropic/llm-gateway` package (merged via #353): add the `publish-llm-gateway` Makefile targets, the `publish-llm-gateway` CI job, the `llm_gateway_publish` change filter, and the `llm-gateway` bootstrap-publish target. Mirrors `publish-llm-mesh` exactly. Nothing is published in this branch — it only enables the owner-conducted first publish (bootstrap + OIDC trusted-publisher).

## Scope / Guardrails
- Scope limited to CI publish wiring: `Makefile` (publish targets) and `.github/workflows/ci.yml` (job + filter + bootstrap step/enum).
- No `packages/**/src/**` change (so `enforce-package-bump` does not apply); no migration; no runtime code.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/llm-gw-publish-ci`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/**`, `ui/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` and `.github/workflows/ci.yml` — covered by `BR-LB-EX2` below.
- **Exception process**:
  - `BR-LB-EX2` declared in `## Feedback Loop`.

## Feedback Loop
- `BR-LB-EX2` — touch `Makefile` + `.github/workflows/ci.yml` (default-forbidden).
  - Reason: the new `@sentropic/llm-gateway` package needs a publish pipeline; these two files are the only place CI publish wiring lives. Extends the owner-approved `BR-LB-EX1` (which already added the validate-llm-gateway wiring) to the publish side.
  - Impact: additive only — new `publish-llm-gateway`/`publish-llm-gateway-token` targets, a new `publish-llm-gateway` job, a new `llm_gateway_publish` filter output, and a `llm-gateway` bootstrap enum option/step. No existing job/target modified.
  - Rollback: revert this commit; the additions are isolated.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single config change, single CI cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal CI-config change; no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Makefile publish targets**
  - [x] Add `publish-llm-gateway` (OIDC trusted-publish, mirror of `publish-llm-mesh`).
  - [x] Add `publish-llm-gateway-token` (bootstrap first-publish via `NPM_TOKEN_FILE`).
- [x] **Lot 2 — ci.yml wiring**
  - [x] Add `llm_gateway_publish` change-filter output + paths.
  - [x] Add `publish-llm-gateway` job (`needs: [changes, validate-llm-gateway]`, `id-token: write`, main-only).
  - [x] Add `llm-gateway` to the `bootstrap_publish_target` enum + a bootstrap step calling `publish-llm-gateway-token`.
- [ ] **Lot 3 — Final validation**
  - [ ] Tests N/A (CI-config only; no api/ui/src/test change). Validation = the branch CI run itself (validate-llm-gateway green + YAML valid).
  - [ ] Final gate: PR body = this file; branch CI green.
  - [ ] On green: remove `BRANCH.md`, push, merge.

## Deferred
- Architect fast-follow (non-blocking): harden the contract-snapshot route-guard to cover `method==='ALL'` on `/v1/*` — `packages/llm-gateway/tests`, separate PR after publish.
- First publish itself (bootstrap workflow_dispatch + OIDC trusted-publisher) = owner-conducted, after this wiring merges.
