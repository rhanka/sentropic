# feat(docs): converge governance folds on the shared card base

## Objective
- [x] Follow OWNER-ORDER-711-hrpolnav-base.md: atomic 460 × 200 collapsed zones in every scene, DS IconButton and wrapping legend.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/governance-converge`, branch `feat/governance-converge-hrpolnav`, base `origin/main`.
- [x] Make-only, no Python, Docker-only Node, `ENV=test-governance-converge` last; file Chromium needs no ports or services.
- [x] Read hrpolnav and design-system only; preserve validated card values, typography, icons, expanded 4/16/16 geometry and performance budgets.
- [x] Selective staging, make commit only, no attribution trailers; push draft PR, do not merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/governance/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths**:
  - None.
- **Exception process**:
  - [x] Record reason, impact and rollback before touching any unlisted path.

## Feedback Loop
- [x] Report H1–H9 replacements and all source divergences in `docs/governance/validation/converge32.md`.
- [x] Replace inherited #711 plan; generated routes/portable and inherited-plan replacement exceed routine line budget. Keep handwritten implementation commits near 150 lines.
- [x] No Track writes: scope excludes `.track/**`; mechanical harness checks remain mandatory.

## AI Flaky tests
- [x] No provider tests apply to this offline documentation kit.

## Orchestration Mode (AI-selected)
- [x] Single author, isolated worktree.

## UAT Management (in orchestration context)
- [x] Offline Chromium in this worktree; no root dev environment.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read owner order, rules, harness, template, hrpolnav provenance/hacks and readable DS specification; create worktree and pass mechanical branch check.
- [x] **Lot 1 — Shared card anatomy**
  - [x] Update `src/hrpolnav-card.js`, `src/architecture-svg.js`, `src/governance-layout.js`: atomic renderer, reserved toggle slot, centred body, shared 460 × 200 geometry.
  - [x] Preserve all 144 leaf values, typography, icons and expanded headers; remove clamping/clipping and surface overflow. Reference card parity passes within 0.02 px.
- [x] **Lot 2 — Every scene and wrapping legend**
  - [x] Update `src/governance-collapse.js`, `src/study-layout.js`, `src/ArchitectureFigure.svelte`, `scripts/prepare-scenes.mjs`: every scene/depth, prepared folds, reversible aggregation.
  - [x] Wrapping legend with semantic swatches, using the same zone/fold path.
- [ ] **Lot 3 — Qualification**
  - [ ] Run new `scripts/check-{convergence,card-parity,routing-budget}.mjs` through kit Makefile targets; retain the existing browser, geometry, content and idle gates.
  - [x] Geometry: 1,758 states / 16,740 edges, no collision. Compact validated port/order plans cover 1,356 additional folds in 76 KB; worst plan replay 121 ms. Browser fit remains pending the recorded wording conflict.
  - [ ] Source, geometry, browser (600 interactions + 240 stress toggles), content and unchanged idle/1800 ms performance gates.
  - [x] Delivered file Chromium: loaded title, visible diagram, zero console errors; 1920 px FR/EN collapsed overview and Sentropic expanded screenshots in root `.tmp/governance-unification/converge32-shots/`.
- [ ] **Lot 4 — Delivery**
  - [ ] Record H1–H9 file:line replacements, divergences and validation in `validation/converge32.md`.
  - [ ] Rebuild/deliver portable, refresh SHA256SUMS; scope check before each selective make commit.
  - [ ] Push draft PR using this plan as body, post four-lot plan; green final-head CI; report PR/SHA/digest; do not merge.
