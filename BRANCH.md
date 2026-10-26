# Feature: fix(memory-l5): rescope P09 to existing suites and re-freeze pre-candidate P3

## Objective
- [ ] Apply only the approved P09 correction and prepare immutable P3 for owner authorization.
- [ ] L0 reissue awaits owner authorization.

## Scope / Guardrails
- [x] Base: origin/main `22d8a9e68b1abae2665fedb528526d2a84c6bc4d`.
- [x] Branch: `fix/memory-l5-p09-p3`; worktree: `tmp/worktrees/mem-l5-p3`.
- [x] Approved correction SHA-256: `b13bcd77f4a78e20c7f6ed36561b5f2e57eeb7442ad5623d8607991a952a6ee9`.
- [x] Catalog SHA-256: `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`.
- [x] Make-only tests, shared Docker lock, isolated `ENV=test-mem-l5-p3` last, cleanup after each step.
- [x] No service startup or port reservation; existing official disposable container targets only.
- [x] No package/source/schema changes, repack, E4 rebuild, publication, registration or merge.
- [x] Only `.tmp` write: root `.tmp/engram-l4-handoff-p2/BINDING.md`, new P3 section.
- [x] Atomic commits below 150 changed lines, selective staging, `make commit`, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/proof-catalog-v1.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `tools/memory-mcp-l5/artifacts/history/f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642.json`
  - `tools/memory-mcp-l5/artifacts/history/f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642.json.sha256`
  - `tools/memory-mcp-l5/tests/p3-l0-freeze.test.mjs`
  - `tools/memory-mcp-l5/tests/receipt-contract.test.mjs`
  - `spec/evidence/memory-mcp-l5/l0-freeze.json`
  - `spec/evidence/memory-mcp-l5/p3-*.md`
  - `spec/evidence/memory-mcp-l5/p3-*.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No scope exception requested; no conditional path needed.

## Feedback Loop
- [ ] Owner: `owner:antoinefa`; status: attention; authorize exact amended L0 digest with a detached signature.
- [ ] Authorized L4/platform/broker/transport role dispositions must bind the new L0 and P3 tuple; no prior signatures reused.
- [ ] Gr-conductor: acknowledge predecessor and P3 identities before downstream E4 rebuild/handoff.

## AI Flaky tests
- [x] No AI tests or flaky-test exception applies.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author, no delegated implementation.
- [x] Approved specification and Opus r2 review are inputs; this draft does not claim owner acceptance.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VSCode surface changes; no product UAT in this correction.
- [ ] Owner UAT and co-acceptance receipts require the actual P3 candidate tuple and CI binding later.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and tests first**
  - [x] Read Docker lock, repository rules, template, approved specification and Opus review; verify input hashes.
  - [x] Create isolated worktree from exact base and pass mechanical `harness check branch`.
  - [x] Run existing `make memory-l5-tooling` and `make memory-l5-test LOT=1` before changing frozen bytes.
  - [x] Exercise real L0 catalog/schema validation and stale-hash refusals with the targeted regression.
- [ ] **Lot 1 — Exact frozen-byte correction**
  - [x] Retain predecessor manifest and sidecar in history; preserve historical P2.
  - [x] Copy approved catalog byte-for-byte; change exactly two L0 fields.
  - [x] Derive P3 by exactly two inventory hash substitutions; emit matching sidecar.
  - [x] Record base, seven inherited P2 deviations and detached signature slots explicitly pending.
  - [x] Preserve both unchecked v9 R2-MEMORY/R7a-MEMORY obligations in repository evidence if v9 is outside Git.
  - [ ] Record P3 digest and freezing commit in the existing root BINDING.md under P3.
- [ ] **Lot 2 — Validation and draft PR**
  - [ ] Run real L0 validator and existing tooling tests (`tools/memory-mcp-l5/tests/*.test.mjs`).
  - [ ] Run Lot 1: platform `tests/memory/*.test.ts`, `request-identity.test.ts`, `wire-parity.test.ts`, `registry-dispatch.test.ts`; broker `tests/*.test.ts`.
  - [ ] Verify P3 retained inventory/archives using `make memory-l5-verify`.
  - [ ] Record pending authority and remaining checkpoint obligations without claiming qualification.
  - [ ] Run `make scope-check` before each commit; inspect exact diff and hashes.
  - [ ] Push, open draft PR to main using this plan as body, inspect CI and leave unmerged.
