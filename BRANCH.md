# Feature: App Vue T0 templater contracts

## Objective
- [ ] Deliver both neutral templater contracts and the complete print migration inventory from the approved migration specification, section 6.6.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/app-vue-t0`; branch: `feat/app-vue-t0`, based on `origin/main`.
- [x] Specification SHA-256: `277104d6cd95a7d3cb91ffca1644a088b937fb9e067247f19779c955887eb2b7`.
- [x] Track parent: `01M79DW3RDPC2CSCGZJCXC2A81`; conductor owns Track imports and decisions D1/D2.
- [x] Make-only, Docker-first; Docker commands through `.tmp/packets/docker-slot.sh`.
- [x] Environment: `feat-app-vue-t0`; ports API `9300`, UI `5500`, Maildev `1400`; ENV last.
- [x] No DS install, API/seed changes, reference UI changes, V8 work, or owner decisions D3–D8.
- [x] No merge; independent review and integration belong to s-conductor.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui-shared/templater/contract/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `api/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `spec/SPEC_TEMPLATING.md`
  - `BRANCH.md`
- **Exception process**:
  - [x] No conditional path needed; record rationale, impact and rollback before any exception.

## Feedback Loop
- [x] Print inventory part 03 committed with source lines, targets and future hooks.
- [x] Print inventory part 02 committed with source lines, targets and future hooks.
- [x] Print inventory part 01 committed with source lines, targets and future hooks.
- [x] BR00-EX1: administrative `BRANCH.md` required by packet; no product scope expansion; rollback restores the base branch plan.
- [x] Packet authorizes `ENV=feat-app-vue-t0`; it supersedes the generic test environment prefix for this isolated lane.
- [ ] Conductor imports this branch under the existing migration Track item; no concurrent sidecar write from this worktree.

## AI Flaky tests
- [x] None: contract qualification has no provider dependency.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one scoped build lot, no integration by this lane.

## UAT Management (in orchestration context)
- [x] No rendered UI delivered; schema, adapter and print inventory qualification replace browser UAT for T0.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, repository rules, approved specification and template.
  - [x] Create isolated worktree from `origin/main`.
  - [x] `harness check branch`: PASS C1.
  - [x] `df -h /`: 38 GB free before Docker work; recheck before building.
- [ ] **Lot 1 — Family (b) contract**
  - [x] JSON Schema: eight field types, three seeded row shapes, presentation and print properties.
  - [x] `contract.test.mjs`: seven real seed shapes validate; 17 seed records qualify; mutations fail.
- [ ] **Lot 2 — Family (a) contract and adapters**
  - [x] `container.ts`: typed icons/tones, cards/actions/menu callbacks, activation adapters.
  - [x] `container.test.mjs`: callbacks, navigation precedence, hidden menu actions and card mapping.
- [ ] **Lot 3 — Consumer and presentation mappings**
  - [ ] `README.md`: five consumers with source lines; row/field/slot contracts and ownership.
  - [x] `presentation.ts`: colour/tone/variant and print token/hook mappings.
- [ ] **Lot 4 — Print inventory**
  - [ ] `print-inventory-*.json`: every selector line, source target and future hook or dropped reason.
  - [x] `inventory.test.mjs`: independent PostCSS coverage, no missing or duplicate lines.
  - [x] Reproducible generator includes all 441 census lines (433 selectors and 8 at-rule preludes).
- [ ] **Lot 5 — Final validation**
  - [ ] Scoped Docker qualification through the contract Makefile.
  - [ ] `make scope-check` before every atomic commit, each below 150 changed lines.
  - [ ] Push branch; PR title and body from this file; independent review handoff.
  - [ ] CI green on exact pushed head; no merge.
  - [ ] French report `.tmp/rv/app-vue-t0.md`, then `.tmp/rv/app-vue-t0.done`.
