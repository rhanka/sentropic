# Feature: feat(artifacts): #861 L1 — compile selection and effective profile

## Objective
- [x] Implement spec r2 C1–C7 profile compilation and ordered command identity within L1's exclusive scope.

## Scope / Guardrails
- [x] Binding spec: `.tmp/immo-861-artifacts/spec-plan.md`, SHA-256 `e0bffcf079bddaf5fcef8b4232100b821f5efd225a7ffb92a239ea4b540ea9a4`.
- [x] Base: `feat/artifacts-861-contracts` at `a5bfbacef0065313f0e54a5fadc88119ae9acab4`.
- [x] Worktree: `tmp/worktrees/artifacts-861-L1`; branch `feat/artifacts-861-L1`.
- [x] Make-only; ENV=test-artifacts-861-L1 last; no Python; selective staging; commits under 150 lines.
- [x] No services/ports needed for pure unit tests; no root development environment changes.
- [x] Q0 is read-only; retain unknown/source-gap/not-covered items without extrapolation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/profile/**`
  - `packages/artifacts/src/server/command-identity.ts`
  - `packages/artifacts/tests/capability-profile.test.ts`
  - `packages/artifacts/tests/command-identity.test.ts`
  - `packages/artifacts/tests/parameters.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `packages/artifacts/src/http.ts`
  - `packages/artifacts/src/mcp-core.ts`
  - `packages/artifacts/src/mcp.ts`
  - `packages/artifacts/src/server/commit/**`
  - `packages/artifacts/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `plan/**`
- [x] Exception process: record BR861-L1-EXn reason, impact and rollback before changing conditional paths.

## Feedback Loop
- [ ] attention L1-VERSION: r2 assigns manifests/locks to integrator; L0 defers bump to L1. Integrator must apply the pack-only version before final CI.
- [x] acknowledge L1-API: L0 freezes shapes only; r2 supplies public names. L6 exports and wires L1 modules.
- [x] acknowledge L1-MIGRATION: path reconciliation notes live in the allowed profile directory; L6 consolidates migration docs.
- [ ] attention L1-DOMAIN: Q0 has no qualified complete actor domain. L6 must bind actual verified subjects; ambiguous delimited domains fail construction without changing historical keys.
- [ ] blocked L1-CI: run 39836233948 passes validate-artifacts (typecheck/build/238 unit/30 integration-E2E/lint/pack/probe) but global ci-gate fails on dompurify critical advisories in API/UI image audit. Owner: integration/security maintainer; remediate dependency in base/lock, then rerun the four failed jobs and ci-gate without relaxing audit.
- [x] acknowledge L1-CI-WIRING: automatic PR CI targets main only; dispatched ci.yml on the L1 ref with bootstrap_publish_target=none. enforce-package-bump is skipped by that workflow event, so its required pre-integration reservation remains open.

## AI Flaky tests
- [x] No AI tests or flaky allowance in L1.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: L1 parallels L2/L3; no changes to their files.

## UAT Management (in orchestration context)
- [x] No UI change; transport/process UAT belongs to L6/L8.

## Plan / Todo (lot-based)
- [x] Baseline: read rules, template, r2, request and Q0; verify hashes and mechanical branch check.
- [x] Profile: immutable selection, schemas, semantic rules, defaults, limits and revision-aware digest.
- [x] Validation: closed arguments/files, Unicode, path/MIME/byte budgets, keys and envelopes.
- [x] Identity: trusted derivation, ordered codec, deep command snapshot and forced provenance.
- [x] Added command-identity.test.ts regressions for Radar vectors, ordered files, authority domains and snapshots.
- [x] Added parameters.test.ts regressions for closed inputs, decoded budgets, paths, Unicode keys and envelopes.
- [x] Baseline receipt: all 22 new cases fail on missing L1 contracts; four existing parameter cases pass (tmp/l1-evidence/baseline.log).
- [x] Implemented platform-free profile contracts and JSON snapshot/ordered codec primitives.
- [x] Generated schemas from explicit Radar defaults/limits and documented path reconciliation/domain qualification.
- [x] Hardened composition against inconsistent bounds and derivation limits; verified 32 files and full decoded byte-array boundary.
- [x] Tests: all final 22 new cases fail against archived L0 source; all 26 focused and 238 package unit cases pass on L1. Receipts: tmp/l1-evidence/baseline-final.json, unit.log, test-sha256.txt.
- [x] Gates: CI make typecheck-artifacts, lint-artifacts, test-artifacts and integration/pack/probe pass; mechanical scope-check before every commit.
- [x] Local gates: lint-artifacts and final cached-toolchain typecheck/238 unit tests pass; local test-artifacts temporary npm install stalled and was stopped after the exact CI gate passed.
- [x] Delivery: pushed feat/artifacts-861-L1; DRAFT PR #724 against feat/artifacts-861-contracts; no merge.
- [ ] Global CI green: requires integration/security remediation of the evidenced dompurify audit failures and the reserved version/bump gate.
