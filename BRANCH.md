# Feature: Live STT L1c cluster speech configuration

## Objective
- [ ] Deliver approved r3 L1c: versioned stage bindings, mic policy and offline projection without fixed engines.
- [x] Read L0 PR #753 at `008d66b5fd6ff04d1c44f69cf52892c4c3587980`; its docs/evidence remain the prerequisite inventory.

## Scope / Guardrails
- [x] Author: codex / gpt-6.1-sol / high; spec SHA-256 `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`.
- [x] Branch `feat/live-stt-l1c`, worktree `tmp/worktrees/live-stt-l1c`, origin/main `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`.
- [x] Make-only, ENV last: `ENV=test-live-stt-l1c`; shared Docker flock; existing Compose qualification service, no published ports.
- [x] No paid API, inference, microphone, model download, Python, publication or deployment.
- [x] Specific-file staging; make commit only; commits under 150 changed lines; no attribution trailers.
- [x] Preserve root and other worktrees; Sol serializes shared catalogue/barrel/manifest edits.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.tmp/live-stt/l1c/**`
  - `.tmp/live-stt/l0/**`
  - `packages/cluster-mesh/src/speech/**`
  - `packages/cluster-mesh/src/config.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/README.md`
  - `packages/cluster-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/speech-*.spec.ts`
  - `packages/cluster-mesh/tests/speech-fixtures.ts`
  - `packages/llm-mesh/src/speech/**`
  - `packages/llm-mesh/src/capabilities.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/tests/speech-contract.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/README.md`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/tests/unit/gateway-package-version.test.ts`
  - `package-lock.json`
  - `.tmp/live-stt/l1/**`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`
  - `packages/llm-gateway/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `api/**`
  - `ui/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `scripts/**` (none planned).
- **Exception process**:
  - [x] Declare BRLIVE-L1-EXn with reason, impact and rollback before extending scope; none planned.

## Feedback Loop
- [x] origin/feat/live-stt-l1c absent; created from origin/main and merged approved L1 head `01d784be8` by fast-forward, no rebase.
- [x] BRLIVE-L1C-EX1: existing cold workspace/Compose targets only; external adapter avoids inherited raw Docker scope prerequisite; no tracked build/CI change.

## Plan / Todo (lot-based)
- [x] L1c baseline: Docker lock first, rules/spec/owner answers and L0 evidence read; mechanical branch check passes.
- [ ] Replace inherited scope/plan with L1c file-level gates before source edits.
