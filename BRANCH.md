# Fix: Compact DS controls and governance diagram feedback

## Objective
- [x] Apply compact DS controls, frame hierarchy, collapsed layout and clear FR/EN edge labels for PR #711.

## Scope / Guardrails
- [x] Work in `tmp/worktrees/governance-contract`, branch `docs/governance-contract`.
- [x] Make-only commands; Docker browser checks on `ENV=test-governance-contract`.
- [x] At most two commits for the portable performance correction; push without merging or marking ready.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `README.md`
  - `docs/governance/images/**`
  - `BRANCH.md`
  - `docs/governance/kit/src/architecture-svg.js`
  - `docs/governance/kit/src/architecture-icons.js`
  - `docs/governance/kit/src/hrpolnav-card.js`
  - `docs/governance/kit/src/ArchitectureFigure.svelte`
  - `docs/governance/kit/src/architecture-routing.js`
  - `docs/governance/kit/src/FrameToggle.svelte`
  - `docs/governance/kit/src/App.svelte`
  - `docs/governance/kit/src/app.css`
  - `docs/governance/kit/src/architecture-layout.js`
  - `docs/governance/kit/src/governance-central.js`
  - `docs/governance/kit/src/study-layout.js`
  - `docs/governance/kit/src/architecture-adoption.js`
  - `docs/governance/kit/src/governance-layout.js`
  - `docs/governance/kit/src/governance-collapse.js`
  - `docs/governance/kit/src/governance-summary.js`
  - `docs/governance/kit/src/governance-summary-layouts.json`
  - `docs/governance/kit/src/governance-routes.json`
  - `docs/governance/kit/src/presentation-scenes.json`
  - `docs/governance/kit/src/i18n-en.json`
  - `docs/governance/kit/scripts/prepare-summary.mjs`
  - `docs/governance/kit/scripts/prepare-scenes.mjs`
  - `docs/governance/kit/scripts/check-performance.mjs`
  - `docs/governance/kit/Makefile`
  - `docs/governance/kit/scripts/check-r11-final.mjs`
  - `docs/governance/kit/scripts/check-geometry.mjs`
  - `docs/governance/kit/scripts/check-browser.mjs`
  - `docs/governance/kit/scripts/browser-checks.mjs`
  - `docs/governance/kit/dossier.json`
  - `docs/governance/governance-r11-portable.html`
  - `docs/governance/SHA256SUMS`
  - `docs/governance/validation/diagram-restore.md`
  - `docs/governance/validation/buttons-ds.md`
  - `docs/governance/validation/performance.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths**:
  - `package-lock.json` (BR711-EX3: unchanged upstream merge only).
  - `packages/cluster-mesh/package.json` (BR711-EX3).
  - `packages/cluster-mesh/src/storage/common-contract.ts` (BR711-EX3).
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR711-EX3).
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR711-EX3).
  - `packages/cluster-mesh/tests/storage/common-rule/**` (BR711-EX3).
  - `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md` (BR711-EX3).
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (BR711-EX3).
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256` (BR711-EX3).

## Feedback Loop
- [x] Owner icons19: add blue duotone brain/robot catalogue pictograms, rename the MCP zone to Connectors/Connecteurs and add NHI beside IAM in FR/EN; preserve card geometry, insets and the reverted footer.
- [x] BR711-EX1: Owner explicitly authorizes merging origin/main, including upstream Makefile, CI, API image scripts/Dockerfile, lockfile and memory manifest changes. Impact: retain all merged #712 fixes without local edits. Rollback: revert the merge commit.
- [x] Owner correction: all collapsed frames use the validated 460 × 272 leaf footprint at every depth; retain title wrapping, DS controls, 24-unit overview fit, reduced spacing, leaf cards and fully expanded geometry.
- [x] PR #711 polish: derive collapsed widths from titles, fit all-collapsed bounds with equal padding, and use embedded Inter Bold for zone headings; preserve controls, labels and expanded geometry from `230f17ebe`.
- [x] Owner: preserve cards and expanded geometry from `ffcc25c20`; explicit exceptions cover frame headings/toggles, collapsed layout and edge labels.
- [x] Owner: one commit for this correction, including generated artifacts and proof; this supersedes the routine commit size limit.

## Orchestration Mode
- [x] Single author, one worktree.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Correct owner feedback**
  - [x] Use DS Button/IconButton sm and DS Lucide icons; remove local control dimensions.
  - [x] Restore zone/card hierarchy without changing cards or expanded geometry.
  - [x] Compact collapsed frames through ELK rules; clarify and capitalize every central edge label in FR/EN.
- [x] **Lot 2 — Verify and prepare delivery**
  - [x] Update `scripts/check-r11-final.mjs`; capture control area, expanded headers and collapsed view at 1440/1920 FR.
  - [x] Check source, geometry, browser interaction, offline operation and expanded canvas pixel diff with authorized headers/labels masked.
  - [x] Rebuild portable, update SHA256SUMS and record computed measurements/label changes in `validation/buttons-ds.md`.
  - [x] Run scope gate; prepare selective staging and a single make commit/push; no merge or ready transition.
- [x] **Lot 3 — Uniform collapsed card footprint**
  - [x] Share collapsed dimensions between recursive packing and ELK overview generation; keep expanded geometry and leaf rendering unchanged.
  - [x] Rebuild portable and checksums; check source, geometry and offline browser behavior in FR/EN.
  - [x] Capture before/after overview and Sentropic with collapsed children at 1440/1920; compare dimensions against the validated leaf and verify fully expanded geometry equality.
  - [x] Record proof, run scope gate, selectively stage, make one commit and push without merge or ready transition.
- [x] **Lot 4 — Owner naming and keyboard focus**
  - [x] Apply the approved FR/EN names at the central source and translation dictionary, including access apps, collaborative views and curated knowledge; retain card content and all geometry.
  - [x] Restore frame focus only for keyboard activation so mouse clicks do not inherit the DS focus-visible ring.
  - [x] Rebuild portable; apply names only to README images, preserving their existing geometry; verify 1920px FR/EN before/after captures, 460 × 272 collapsed boxes and title containment.
  - [x] Record every renamed string (11 FR / 19 EN dictionary strings), refresh SHA256SUMS and pass source, 102-scene geometry, 16-configuration browser, content and static-image checks.
  - [x] Prepare one selective make commit and push under the owner's delivery instruction; retain the draft PR without merge or ready transition.
- [x] **Lot 5 — Owner shorter h2a zone name**
  - [x] Apply Responsible AI Organization / Organisation IA responsable across the central source, translations, dossier and README illustrations.
  - [x] Preserve geometry; rebuild portable and checksums; verify 460 × 272 boxes and title containment in 1920px FR/EN overview captures.
  - [x] Deliver one selective make commit and push; keep PR #711 draft and unmerged.
- [x] **Lot 6 — Owner left-to-right numbering and collaborative views**
  - [x] Number Storage 4 and Security and observability 5 in FR/EN across live projections and static illustrations, preserving box placement.
  - [x] Apply Collaborative Views / Vues collaboratives and the approved annotations, diagrams, decision dossiers and AI-ready UI components subtitles.
  - [x] Rebuild the portable; verify 460 × 272 collapsed boxes, text containment and identical before/after geometry in 1920px FR/EN overview, Sentropic and expanded views.
  - [x] Save screenshots and measurements under `.tmp/governance-unification/naming3-shots/`; refresh checksums and deliver one selective make commit/push, keeping PR #711 draft and unmerged.
- [x] **Lot 7 — Owner access surfaces subtitle**
  - [x] Set EN `AI providers · Cowork · CLIs · 3rd-party applications` and FR `Fournisseurs IA · Cowork · CLI · applications tierces` at the central source and translation; propagate to prepared scenes, static illustrations and portable.
  - [x] Verify unchanged geometry, 460 × 272 boxes and subtitle fit; save 1920px FR/EN overview screenshots and measurements under `.tmp/governance-unification/naming4-shots/`; refresh checksums and deliver one selective make commit/push without merge or ready transition.
- [x] **Lot 8 — Owner storage model card wording**
  - [x] Remove the qualification suffix from the central FR detail and EN translation; retain other card and zone wording.
  - [x] Rebuild the portable; verify unchanged geometry, fonts and 460 × 272 collapsed boxes, with a single-line storage detail in FR/EN; save 1920px overview and expanded-card screenshots and the wording audit under `.tmp/governance-unification/naming5-shots/`.
