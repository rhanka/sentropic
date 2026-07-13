# Design: chat surfaces & placement (SPEC_EVOL) — drawer/floating/DnD

## Objective
Ratify the full surface/placement taxonomy for `@sentropic/chat-ui` (drawer left|right, floating left|center|right, full, DnD, occupancy fallback), driven by the vscode drawer need, as a design-system surface option. This branch is SPEC-ONLY (no code) — the review vehicle for the design-system co-review gate (D10) before any implementation lot.

## Scope / Guardrails
- Scope: `spec/SPEC_EVOL_CHAT_SURFACES.md` + `BRANCH.md` only. No code.
- Cross-cutting: DS-owned Drawer/DropZone (D10) require design-system lane co-review before implementation.
- Owner batched decisions + Opus/Codex adversarial review captured in the EVOL.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `spec/SPEC_EVOL_CHAT_SURFACES.md`, `BRANCH.md`
- **Forbidden Paths**: everything else (spec-only branch) — `packages/**`, `ui/**`, `api/**`, `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: none

## Feedback Loop
- `attendu` — design-system lane co-review of D10 (Drawer/DropZone API, tokens/density, drag-affordance ownership) before implementation lots L2+.

## AI Flaky tests
- None (spec-only).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single spec artifact; implementation split into lots (D12) after DS review.

## UAT Management (in orchestration context)
- No app UAT (spec-only). Owner ratifies the EVOL; DS lane co-reviews DS-owned parts.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Brainstorm & EVOL**
  - [x] STUDY → Opus+Codex adversarial review → owner batched decisions.
  - [x] SPEC_EVOL_CHAT_SURFACES.md with D1–D13 + full taxonomy + controller contract.
  - [x] Codex 5.5-xhigh hardening pass (verdict needs-revision) reconciled: D13 async prepare/commit protocol, controller contract enriched, taxonomy normalized, D7 corrected (runtime-extraction lot L0), persistence adapter, D5 impl contract, lot re-ordering.
- [x] **Lot 1 — Design-system co-review** — ENDORSE-with-conditions (#32, 2026-07-13); 5 conditions folded into D10.
- [ ] **Lot 2+ — Implementation** (deferred to harness/plan after DS review)
  - [ ] L0 session-runtime extraction (prerequisite; D7).
  - [ ] L1 controller + capability negotiation + persistence/fallback + "Move to…" + migrate floating|docked (incl. floating.right + drawer.right.primary).
  - [ ] L2 DS Drawer/DropZone (entry gate #32) + left drawer + web DnD.
  - [ ] L3 floating.left/center + full ; L4 vscode native mapping (no stacked before L5) ; L5 smart stacked occupancy.
