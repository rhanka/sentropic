# Feature: VD-2.0 V8 artifact delivery spike

## Objective
- [ ] Answer all sixteen questions of spec section 8.2 with executable evidence.

## Scope / Guardrails
- [x] Build the approved VD-2.0 lot; no production implementation.
- [x] Worktree: `tmp/worktrees/v8-spike`; branch: `feat/v8-vd-2-0-spike`.
- [x] Docker-first; make-only; no Python; no secrets in evidence.
- [x] Environment: `feat-v8-spike`; API_PORT=9360; UI_PORT=5560; MAILDEV_UI_PORT=1460.
- [x] Ports checked free before startup; root dev environment reserved.
- [x] Stop Docker builds below 30 GB free; use docker-slot.sh per command.
- [x] Keep latency targets unchanged; report N, p50, p95 and clock.
- [x] Re-read VD-2.0 before each commit; commits below 150 changed lines.
- [x] No package source changes or version bumps.
- [x] Push and open PR; do not merge; wait for CI on exact head.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/tests/compile-spike/**`
  - `packages/skills/tests/sandbox/**`
  - `e2e/tests/harness/**`
  - `spec/SPEC_EVOL_V8_ARTIFACT_DELIVERY.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `BRANCH.md`
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- [x] The spec allowance covers section 8 only; preserve other sections.
- [x] Exceptions require BRxx-EXn with rationale, impact and rollback before editing.

## Feedback Loop
- [x] BR00-EX1: branch metadata only. Reason: the packet mandates BRANCH.md; impact: no runtime change; rollback: delete BRANCH.md at branch closure.
- [ ] Track import belongs to the conductor, the designated single writer.
- [ ] Region harness, immo production image and node flavor need verified receipts.

## AI Flaky tests
- [x] No AI-provider calls in this spike; no flaky acceptance or timeout increase.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; dedicated D6-A branch slot, independent of VD-2.1.
- [x] No integration or merge of the sibling contract lane.

## UAT Management (in orchestration context)
- [x] Browser qualification runs in Docker on the spike's independent origin.
- [x] No root dev/UAT stack changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, packet, spec architecture, VD-2.0 row and sixteen questions.
  - [x] Create isolated worktree from origin/main at e44e2e2bf.
  - [x] Mechanical `harness check branch` passes.
  - [x] Check disk and isolated ports.
- [ ] **Lot 1 — Preview probe first (Q6)**
  - [ ] Add `e2e/tests/harness/v8-preview.spec.ts` and isolated runner.
  - [ ] Load exact MapLibre 6.4.1, 6.14.0 and PDF.js 4.10.38 closures.
  - [ ] Measure real module workers in Chromium, Firefox and WebKit.
  - [ ] Assert worker-relative imports, import-map control and opaque-frame control.
- [ ] **Lot 2 — Compiler and isolate (Q1–5, Q8, Q11–14)**
  - [ ] Commit F-LIVE-S/M/L and block dependency edit matrix.
  - [ ] Exercise pinned bootstrap via SandboxRuntime and isolated-vm adapter.
  - [ ] Compare bytes, imported types, CSS passes, syntax and closure sizes.
  - [ ] Measure cold/fresh/retained contexts, pod limits, memory and cancellation.
- [ ] **Lot 3 — Browser runtime (Q7, Q9–10, Q14–16)**
  - [ ] Probe import-map integrity, CSS/font parity and Vapor hot replacement.
  - [ ] Record setup/render wrappers, state witnesses and swap spans.
  - [ ] Measure worker compiles, pre-armed import and network/clock uncertainty.
- [ ] **Lot 4 — Evidence and review**
  - [ ] Record sixteen answers and exact commands; open D12/D13 on measured misses.
  - [ ] Independent review and reconcile findings.
  - [ ] Scope-check before every selective-stage make commit.
  - [ ] Push, PR with this file as body, exact-head green CI; no merge.
  - [ ] Tear down environment volumes and write report and completion marker.
