# Feature: Cluster-mesh generic storage port lots K1 then K2a (L3a v4 common)

## Objective
- [x] Deliver K1 data-pure contracts then K2a test-only reference and shared corpus in packages/cluster-mesh.

## Scope / Guardrails
- [x] Scope limited to cluster-mesh storage kernel contracts (K1) and test-only reference plus corpus (K2a).
- [x] Make-only workflow, no direct Docker commands.
- [x] Root workspace ~/src/sentropic is reserved for user dev/UAT (ENV=dev) and must remain stable.
- [x] Branch development happens in worktree tmp/worktrees/cluster-mesh-storage-k1.
- [x] Automated test campaigns run on ENV=test-cm-storage, never on dev.
- [x] In every make command, ENV=test-cm-storage passed as last argument with API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595.
- [x] All new text in English.
- [x] Zero Python.
- [x] Engram stays neutral (cluster-mesh imports engram-live, never the inverse).
- [x] Frozen comments M1 and merged engram L6a identity contract unchanged.
- [x] Version proposal 0.14.0 recorded below, package not published.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths (implementation scope):
  - [x] BRANCH.md
  - [x] packages/cluster-mesh/package.json
  - [x] package-lock.json
  - [x] spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md
  - [x] packages/cluster-mesh/src/storage/contracts.ts
  - [x] packages/cluster-mesh/src/storage/authority.ts
  - [x] packages/cluster-mesh/src/storage/atomic.ts
  - [x] packages/cluster-mesh/src/storage/profiles.ts
  - [x] packages/cluster-mesh/src/storage/descriptor.ts
  - [x] packages/cluster-mesh/src/storage/staged-units.ts
  - [x] packages/cluster-mesh/src/storage/readers.ts
  - [x] packages/cluster-mesh/src/storage/errors.ts
  - [x] packages/cluster-mesh/tests/storage/reference-store.ts
  - [x] packages/cluster-mesh/tests/storage/reference-state.ts
  - [x] packages/cluster-mesh/tests/storage/atomic-corpus.ts
  - [x] packages/cluster-mesh/tests/storage/authority-corpus.ts
  - [x] packages/cluster-mesh/tests/storage/chain-corpus.ts
  - [x] packages/cluster-mesh/tests/storage/read-corpus.ts
  - [x] packages/cluster-mesh/tests/storage/reference.spec.ts
  - [x] packages/cluster-mesh/tests/storage/mutations.spec.ts
  - [x] .h2a/build/k1_k2a_report.md
- [x] Forbidden Paths (must not change in this branch):
  - [x] Makefile
  - [x] docker-compose*.yml
  - [x] .cursor/rules/**
  - [x] plan/NN-BRANCH_*.md (except this branch file)
  - [x] packages/comments/**
  - [x] packages/cluster-mesh/src/live*/**
  - [x] packages/cluster-mesh/src/comments/**
  - [x] packages/cluster-mesh/src/modules/**
  - [x] packages/cluster-mesh/src/runtime/**
  - [x] .h2a/**
  - [x] .env
- [x] Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths):
  - [x] .github/workflows/**
- [x] Exception process:
  - [x] Declare exception ID BRxx-EXn in Feedback Loop before touching any conditional/forbidden path.
  - [x] Include reason, impact, and rollback strategy.
  - [x] Mirror the same exception in this file under Feedback Loop.

## Feedback Loop
- [x] No open items.

## AI Flaky tests
- [x] No AI flaky tests in scope.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick (default for orthogonal tasks; single final test cycle)
- [x] Rationale: single worktree builds K1 then K2a sequentially on one branch.

## UAT Management (in orchestration context)
- [x] Mono-branch: no UI surface, no UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Baseline and constraints
  - [x] Read co-owner BRIEF-K1-K2a and L3a-spec-v4-common 17.1 plus referenced contract sections.
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/testing.md, plan/BRANCH_TEMPLATE.md.
  - [x] Read packages/cluster-mesh README and src.
  - [x] Confirm frozen comments M1 and merged engram L6a identity contract unchanged.
  - [x] Confirm branch feat/cluster-mesh-storage-k1 from origin/main.
  - [x] Check make ps-all with API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage last.
  - [x] Define environment mapping (test-cm-storage) and ports for this branch.
  - [x] Confirm command style: make ... API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage with ENV last.
  - [x] Confirm scope and guardrails.
- [x] Lot K1 — Profile contracts, authority, atomic/read/staged protocols, descriptor/SPI, error mapping (types and validators only, data-pure, no backend)
  - [x] Named RED tests first for profiles, authority, atomic, staged-units, readers, descriptor, errors, contracts.
  - [x] Implement packages/cluster-mesh/src/storage/contracts.ts.
  - [x] Implement packages/cluster-mesh/src/storage/profiles.ts.
  - [x] Implement packages/cluster-mesh/src/storage/authority.ts.
  - [x] Implement packages/cluster-mesh/src/storage/atomic.ts.
  - [x] Implement packages/cluster-mesh/src/storage/staged-units.ts.
  - [x] Implement packages/cluster-mesh/src/storage/readers.ts.
  - [x] Implement packages/cluster-mesh/src/storage/descriptor.ts.
  - [x] Implement packages/cluster-mesh/src/storage/errors.ts.
  - [x] Write spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md for K1 scope.
  - [x] Lot gate:
    - [x] make typecheck-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [x] make test-cluster-mesh SCOPE=tests/storage/ API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [x] K1 exit commit recorded.
- [ ] Lot K2a — Test-only in-memory reference plus atomic, authority, chain, read corpus
  - [ ] Implement packages/cluster-mesh/tests/storage/reference-state.ts (test-only).
  - [ ] Implement packages/cluster-mesh/tests/storage/reference-store.ts (test-only).
  - [ ] Implement packages/cluster-mesh/tests/storage/atomic-corpus.ts.
  - [ ] Implement packages/cluster-mesh/tests/storage/authority-corpus.ts.
  - [ ] Implement packages/cluster-mesh/tests/storage/chain-corpus.ts.
  - [ ] Implement packages/cluster-mesh/tests/storage/read-corpus.ts.
  - [ ] Implement packages/cluster-mesh/tests/storage/reference.spec.ts executing the corpus against the reference.
  - [ ] Implement packages/cluster-mesh/tests/storage/mutations.spec.ts with discriminating recorded mutations.
  - [ ] Lot gate:
    - [ ] make typecheck-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [ ] make test-cluster-mesh API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
    - [ ] K2a corpus executed against the test reference.
    - [ ] Discriminating mutations recorded.
    - [ ] K2a exit commit recorded.
- [ ] Lot N — Final validation
  - [ ] Typecheck and Lint
  - [ ] Retest cluster-mesh
  - [ ] Bumped packages/cluster-mesh/package.json version to 0.14.0 (proposal, not published).
  - [ ] make scope-check API_PORT=9495 UI_PORT=5695 MAILDEV_UI_PORT=1595 ENV=test-cm-storage
  - [ ] Final gate step 1: push branch and open DRAFT PR to main using BRANCH.md text as PR body (never merge).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Write .h2a/build/k1_k2a_report.md with K1 exit SHA and K2a exit SHA.
