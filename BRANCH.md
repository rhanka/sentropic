# Fix: Compact DS controls and governance diagram feedback

## Objective
- [x] Apply compact DS controls, frame hierarchy, collapsed layout and clear FR/EN edge labels for PR #711.

## Scope / Guardrails
- [x] Work in `tmp/worktrees/governance-contract`, branch `docs/governance-contract`.
- [x] Make-only commands; Docker browser checks on `ENV=test-governance-contract`.
- [x] At most two commits for the portable performance correction; push without merging or marking ready.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docs/governance/**`
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
  - [x] Refresh checksums and deliver one selective make commit/push; keep PR #711 draft and unmerged.
- [x] **Lot 9 — Reference card attribution footer**
  - [x] Apply radar-immobilier `fa8133c2:docs/architecture/focus/ServiceNode.svelte:30-54` slots and single-line ellipsis; pin the unchanged attribution below the 1px subtle rule with 4px margins, preserving typography and all geometry.
  - [x] Verify all 144 FR/EN structured card occurrences, including 28 central cards per locale; list every truncated occurrence without changing wording in `.tmp/governance-unification/footer6-shots/truncated-cards.md`.
  - [x] Rebuild the portable and save six 1920px FR/EN overview, Sentropic-expanded and Models-card screenshots; compare unchanged geometry in eight states. Reference not rendered; radar-immobilier read-only.
  - [x] Pass source, 102-scene geometry, 16-configuration/328-interaction browser and 32-slide/52-need content checks; refresh checksums and deliver one selective make commit/push without merge or ready transition.
- [x] **Lot 10 — Wrap card content above the pinned footer**
  - [x] Restore multiline titles, subtitles and details with height-budgeted line clamps; preserve wording, footer, typography, colours and geometry.
  - [x] Verify all 144 FR/EN card occurrences: zero title/body truncations, unchanged pinned footers; list the unchanged footer ellipses (40 FR / 38 EN) in `footer7-shots/truncated-cards.md`.
  - [x] Capture 1920px FR/EN overview, Sentropic and Storage views; compare eight geometry states against `e18e59440`, rebuild the portable, refresh checksums and deliver one selective make commit/push without merge or ready transition.
- [x] **Lot 11 — Restore the measured reference card footprint and style**
  - [x] Verify `docs/governance-contract` at `9ef177602` and pull the named remote branch; measure the owner-visible radar-immobilier HTML and read `fa8133c2` without writing to that repository.
  - [x] Use one 460 × 200 leaf footprint (scale 1:1, ratio 2.30:1), reference padding/header/body/footer/border/accent/palette, normal wrapping with fixed line clamps, and a visible 1px separator at overview zoom.
  - [x] Preserve frame rules, collapsed 460 × 272 dimensions, hierarchy/order, labels and edge contracts; verify all 144 FR/EN leaf occurrences and list 68 FR / 67 EN clamped occurrences with unchanged full wording.
  - [x] Rebuild the portable, refresh checksums and pass scoped source/geometry/offline browser/content checks; retain existing static illustrations outside this portable-card correction.
  - [x] Save 1920px FR/EN collapsed, owner-view, fully expanded and actual 100% card captures plus the rendered reference under `cards8-shots`; record measurements, scale and clamped list in `validation/buttons-ds.md`.
  - [x] Run scope gate, selectively stage and deliver one make commit/push; keep PR #711 draft and unmerged.
- [x] **Lot 12 — Apply owner catalogue content corrections while preserving cards-8**
  - [x] Verify and pull `docs/governance-contract` from cards-8 head `d022eca3d`; keep the 460 × 200 cards, typography, separators and styles.
  - [x] Use installed DS Lucide BrainCircuit/Bot geometry; rename the agent catalogue and memory MCP card, remove duplicate catalogue items, retain Track/Focus once in h2a tools, and rename the French Engram zone from the shared source.
  - [x] Align collapsed overview responsibility rows using positions only; preserve edge identities, endpoints, labels and styles while moving routes with their frames.
  - [x] Verify every FR/EN leaf and 1920px overview/expanded alignment, capture the expanded Catalogs zone including MCP tools, and document every before/after string and measurement.
  - [x] Rebuild/deliver the portable, refresh checksums, pass scoped source/geometry/browser/content checks and scope gate; deliver one selective make commit/push, without merging or marking ready.

- [x] **Lot 13 — Apply the approved bilingual wording fit proposal**
  - [x] Apply fit10 measured replacements, including four validated-name shortenings, from the canonical scene sources and dictionary; keep complete zone headings and compact their card attributions.
  - [x] Preserve 460 × 200 cards, typography, geometry, alignment and edges; rebuild the portable and check every FR/EN scene for zero clipped fields.
  - [x] Save 1920px overview and fully expanded captures in `fit11-shots`; refresh checksums and deliver one selective make commit/push without merge or ready transition.

- [x] **Lot 14 — Apply owner naming and pictogram feedback**
  - [x] Use Annotation in both languages, 4. Stockage / 4. Storage, and Artefacts / Artifacts wherever these diagram entries appear.
  - [x] Reuse blue duotone server and people pictograms for AI and Agent catalogs through diagramIcon; remove Lucide card rendering.
  - [x] Preserve 460 × 200 cards, fonts, geometry, alignment, edges and remaining wording; verify FR/EN zero clipped fields and save 1920px expanded Catalogs/Storage captures in polish12-shots.
  - [x] Rebuild the portable, refresh checksums, run scoped checks and deliver one selective make commit/push without merge or ready transition.

- [x] **Lot 15 — Increase body and footer insets by 2px**
  - [x] Increase every FR/EN card body left inset and footer bottom inset by 2px; preserve 460 × 200 dimensions, names, typography, icons, separators, frames and edges.
  - [x] Measure all 720 fields across 144 card occurrences; shorten seven overflowing strings consistently and replace four literal ellipsis occurrences with explicit list continuation.
  - [x] Save 1920px fully expanded FR/EN captures and actual 100% cards in `padding13-shots`; record every wording change in `validation/buttons-ds.md`.
  - [x] Rebuild/deliver the portable, refresh checksums, pass source/geometry/browser/content and scope gates; deliver one selective make commit/push without merge or ready transition.

- [x] **Lot 16 — Match zone icons and increase card insets to 4px**
  - [x] Render every FR/EN zone icon at 70px with the cards' 6px icon-to-text gap; fit collapsed subtitles using measured font advances.
  - [x] Increase body left and footer bottom additions from 2px to 4px; preserve square 460 × 200 cards and shorten the two measured overflowing strings consistently.
  - [x] Verify all 720 fields, unchanged card/frame/edge positions and zero row deviation; capture 1920px FR/EN overview, Sentropic expanded and live agents memory at actual 300% under `icons14-shots`.
  - [x] Rebuild the portable, refresh checksums, run source/geometry/offline Chromium/content and scope checks, then deliver one selective make commit/push without merging or marking ready.

- [x] **Lot 17 — Merge current main and repair click latency**
  - [x] Merge origin/main; retain this governance plan for the sole BRANCH.md add/add conflict and all incoming production/CI fixes.
  - [x] Reproduce the 1800ms mixed-fold click failure; optimize immutable routing without visual changes and add a permanent 1800ms regression.
  - [x] Rebuild the portable; verify source, geometry, offline file Chromium, 360 interactions, 720 fields and zero ellipses.
  - [x] Push the fix and verify CI on the exact head; retain the draft PR without merging.

- [x] **Lot 18 — Remove the remaining stress-fold routing stall**
  - [x] Verify/pull `docs/governance-contract` at `b92a294a9`; reproduce the stress failure before editing, without increasing the 1800ms budget.
  - [x] Profile uncached routing; replace coordinate-string graph/search keys and connection objects with compact numeric adjacency and search arrays, preserving routes byte-for-byte in both languages.
  - [x] Add the deterministic 120-change FR/EN regression to existing browser checks; rebuild and verify source, geometry, content, offline Chromium title/diagram/console and delivery checksums.
  - [x] Deliver one selective make commit/push; require green CI on that exact head and retain the draft PR without merging.

- [x] **Lot 19 — Integrate Artifacts hardening main**
  - [x] Verify docs/governance-contract at 08842eb30, pull the named branch and merge origin/main at 6ec93105b without rebase.
  - [x] BR711-EX2: Owner authorizes all upstream #708 Artifacts, packaging, lockfile and L5 provenance paths. Retain upstream bytes; resolve the sole BRANCH.md conflict with this governance plan. Rollback: revert the merge commit.
  - [x] Preserve every governance source, image, portable and checksum byte; no portable rebuild is required. Preserve the unchanged Track log and both parent histories.
  - [ ] Push normally and verify green CI on the exact head, using workflow_dispatch if needed; keep PR #711 draft and unmerged.

- [x] **Lot 20 — Restore the original footer bottom offset**
  - [x] Remove only the footer relative positioning added by padding commits; restore the pre-padding 9.25px bottom offset, retaining the 4px body inset, 70px zone icons, square 460 × 200 cards, wording and routing performance fixes.
  - [x] Rebuild the portable and checksums; verify offline Chromium title, visible diagram, no console errors, zero ellipses and a 300% Server API crop under `revert18-shots`.

- [x] **Lot 21 — Unify the four product zone headers**
  - [x] Start from clean icons-wording-19 head ef884f858 and pull docs/governance-contract; render H2A, SENTROPIC, ENGRAM and DESIGN SYSTEM kickers above unprefixed titles, with subtitles below the icon at the left inset in FR/EN and all fold states.
  - [x] Reuse atomic-card typography ratios and the non-scaling 1px footer separator with 16px/10px margins; preserve other zones, chips, tabs, geometry, routes and aligned rows.
  - [x] Rebuild the portable; verify source, geometry, content, offline Chromium and 1920px FR/EN collapsed/h2a-expanded screenshots under `zonehdr20-shots`; deliver one selective make commit/push and verify exact-head CI without merging or marking ready.
- [x] Owner kicker21: match atomic kicker weight, font, grey token, spacing and case in FR/EN; wrap expanded product subtitles to the collapsed header width and reserve routing clearance while keeping rows aligned.
- [x] Verify the file URL in Chromium at 1920 px in FR/EN: title loaded, diagram visible, no console errors, no ellipsis or clipped card text, and all expanded product subtitles contained in their headers; save four screenshots under `.tmp/governance-unification/kicker21-shots/` in the root checkout.
- [x] Validate source and geometry: 102 scenes, 732 edges, zero collisions or header intrusions.
- [x] Run the full Chromium browser matrix: 16 captures, 600 interactions, FR/EN desktop/mobile and light/dark, zero console errors; keep the existing contextual dark grey token for contrast.

- [x] **Lot 22 — Integrate common storage contract main**
  - [x] Verify docs/governance-contract at 66d6a831e, pull the named branch and merge origin/main at 50e612a0e without rebase.
  - [x] BR711-EX3: Owner authorizes incoming #716 common storage contract, fixed-vector tests, specification, package metadata, lockfiles and pre-candidate manifest paths. Preserve upstream bytes; resolve the sole BRANCH.md content conflict by retaining this governance plan. Rollback: revert the merge commit.
  - [x] Preserve all governance sources, images, portable, checksums and Track log byte-for-byte; no portable rebuild is required.
  - [ ] Push normally and verify green CI on the exact head, using workflow_dispatch if needed; keep PR #711 draft and unmerged.

- [x] **Lot 23 — Use one zone header at every depth**
  - [x] Verify and pull the clean main-merge-22 head c6b22bbab on docs/governance-contract.
  - [x] Remove the legacy header rendering and measurement; share card-style kickers, titles, left-inset wrapped subtitles and expanded footer separators across all zones and both languages.
  - [x] Set access kickers to SENTROPIC & TIERS / SENTROPIC & 3RD PARTIES; retain access titles and subtitles. Use owning-package SENTROPIC kickers for all five Sentropic sub-zones, retaining their current titles; report this choice for owner revision.
  - [x] Rebuild the portable; measure every subtitle and all 720 card fields, preserve wording and card footprints, and capture 1920px FR/EN overview and Sentropic-expanded screenshots under onecomp23-shots.
  - [x] Pass source, geometry, content and the full 16-capture/600-interaction browser gate; isolate strict stress traversals in fresh Chromium processes after shared-session expirations, retaining the 1800ms budget and production routing code.
  - [x] Prepare one selective make commit/push, requiring exact-head green CI before delivery; retain the draft PR without merging or marking ready.

- [x] **Lot 24 — Match atomic card typography without zone scaling**
  - [x] Verify/pull `docs/governance-contract` at `90e105b4e`; reproduce the 24.75/36/27 versus 22/32/24 computed-size mismatch in Chromium.
  - [x] Use 22/32/24px, weight 400/700/400 and 1.3 line-height for every FR/EN zone kicker/title/subtitle in collapsed and expanded states; match card colours and kicker spacing without changing cards, icons, insets or wording.
  - [x] Preserve the validated header slots, icon positions and routing geometry independently of the smaller rendered text; retain aligned rows and rebuild prepared scenes/routes and the portable.
  - [x] Use the cards' white surface and a contrast-safe border for dark-mode zones so identical fixed text colours retain contrast; preserve light-mode zone surfaces.
  - [x] Verify all headers and 720 card fields, source/102-scene geometry/content and offline file Chromium; save 1920px FR/EN overview and 300% Access surfaces/AI providers comparison under `titlesize24-shots`.
  - [x] Run the full browser matrix: style/contrast/containment checks pass in all 16 captures; record unresolved 1800ms interaction/stress expirations (FR 57/96 and a mobile tap) under `titlesize24-shots`. Owner: code author; status: observed, not waived. Acceptance: one complete unchanged-budget browser run.
  - [x] Prepare refreshed checksums and selective one-commit delivery; push and exact-head green CI are required before the final report, retaining draft/unmerged PR #711.

- [x] **Lot 25 — Bound portable load and fold CPU**
  - [x] Verify clean `222d7c106`, mechanically check the branch and pull the named remote branch.
  - [x] Profile offline Chromium load, ten-second idle CPU, three tabs and expand-all; retain the baseline and CPU samples under `kit/.cache/`.
  - [x] Remove runtime construction of unused source scenes, batch frame-control measurements and optimize route visibility scans without changing output.
  - [x] Verify unchanged routes and screenshots; rebuild, pass the full unchanged-1800ms browser matrix plus isolated stress and add an idle/load regression.
  - [x] Record before/after metrics in `validation/performance.md`, refresh portable/checksums and prepare two selective make commits; push and exact-head green CI are mandatory before handoff, keeping #711 draft and unmerged.

- [x] **Lot 26 — Flow zone headers from their actual content**
  - [x] Verify/pull `docs/governance-contract` at `1687e9362`; retain the current base without merging main.
  - [x] Position subtitles and centre icons against the actual kicker/title lines, matching atomic CSS line boxes while preserving routing clearance, card/frame sizes, fonts, wording, rows and edges.
  - [x] Measure all ten zones in FR/EN, expanded and individually collapsed: SVG title-bottom to subtitle-top is 7.59375px, identical to the atomic text Range gap (6px CSS gap plus title leading). Compare unchanged collapsed/expanded geometry and capture 1920px overviews under root `.tmp/governance-unification/hdrflow26-shots/`.
  - [x] Add a regression rejecting the previous portable; rebuild and pass source, 102-scene/732-edge geometry, 16-capture/600-interaction offline Chromium, content and idle/load performance checks. Worst click: 533ms below the unchanged 1800ms budget; zero console errors, ellipses or clipped fields.
  - [x] Refresh checksums and prepare one selective make commit/push; require green CI on the exact head before handoff, retaining draft/unmerged PR #711.
- [x] **Lot 28 — Centre collapsed zone subtitles without stretching**
  - [x] Verify `docs/governance-contract` at `5e4fb1adf`; centre every FR/EN collapsed subtitle line with normal body spacing and centre its block below the icon/kicker/title, using the 16px inner inset plus 16px side margins.
  - [x] Reject subtitle textLength, lengthAdjust and letter/word spacing overrides; verify all ten zones and byte-identical fully expanded groups, cards, geometry and edges against the starting head.
  - [x] Rebuild the portable; verify offline Chromium title, visible diagram and zero console errors, clipped fields or ellipses; save 1920px FR/EN overviews and 200% Sentropic crops under root `.tmp/governance-unification/center28-shots/`.
  - [x] Pass source, 102-scene geometry, 16-capture/600-interaction browser, content, unchanged performance budgets and scope checks; refresh checksums and prepare one selective make commit/push. Delivery requires exact-head green CI with PR #711 draft and unmerged.

## Release integration — PR #711 (2026-10-21)
- [x] Owner explicitly authorizes eight logical history commits, exact-lease force-push, merging main and final PR merge; this supersedes the earlier draft-only guardrails.
- [x] BR711-EX4: Preserve validated tree b6783fc385319199fc763e19d5f2748f832f4c61 exactly after squashing. Group imported source, licensed assets, owner screenshots and generated delivery artifacts into eight logical commits; these imports may exceed 150 lines and 15 files. Impact: history only, no final content change. Rollback: restore refs/release-backups/pr-711-validated-20261021.
- [x] Generated routes JSON, portable HTML, static images and validation evidence stay in their own logical commits and may exceed 150 lines. Record this exception in commit message bodies, without trailers.
- [x] Restore this plan to the owner's validated bytes in the final delivery commit.
- [x] Release squash lot 1.
- [x] Release squash lot 2.
- [x] Release squash lot 3.
- [x] Release squash lot 4.
- [x] Release squash lot 5.
- [x] Release squash lot 6.
- [x] Release squash lot 7.
- [ ] Release squash lot 8.
