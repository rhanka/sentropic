# Feature: feat(artifacts): #861 L1 — compile selection and effective profile

## Objective
- [x] Implement spec r2 C1–C7 profile compilation and ordered command identity within L1's exclusive scope.

## Scope / Guardrails
- [x] Binding spec: `.tmp/immo-861-artifacts/spec-plan.md`, SHA-256 `e0bffcf079bddaf5fcef8b4232100b821f5efd225a7ffb92a239ea4b540ea9a4`.
- [x] Base: `feat/artifacts-861-contracts` merged at `d4bd43b3c2379e1823ac1b32264d9d9febd50fed` (PR #721 L0-fix wave).
- [x] Worktree: `tmp/worktrees/artifacts-861-L1`; branch `feat/artifacts-861-L1`.
- [x] Make-only; ENV=test-artifacts-861-724 last; no Python; selective staging; authored commits under 150 lines; upstream merge preserves L0 commit identities.
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
  - `packages/artifacts/README.md`
  - `packages/artifacts/docs/**`
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/tests/commit-contract.test.ts`
  - `packages/artifacts/tests/effective-profile.test.ts`
  - `Makefile`
  - `api/package-lock.json`
  - `docs/governance/kit/package*.json`
  - `package*.json`
  - `packages/artifacts/package.json`
  - `packages/cluster-mesh/**`
  - `tools/memory-mcp-l5/**`
  - `ui/package*.json`
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
- [x] BR861-EX2: owner requests merging the actual L0 origin head, including inherited main merges (Engram G1, L5 manifests and dependency fixes). The additional allowed paths above authorize inherited merge changes only; L1 authors no edits there. Impact: preserve upstream history and corrected contracts. Rollback: revert this merge as a unit.
- [x] acknowledge L1-VERSION: corrected L0 assigns serial pack-only dev.N versions and lock updates to the integration owner; no L1 manifest change.
- [x] BR861-L1-EX1: owner explicitly requested merging PR #721 L0-fix commits; added inherited docs/declarations/vector paths above for this merge only. Impact: corrected upstream contract evidence, no L1 edits to those files. Rollback: revert the merge as a unit.
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
- [x] Astra P2-1: reproduce missing semantic budget acceptance; require every operation limit/default before schema generation; retain one-byte success and overflow refusal.
- [x] Astra P2-2: reproduce invalid_request on primitive prototype-named entries; remove the schema ban; verify own-data snapshots, unchanged prototypes and distinct command hashes.
- [x] Merge PR #721 L0-fix wave at d4bd43b3; preserve L1 branch plan and all upstream code unchanged; no .track delta on either side.
- [x] Reconcile L0 selectedCapabilities input/inherited compiled fields and selection httpStatus/variant; both new shape regressions fail before adaptation. Preserve actorId authority, callable trusted derivation, Unicode and envelope semantics.
- [ ] Global CI green: requires integration/security remediation of the evidenced dompurify audit failures and the reserved version/bump gate.
- [ ] Merge actual L0 origin d41f470927c1dfd52c239f57ba3f2589723d3285, adapt compiled validators and canonical command fixtures, preserve Astra r1 fixes, and rerun scope gates.
