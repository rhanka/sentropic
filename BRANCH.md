# Fix: Engram E10a-3 carry producer intentHash

## Objective
- [ ] Persist and return Engram 0.21.3 `unit.intentHash` byte for byte; bind final neutral contract 1.0.0 bytes and deliver pack-only dev.6.

## Scope / Guardrails
- [x] Base `origin/feat/engram-e2-integration`; branch `feat/cluster-mesh-engram-e10a3`; worktree `tmp/worktrees/mem-e10a3`; draft PR against `feat/engram-e2-integration`; merge only, never rebase or force-push.
- [x] `ENV=test-mem-e10a3` last; no service ports needed; no dev environment, clean-all, Python, publication or AI trailers.
- [x] Every Docker step uses `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, followed by `make down`; commits at most 150 changed lines through `make commit`.
- [x] Contract identity 1.0.0 / `memory-binding-v1`; manifest SHA-256 `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759`; module digest `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `package.json` (retain the Engram-scoped officeparser security override on 0.21.3)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/engram/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BR10a-EX1: Engram peer-tool pin only)
- **Exception process**:
  - [x] BR10a-EX1: cold-workspace Engram pin 0.21.3 so CI executes the requested producer; impact limited to test dependency; rollback manifest/lock/peer pin together; authorized by requested E2 re-pin.

## Feedback Loop
- [x] Gate `.tmp/packets/mem-E10a2-review-gate.md`: preserve K7 fields, separate kernel digests, pin byte round trips and refuse divergent capture receipts.
- [x] Fetched base actually pins 0.21.1; replace directly with published 0.21.3 and regenerate lock from registry.
- [x] BR10a-EX1: `Makefile` peer-tool pin only; requested producer re-pin; rollback with package manifest and lock.

## AI Flaky tests
- [x] No AI provider tests; no timeout increases or flaky acceptance.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (merge only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Inputs**: published receipt, rules and gate read; isolated branch created; mechanical harness branch check passed.
- [x] **Lot 1 — Producer and contract**: re-pin package/peer/registry lock, bind final manifest bytes and digest; bump pack-only 0.24.0-dev.6.
  - [x] Exact 0.21.3 registry integrity verified in regenerated lock; 0.24.0-dev.6 exceeds published 0.23.4; root and peer-tool pins aligned.
- [x] **Lot 2 — Intent carriage**: delete runtime/test host formula; persist supplied intentHash and return unchanged.
- [ ] **Lot 3 — Tests**: wire-adaptation, contract-vectors, binding compatibility and receipt host; real 0.21.3 persistence/replay/tamper tests; receipt divergence negative test.
- [ ] **Lot 4 — Validation**: typecheck, lint, cluster-mesh suite, frozen-surface/Comments gates and scope; shared Docker lock and cleanup.
- [ ] **Lot 5 — Handoff**: pack dev.6, copy tarball and SHA-256 to E10 artifacts; independent review; draft PR with this body; completed/success CI on exact head.

## Test Plan / UAT
- [ ] `tests/engram-memory/intent-carriage.spec.ts`: installed 0.21.3 producer bytes, Engram replay comparison, stored-digest tamper refusal.
- [ ] `tests/engram-memory/wire-adaptation.spec.ts`: opaque intent bytes, K7 and journal round trips.
- [ ] `tests/engram-memory/receipt-hydration.spec.ts`: installed hydration refuses divergent K7/control receipts, both capture states.
- [ ] `tests/engram-memory/contract-vectors.spec.ts`, `binding-compatibility.spec.ts`: manifest/declaration hashes and installed structural compatibility.
- [ ] Cluster Mesh typecheck, lint and full suite, including frozen-surface and Comments regression gates; no UI interaction required.
