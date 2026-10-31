# Feature: Synchronize owner deliverables and decisions into Track

## Objective
Record the owner's 2026-10-31 deliverables, recover merged branch plans since 2026-10-26, and preserve existing Track identities without duplicates.

## Scope / Guardrails
- [x] Designated single writer: `chore/track-sync-20261031`, worktree `tmp/worktrees/track-sync`, based on `origin/main`.
- [x] Track writes use `/home/antoinefa/.npm-global/bin/track` 0.98.0 from this worktree root only; never edit journal events manually.
- [x] Root checkout and its uncommitted Track events remain untouched.
- [x] Sources: `.tmp/owner-deliverables/OWNER-DELIVERABLES-2026-10-23.md` and the owner's sync packet; every active item records its source and next milestone.
- [x] Reuse existing items and workpackages; options come from source dossiers, otherwise decisions remain `à structurer`.
- [x] No runtime, secrets, package changes, Docker campaign or publication; validation uses the installed Track and harness CLIs.
- [x] Make commands use `ENV=test-memory-mcp` last; no services or ports are allocated.
- [x] Selective staging, `make scope-check` and `make commit`, at most 150 changed lines per commit; one CI on the final head; no merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.track/**`
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity/**` (new A2.3 module set)
  - `packages/cluster-mesh/src/index.ts` (public export of the A2.3 surface)
  - `packages/cluster-mesh/tests/identity-decision.spec.ts`
  - `packages/cluster-mesh/tests/identity-cascade.spec.ts`
  - `packages/cluster-mesh/tests/identity-ledger.spec.ts`
  - `packages/cluster-mesh/tests/identity-profiles.spec.ts`
  - `packages/cluster-mesh/package.json` (dev bump, see A23-EX1)
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (A23-EX1)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs` (A23-EX1)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (A23-EX1)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (A23-EX1)
  - `package-lock.json` (A23-EX2, version-sync line only)
  - `.gitignore` (A23-EX4, one-line anchor `identity/` → `/identity/`)
  - `scripts/ci/consumer-locks.json` (A23-EX5, one npm-authored closure line; Allowed per the merged BRA2-EX4 precedent `258aa6a49`)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `api/**`
  - `ui/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare any exception with reason, impact and rollback in Feedback Loop before changing a conditional path; none needed.

## Feedback Loop
- [x] Root journal is intentionally excluded from this sync by the owner's packet; preserve all events already on `origin/main`.
- [x] A4.2 conductor choice is recorded from the 2026-10-31T22:37Z source; pending owner decisions are never selected automatically.

## AI Flaky tests
- [x] Not applicable: journal synchronization uses deterministic validation and no model inference.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one designated Track writer; no delegated writes or branch integration.
- [ ] Multi-branch (not used).

## UAT Management (in orchestration context)
- [x] Data-only review checks statuses, source paths, milestones and exact decision options; no application UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and identity map**
  - [x] Read common rules, Track contract, repository rules and branch template; harness branch check passes.
  - [x] Capture baseline report, snapshot, query, existing workpackages, items and decisions before writes.
- [x] **Lot 1 — Recover merged deliverables**
  - [x] Recover eligible merged BRANCH files, import compatible shapes, and link completed PR evidence without duplicates.
- [ ] **Lot 2 — Owner requests and decisions**
  - [ ] Record identity, app, memory/hooks, remote control, voice, federation, canvas, immo, infrastructure, cyber and pending owner work.
  - [ ] Preserve exact structured options/recommendations; leave unsupported dossiers unstructured.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Run `track validate`, preserve baseline event containment, inspect final inventory and save deterministic Markdown report.
  - [ ] Run `make scope-check`, create PR using this file, and run one CI on the final head.
  - [ ] Save PR/head/CI, item and decision counts, and avoided duplicates in `.tmp/rv/track-sync.md`; stop without merging.

## Validation record
- [x] Sync checkpoint: 1456 journal events recorded; complete merged deliverable archive.
- [x] No application tests added or changed; deterministic Track validation, source reconciliation, scope and diff checks are the relevant gates.
- [ ] Final Track validation and source coverage passed.
