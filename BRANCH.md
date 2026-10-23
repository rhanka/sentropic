# feat(docs): converge governance folds on the shared card base

## Objective
- [x] Follow OWNER-ORDER-711-hrpolnav-base.md: atomic 460 × 200 collapsed zones in every scene, DS IconButton and wrapping legend.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/governance-converge`, branch `feat/governance-converge-hrpolnav`, base `origin/main`.
- [x] Make-only, no Python, Docker-only Node, `ENV=test-726-reword` last; file Chromium needs no ports or services.
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
- [x] R2 owner decision (2026-10-23): “Reformuler les textes”. Reword only the 34 overflowing collapsed occurrences; preserve package kickers, expanded text, both central scenes and all geometry/font values. Verify with `scripts/check-reword.mjs` against `10b7b22bc`.
- [x] Astra R1: restore and assert measured 16 px outer summary insets (428 px body); remove the incorrect central wording-conflict claim.
- [x] Astra R3: time and gate every counted ordinary operation, require 600 measured ordinary operations plus 240 measured stress toggles, and report complete-set maxima below 1800 ms.
- [ ] R3 complete runtime witness: three attempts stopped on different operations after 17/223/28 measured operations. Boundary/count regression probes pass; no complete passing 660 + 240 campaign is claimed. Preserve the 1800 ms gate.
- [x] Astra additional findings: disclose final-owner 14 px versus measured 20 px leaf-body conflict and inherited unequal adjacent expanded frame heights; preserve validated values.
- [x] Rebase onto main to resolve the root plan conflict blocking PR CI; preserve correction sources exactly, inherit the DOMPurify override and rebuild in isolated dependencies. Portable SHA-256 reproduces `0b8db12478f4d7badc9d2f7819ec335e7d713287a755548627e118a2b93f2b47`.
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
  - [x] Run new `scripts/check-{convergence,card-parity,routing-budget}.mjs`; card parity, pinned footer at 0/1/2 lines and routing budgets pass. Strict fit stays blocking on unchanged long zone text.
  - [x] Geometry after R1: 1,758 states / 16,740 edges, no collision. Compact validated port/order plans cover 1,356 additional folds in 76 KB; worst plan replay 271.48 ms. Card parity passes for all 144 leaves. Browser fit remains pending the recorded wording conflict.
  - [x] Prior browser count corrected by R3: only 560 of 656 ordinary entries were measured; the historical maximum did not establish the complete interaction budget. Rerun the complete measured witness after R1.
  - [x] Delivered file Chromium: loaded title, visible diagram, zero console errors; 1920 px FR/EN collapsed overview and Sentropic expanded screenshots in root `.tmp/governance-unification/converge32-shots/`.
- [ ] **Lot 4 — Delivery**
  - [x] Record H1–H9 file:line replacements, divergences and validation in `validation/converge32.md`.
  - [x] Rebuild/deliver portable, refresh and verify all 135 SHA256SUMS entries; scope check before each selective make commit.
  - [x] Create draft PR #726 using this plan as body and post the four-step plan; keep it draft and unmerged.
  - [x] R1 qualification: ten scene/locale pairs, both central views pass, eight secondary fit failures; content retains 32 slides / 52 routes with 16 remaining fit findings. Idle/load checks pass all four scenarios.
  - [ ] Post-push gate: report exact-head CI and the final portable digest in the delivery response; keep the PR draft and unmerged while R2 and the complete R3 runtime witness remain pending.
