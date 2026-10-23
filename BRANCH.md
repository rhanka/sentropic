# Feature: common rule L01b1 kit objects and manifests

## Objective
- [x] Implement the test-only CT-01–03 reference, injected assertions and M01–M03 controls.
- [x] Follow approved amendment SHA-256 `3302ba9e3ee91a52850b89cb9646e2747d0412b5a9fcf3e17f3cdd72a6573fba`, §3/§5/L01b1; Track `01M5E7MTN3EG3S91WZTRR9YNYT`.

## Scope / Guardrails
- [x] Isolated `tmp/worktrees/cm-s3-l01b`, branch `feat/cm-s3-common-rule-l01b1`, from `origin/main`; mechanical branch check passed.
- [x] Test-only kit; no backend, admission claim, dependency or production codec changes.
- [x] Make-only checks, `ENV=test-common-rule` last; no Python; one Docker build at a time.
- [x] No service ports required by the disposable workspace lane; no dev environment.
- [x] Specific-file staging; `make commit MSG="..."`; each commit below 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/governance/kit/package-lock.json`
  - `docs/governance/kit/package.json`
  - `package-lock.json`
  - `package.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `ui/package-lock.json`
  - `ui/package.json`
  - `packages/cluster-mesh/tests/storage/common-rule/kit.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/objects-reference.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/objects-assertions.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/objects-mutants.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/objects-kit.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cluster-mesh/src/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exceptions require ID, reason, impact and rollback in Feedback Loop before edits.

## Feedback Loop
- [x] BRL01B1-EX1: integrate owner-requested origin/main at 25af28bbc via merge; eight upstream dependency/derived-pin files are allowed solely for #725 integration. Impact: patched DOMPurify and aligned lock commitments; rollback: revert this integration commit. No backend changes.
- [x] Astra P2-1: CT-01 checks bytes, commitment and receipt after each invalid retry on a separately populated identity, before/after reopen; M01-invalid-retry survived the old kit and is now killed.
- [x] Astra P2-2: CT-02 verifies populated payload/page inventories, then requires commitment errors for a wrong nonempty digest and field/page substitutions; M02-ignore-digest survived the old kit and is now killed.

## AI Flaky tests
- [x] No provider/model nondeterminism or accepted skips in this kit.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one test-only assertion family, no delegated implementation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode behavior changes; UAT is executable CT assertions.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Fixture types and independent manifest encoder**
  - [x] Add `kit.ts` and `objects-reference.ts` encoder; frozen vector equivalence is gated in Lot 3/4.
- [x] **Lot 2 — Owned objects and bounded manifest verification**
  - [x] Add independent contenders with separate reader/preparer ports, reopen/fault controls, scoped immutable create/retry and fail-closed reads.
- [x] **Lot 3 — Reusable CT-01–03 assertions**
  - [x] Add `objects-assertions.ts`: races, buffer ownership, scope isolation, envelope commitments and corruption probes.
  - [x] Race payload and manifest identities; a foreign-only equal-digest object never satisfies an absent local binding.
- [ ] **Lot 4 — Mutants and final validation**
  - [x] Add `objects-mutants.ts` and `objects-kit.spec.ts`; positive pass precedes designated M01/M02/M03 kills.
  - [x] Run `make test-cluster-mesh ENV=test-common-rule`; 1007 passed, 129 separate-lane skips; common-rule 19/19 and kit 10/10, zero skips; missing fixture/instrumentation refuses setup.
  - [x] Run lint and TypeScript checks; preserve the frozen L3a bytes and all L01a vectors.
  - [x] Run scope checks before each commit; review final diff against the six allowed paths.
  - [x] Push and open draft PR #722 with this file as body.
  - [ ] Verify green CI on the final head and report PR/head/run URL.
  - [x] Retain BRANCH.md and leave the PR unmerged, per owner instruction.
