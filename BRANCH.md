# Feature: feat(governance-kit): render only the dossier's data + artifact size budget

## Objective
- [x] Deliver W0, W1 and W4 from the approved artifact-weight analysis: dossier-only runtime data and a reproducible CI size budget, without changing the DS package.

## Scope / Guardrails
- [x] Base: `origin/main` (exact base/head captured by CI receipts); W0 reference at `80b140557393667d468a0a99363a6bec99ed9150`; branch: `feat/artifact-render-budget`.
- [x] Isolated worktree: `tmp/worktrees/artifact-weight`; root remains reserved for owner work.
- [x] Make-only execution; no Python; no DS package or dependency version changes.
- [x] Environment: `test-artifact-weight`, last argument of every make command; no application service ports required by the isolated file/build lane.
- [x] Docker yielded to radar until 2026-10-27 21:00 UTC; author code/tests first.
- [x] Every Docker build/test uses `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; release between steps; finish each step with `make down` under the lock.
- [x] Atomic commits under 150 changed lines; selective staging; `make commit`; no AI trailers.
- [x] Preserve full governance geometry, languages and runtime routing behavior, and exact embedded-font notices; no unrelated cleanup.
- [x] Typical fixture limits: portable/initial closure 409600 B, initial JS 307200 B, optional chunk 131072 B, release 524288 B.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/governance/kit/**`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] Declare reason, impact and rollback before edits in Feedback Loop.

## Feedback Loop
- [x] BR84-R5 — Requalified clean post-merge `a0172ce326f890c21f1c7e236fd5e9907ba3de5a` under the shared Docker lock; this receipt-only follow-up updates `qualification.json` and the plan. Typical: 291943 B portable / 249234 B JS, 124617 estimated agent tokens; baseline 3734180 B. Fourteen tests, 2496 exact figure/route comparisons, 1758 geometry scenes and eight offline browser configurations passed. Docker cleanup complete. Also preserved intermediate review heads at `backup/pr801-intermediate-c14fe7723` and `backup/pr801-intermediate-57fa94d93`.
- [x] BR84-R4 — Document the 72-byte CSP addition, approximately 5% governance headroom, direct main comparison and post-merge receipt binding; retain the original qualification history through the remote backup refs.
- [x] BR84-R2 — Direct deterministic comparison executes main `5016fa36a9da25d22972ae092d13bd4357e65e58` and current SVG/projection/collapse implementations: both languages, all figures, navigation highlights, prepared folds and plans. Compare exact SVG hashes/byte counts plus canonical graph hashes; retain per-case receipts under `.cache/artifact-weight/governance-equivalence.json`.
- [x] BR84-R1 — Budget now enforces single-file inline resources and CSP `connect-src 'none'` on the measured portable; report includes the owner's non-gating token estimate. Governance ceilings: 5200000 B portable/closure/release and 5120000 B JS, approximately 5% above the r1 measurement (4936759 / 4874332 B).
- [x] BR84-F5 — 2026-10-27: three force-pushes rewrote history in violation of the owner's merge-only rule. Both histories preserved remotely: `backup/pr801-pre-rebase-ca81d9392` and `backup/pr801-current-7e335423e`. From this point: merges only, no rebase or force-push; merge `origin/main`, keep this PR's plan, then requalify and bind the receipt to a reachable post-merge commit.
- [x] BR84-EX1 — Owner-authorized Makefile exception: add artifact budget/build/test targets and enable installed-host scope checking for this ENV. Reason: reproducible Make-only validation and pre-21:00 non-Docker commits. Impact: additive tooling lane; no application runtime changes. Rollback: remove the targets and ENV condition.
- [x] BR84-EX2 — Owner-authorized CI exception: add the budget step/report upload (explicit `.cache` report paths only) in `validate-artifacts`, extend its change filter to kit and DS consumer inputs. Reason: prevent data-corpus regressions. Impact: this validation job runs for those paths; publication filters remain unchanged. Rollback: remove the added step/upload and filter entries.
- [x] Approved analysis: `.tmp/ds-artifact-weight/analysis.md` sections 3–5; review `.h2a/reviews/ds_artifact_weight_opus_r1.md` APPROVE; incorporate P2-1 through P2-4 in the committed receipt and validation.
- [x] BR84-F1 — Full-governance build omitted its `../raw-spec.md?raw` input from scratch; copied the declared raw input. The full-governance build is the regression gate.
- [x] BR84-F2 — Portable initialization: the fixture called `diagramTabs()` as an expression, so Svelte received no DOM anchor (`before` error). Replaced with `{@render diagramTabs()}`; four offline configurations and all 48 fold states pass. Initialization error/DOM/stack receipts retained; no timeout increase.
- [x] BR84-R3 — Removed the final-gate change and its test-fixture edits from this PR; CI gate permissions/capture and both CI tests now match main. Only the owner-authorized artifact validation/filter/upload lane remains changed in CI.

## AI Flaky tests
- [x] No AI/provider tests in this scope; no flaky exception requested.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** — one code author; no cherry-pick; focused file/build validation.
- [ ] **Multi-branch**
- [x] Rationale: W0/W1/W4 implement one dossier data boundary and its regression gate.

## UAT Management (in orchestration context)
- [x] Qualification uses the integrated branch, isolated file/browser probes and output hashes; no root dev stack.
- [x] Web app, Chrome plugin and VS Code plugin are not modified.

## Plan / Todo (lot-based)
- [x] **W0 — Baseline receipt**
  - [x] Read project rules, approved analysis/review and Docker lock; verify branch mechanically.
  - [x] Pin harness r5 input/dependency hashes, renderer/toolchain and preserved before/slim/Focus output hashes in `docs/governance/kit/fixtures/artifact-weight/baseline.json`.
  - [x] Preserve the representative two-diagram, two-question/six-option, 24-row/eight-gap fixture and its source provenance.
  - [x] Rebuild the baseline and scoped fixture after the Docker reservation; explain differences from preserved outputs. Node 24.22.1 pinned; 14 tests pass; baseline 3734180 B / typical 291943 B HTML, JS 3691474 B / 249234 B; hash-bound post-merge `fixtures/artifact-weight/qualification.json` receipt.
  - [x] Record the read-before-publication contract, corrected source anchors and separate L1/host qualification limits in `docs/governance/kit/ARTIFACT_BUDGET.md`.
- [x] **W1 — Dossier data boundary**
  - [x] Remove global route/summary imports from the diagram engine; explicitly bind governance data in its consumer and preparation scripts.
  - [x] Supply selected scenes, folds/plans, summary geometry and locale dictionary through dossier inputs; fail missing required projection data.
  - [x] Scope route cache identity to scene/geometry/routing version; preserve bounded runtime routing for uncovered folds.
  - [x] Add `scripts/artifact-input.test.mjs`: scoped projection, missing routes, fold geometry/cache identity and translation equivalence.
  - [x] Add `scripts/portable.test.mjs`: reject dynamic `assets/` imports, sibling chunks and external portable dependencies.
  - [x] Run focused Node tests, full-governance geometry/routing and FR/EN browser checks (`scripts/check-governance-input-browser.mjs`), and offline browser interactions for the typical fixture.
  - [x] UAT: `scripts/check-artifact-browser.mjs` covers both diagrams/folds, light/dark, mobile/desktop, zoom, option state, inventory totals and JSON downloads.
- [x] **W4 — Artifact size budget**
  - [x] Add deterministic fixture build and Vite module/chunk manifest reporting, without mutating tracked source.
  - [x] Add `scripts/artifact-budget.mjs` and `scripts/artifact-budget.test.mjs`: raw/gzip/Brotli/SHA-256, initial/static/startup/full closures, per-chunk limits and agent read cost.
  - [x] Negative tests: corpus reimport, oversized startup data, deferred/inline JS excess, missing/unreferenced assets and portable dynamic imports.
  - [x] Add `make check-artifact-budget` and CI step in `validate-artifacts` with `docs/governance/kit/**` filter and output report artifact.
  - [x] Preserve a separately bounded full-governance profile; do not claim actual A2UI L1 DS 0.36.0/chart qualification.

- [x] **Docs consolidation**
  - [x] Document explicit input/build contract, budget counting, baseline comparison and report reproduction.
  - [x] Record server-side pinned-runtime reuse as a future host qualification candidate, without claiming support.

- [ ] **Final validation**
  - [x] Focused tests and budget build under the shared lock, after 21:00 UTC; geometry 1758 scenes / 16740 relations, zero findings, planned routing max 73.6 ms.
  - [x] Full-governance geometry/routing checks; typical offline/browser checks; report output digests and before/after sizes.
  - [x] Review final diff and mechanically validate scope before every commit.
  - [x] Run `make down ENV=test-artifact-weight` under the shared lock after every container step and after final qualification.
  - [x] Push `feat/artifact-render-budget` and create draft PR #801 to `main` with this plan as body and the requested title.
  - [ ] Wait for CI on the pushed head and resolve branch failures; report head and measured sizes.
  - [x] Package version bump not applicable: no package source changes; draft PR only, no merge requested.
