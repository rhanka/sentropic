# Feature: CI publishable manifest guard — Lot G SPEC + BUILD

## Objective
- [x] Deliver the design for baseline-qualified package CI lint, packed-manifest enforcement, and clean consumer installation qualification.
- [x] BUILD: implement `spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md` lots with exceptions BRCI-EX1..EX4 and review conditions N1/N2.

## Scope / Guardrails
- [x] Planning only on `ci/publishable-manifest-guard`, worktree `tmp/ci-manifest-guard`; baseline `273bff382` equals local `origin/main` at entry.
- [x] BUILD base: `origin/main` `28bfcf9f5` merged (merge commit `8a3c8567c`, no conflicts; includes PR #605 gateway 0.18.0 and mcp-auth 0.2.1).
- [x] No dependency changes, publication, push, PR, merge, or edits outside this worktree.
- [x] Make-only checks; Docker-first; no Python; English text; `ENV` last; no `ENV=dev` or `clean-all`.
- [x] BUILD environment: `test-ci-manifest-guard`; ports API `9440`, UI `5640`, Maildev UI `1540`; no services required.
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md`
  - [x] `BRANCH.md`
  - [x] `Makefile` (BRCI-EX1 only)
  - [x] `.github/workflows/ci.yml` (BRCI-EX2 only)
  - [x] `scripts/ci/publishable-manifests.mjs`, `scripts/ci/check-publishable-manifests.sh`, `scripts/ci/qualify-published-install.mjs`, `scripts/ci/*.test.mjs` (BRCI-EX3 only)
  - [x] `rules/workflow.md` Package Publication section (BRCI-EX4 only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `packages/**`, `api/**`, `ui/**`, `e2e/**`, other `scripts/**`
  - [x] `package.json`, `package-lock.json`, other `rules/**`, `plan/**`, `PLAN.md`, `.track/**`
  - [x] Every path outside the Allowed Paths.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**: none beyond BRCI-EX1..EX4.
- [x] **Exception process**: BRCI-EX1..EX4 applied for BUILD exactly as declared in spec section 12.

## Feedback Loop
- [x] BRCI-A1 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): BLOCK changed packages, absent packed versions selected for publication, and explicit bootstrap targets; WARN unrelated existing versions to avoid root-lock debt fanout.
- [x] BRCI-A2 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | Install replays are mandatory BUILD closure evidence; SPEC cannot add or execute the nonexistent target. Expected: two successful reports; actual: pending implementation.
- [x] BRCI-A3 | attention | Owner: conductor | Branch: current | 2026-09-24 | This two-file scope excludes harness/track recorder writes; branch and scope checks remain mandatory. Independent review precedes conductor push/PR/merge.
- [x] BRCI-A4 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | Reversible: full candidate packs for BLOCK, lifecycle-free inventory snapshots for WARN; avoids unrelated native builds while every actual publication remains strict.
- [x] BRCI-EX1 / BRCI-EX2 / BRCI-EX3 / BRCI-EX4 | attention | Owner: BUILD conductor | Branch: future BUILD | 2026-09-24 | Proposed only: Makefile, ci.yml, named scripts/tests, Package Publication rule; reason/impact/rollback in spec section 12. None applied here.
- [x] BRCI-A5 | attention | Owner: conductor | Branch: cowork remediation | 2026-09-24 | conductor decision (reversible): cowork-desktop owner remains unassigned; root-only changes and bootstrap all leave existing packed versions WARN; changed cowork, absent selected versions, and explicit cowork bootstrap stay BLOCK.
- [x] BRCI-A6 | deferred | Owner: conductor | Branch: current | 2026-09-24 | Independent review remains the conductor handoff. No agents launched without the OK required by rules/subagents.md; no peer consensus claimed. Harness review dossiers/recorder files are outside this two-file scope.
- [x] BRCI-R1-H1 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): derive P' and bootstrap-all selection from Docker registry lookups of packed versions; lookup failures are ERROR because unknown existence cannot safely select severity.
- [x] BRCI-R1-H2 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): keep the inventory as a required PR check without publisher needs; skip existing versions with WARN before candidate packing/strict checks, while every actual publication checks its own archive.
- [x] BRCI-R1-M3 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): BLOCK candidates at an existing registry version fail with "bump required" when packed runtime/peer/optional maps differ from that published artifact; dependency-only repairs must reach consumers.
- [x] BRCI-R1-M4 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): qualify PR candidates with guarded BLOCK sibling archives; report remaining confirmed unpublished siblings as pending-sibling-publish (non-blocking in PR, blocking after publication), never as a successful registry install.
- [x] BRCI-R1-L5 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): require dependency strings to be non-empty after trim before validRange; the positive allow-rule decides and npm aliases remain deliberately rejected.
- [x] BRCI-R1-L6 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): emit JSON file lists from a separate dorny step with only publishable_package_files; avoids multiplying file outputs across roughly 45 filters near the 1 MB job-output limit.
- [x] BRCI-R1-L7 | attention | Owner: conductor | Branch: current | 2026-09-24 | conductor decision (reversible): use a dedicated manifest_guard filter for scripts/ci, never global; the new job runs via always() without causing full API/UI/E2E builds on guard edits.
- [x] BRCI-R1-L8 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | conductor decision (reversible): wire cluster-mesh, llm-mesh, and llm-gateway lint independently only after each passes on base; baseline failures become out-of-scope debt, unwired and unfixed here. Baseline lint is NOT RUN in SPEC.
- [x] BRCI-EX1 | applied | Owner: BUILD | Branch: current | 2026-09-24 | `Makefile`: root lint pattern, real pack/shared guard, strict tarball publication, inventory/test/qualification targets. Impact: dry-run packs become real archives; every npm lane invokes the guard. Rollback: revert these hunks together with EX2; published versions stay immutable.
- [x] BRCI-EX2 | applied | Owner: BUILD | Branch: current | 2026-09-24 | `.github/workflows/ci.yml`: classification outputs, always-scheduled guard, validation context, baseline-qualified lint, install smoke steps, N1 sibling ordering. Impact: new required PR check; unchanged publisher needs on the global guard. Rollback: revert with EX1; conductor removes the required status first.
- [x] BRCI-EX3 | applied | Owner: BUILD | Branch: current | 2026-09-24 | `scripts/ci/publishable-manifests.mjs`, `scripts/ci/check-publishable-manifests.sh`, `scripts/ci/qualify-published-install.mjs`, five `scripts/ci/*.test.mjs`. Impact: new tooling only; no package graph or lockfile change. Rollback: remove after reverting Make/CI callers.
- [x] BRCI-EX4 | applied | Owner: BUILD | Branch: current | 2026-09-24 | `rules/workflow.md` Package Publication section only: D1, npm workspace semantics, exact-artifact guard, consumer qualification. Rollback: revert the added paragraph with the tooling rollback.
- [x] BRCI-B1 | attention | Owner: conductor | Branch: current | 2026-09-24 | Add `validate-publishable-manifests` to required PR checks after its first successful CI run (YAML cannot change branch protection).
- [x] BRCI-B2 | deferred | Owner: conductor | Branch: first real CI publication | 2026-09-24 | BRCI-R1-L9 checkpoint stays pending: tarball publication provenance/publishConfig evidence only from the first normal CI publication; `package-llm-routing-candidates` guard line NOT RUN locally (needs `tmp/llm-gateway-qualification`).
- [x] BRCI-B3 | attention | Owner: unassigned | Branch: cowork remediation | 2026-09-24 | `@sentropic/cowork-desktop@0.2.0` `file:` dependencies remain WARN debt; standalone `make pack-cowork-desktop` now fails (BLOCK default) while CI validation passes context and WARNs.
- [ ] BRCI-F1-N1 | deferred | Owner: conductor | Branch: follow-up | 2026-09-25 | A `skipped` upstream publisher can mask a failed validate in the N1 ordering (ci.yml publish-mcp-auth / publish-cluster-mesh conditions); possible fix: add the sibling `validate-*` jobs to `needs` and require their result is not failure. Documented only, no code.
- [ ] BRCI-F1-N2 | deferred | Owner: conductor | Branch: follow-up | 2026-09-25 | More network before the existing-version skip (MANIFEST_GUARD_TOOLS semver install + lifecycle-free snapshot pack) than the former `npm view`; a registry outage now fails earlier. Documented only, no code.
- [x] BRCI-F1-D1 | attention | Owner: conductor | Branch: current | 2026-09-25 | conductor decision (BRCI-EX2): root `package.json`/`package-lock.json` removed from all 23 `*_publish` filters; a lockfile-only main push attempted auth-hono 0.15.2 and build-cli 0.3.0 (ENEEDAUTH). Validation filters unchanged.
- [x] BRCI-F2-A1 | attention | Owner: conductor | Branch: current | 2026-09-25 | conductor decision (reversible): HTTP 408 (Request Timeout) is retried as transient alongside 429/5xx, matching the `HTTP 408` classifier entry; every other non-404 4xx is permanent.
- [x] BRCI-R1-L9 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | conductor decision (reversible): verify tarball publication preserves provenance and publishConfig on the first real CI publication; no manual/test publication and no evidence claimed from an existing-version skip.

## AI Flaky tests
- [x] Not applicable: documentation-only; no AI or runtime tests are executed or waived.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author; no integration, cherry-pick, or delegated writes.
- [x] Multi-branch implementation planning is owned by the conductor after SPEC review.

## UAT Management (in orchestration context)
- [x] Web, Chrome, VSCode UAT: not applicable to this design-only lot.
- [x] Consumer acceptance: specify published mcp-auth `0.2.1` and cluster-mesh `0.11.0` replays and evidence fields for BUILD; actual replays remain NOT RUN in SPEC.

## Plan / Todo (lot-based)
- [x] **Lot G0 — Baseline and rule**
  - [x] Read mandatory rules, template, root workspace declaration, Makefile recipes, and CI publication structure; mechanical branch check passes.
  - [x] Create this scoped branch plan first.
  - [x] Document npm root cause, strict dependency rule, packed-artifact boundary, and placement recommendation in the new spec.
- [x] **Lot G1 — Exact BUILD contract**
  - [x] Specify root lint target, guard targets, CI jobs/steps, classification algorithm, and forbidden-spec regex.
  - [x] Specify clean install isolation, entry point imports, published/tarball inputs, and failure reporting.
- [x] **Lot G2 — Acceptance and handoff**
  - [x] List file-level BUILD tests, exception requests, rollout sequence, known offenders, and unresolved owner decisions.
  - [x] Consolidate the standalone EVOL spec and author-review all requirements against repository evidence, including dorny v4 rename handling; independent review remains A6.
  - [x] Run `make scope-check ENV=test-ci-manifest-guard` before each commit; inspect staged diff; commit only the two allowed files.
  - [x] `make check-ci-version-filters ENV=test-ci-manifest-guard` passes; branch check and Git whitespace checks pass.
  - [x] `make down API_PORT=9435 UI_PORT=5635 MAILDEV_UI_PORT=1535 ENV=test-ci-manifest-guard` passes.
  - [x] `make ps API_PORT=9435 UI_PORT=5635 MAILDEV_UI_PORT=1535 ENV=test-ci-manifest-guard` passes with no services; Compose reports only an unset DISABLE_RATE_LIMIT warning.
  - [x] Handoff includes exact checks, explicit NOT RUN install replays, final scope verification, and `git log --oneline origin/main..HEAD`.
- [x] **Lot G-R1 — Design review revisions**
  - [x] HIGH: correct root-lock/bootstrap classification, registry failure semantics, publisher independence, and skip ordering in the spec; update A5 and acceptance cases.
  - [x] MEDIUM: specify dependency-map bump enforcement and same-PR sibling archive qualification, including fixtures and report evidence.
  - [x] LOW: tighten trimmed ranges, isolate file-list/filter outputs, gate all three lint jobs on baseline evidence, and require first-CI publication compatibility evidence.
  - [x] Review all nine findings and updated acceptance cases; only the two allowed files changed, with no BUILD exceptions activated.
  - [x] `make scope-check ENV=test-ci-manifest-guard` passes before each group commit; `make check-ci-version-filters ENV=test-ci-manifest-guard` passes; mechanical branch and Git whitespace checks pass.
  - [x] `make down API_PORT=9435 UI_PORT=5635 MAILDEV_UI_PORT=1535 ENV=test-ci-manifest-guard` and `make ps API_PORT=9435 UI_PORT=5635 MAILDEV_UI_PORT=1535 ENV=test-ci-manifest-guard` pass; no services remain, with only the unset DISABLE_RATE_LIMIT warning.
  - [x] Baseline lint, new guard fixtures, install replays, and real CI provenance/publishConfig verification remain NOT RUN in SPEC; conductor owns BUILD evidence and independent review.
- [x] **Lot G-B0 — BUILD baseline and lint gate**
  - [x] Merge `origin/main` (`28bfcf9f5`) without conflicts; record BRCI-EX1..EX4 before touching their paths.
  - [x] Add `lint-cluster-mesh` to the root static lint pattern (tooling delta only: `-w packages/llm-$*` became `-w packages/$*`).
  - [x] Baseline lint on base `28bfcf9f5` sources (node:24-bookworm-slim, npm 11.19.0, eslint 10.0.2, typescript-eslint 8.56.1): `make lint-cluster-mesh|lint-llm-mesh|lint-llm-gateway API_PORT=9440 UI_PORT=5640 MAILDEV_UI_PORT=1540 ENV=test-ci-manifest-guard` all exit 0; all three are wired, no lint debt recorded.
- [x] **Lot G-B1 — Shared guard and fixtures**
  - [x] `scripts/ci/publishable-manifests.mjs`: D1 rule, archive reader, classifier, registry lookups, bump gate, pack/publish/inventory CLI.
  - [x] `scripts/ci/check-publishable-manifests.sh` host orchestration; Make targets `check-publishable-manifest`, `pack-publishable-manifest`, `check-publishable-manifests`, `test-publishable-manifests`.
  - [x] Fixture tests: `publishable-manifests`, `publishable-classification`, `publishable-pack` test files pass.
- [x] **Lot G-B2 — Consumer qualification**
  - [x] `scripts/ci/qualify-published-install.mjs` plus `qualify-published-install` / `test-qualify-published-install` targets (no repo mount, fresh cache, no Python).
  - [x] `scripts/ci/qualify-published-install.test.mjs` passes (10 tests); same-PR sibling plan/pack/collect lane `pack-candidate-siblings` verified on a lockstep mcp-auth + oauth-verify context.
- [x] **Lot G-B3 — Pack and publish integration**
  - [x] All 23 `pack-<slug>` targets use the real-pack primitive; routing candidates guarded.
  - [x] All `publish-<slug>` / `-token` targets (46 recipes): packed identity, lookup, skip-before-candidate, strict check, publish exact tarball.
- [x] **Lot G-B4 — CI wiring and policy**
  - [x] ci.yml: separate list-files step, `manifest_guard` filter, new inventory job, pack context, qualification steps, N1 ordering, baseline-qualified lint.
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs` passes (9 tests); `rules/workflow.md` Package Publication updated; `make check-ci-version-filters` and `make check-e2e-inventory` pass.
- [x] **Lot G-B5 — Closure gates**
  - [x] `make qualify-published-install PKG=@sentropic/mcp-auth@0.2.1 PEERS=hono@4.10.7` PASS (root + `/hono`, integrity sha512-SZSTMWjc…, sha256 054a0e7e…); `PKG=@sentropic/cluster-mesh@0.11.0` PASS (root, sha256 59c73d85…); `PKG=@sentropic/llm-gateway@0.18.0` PASS (root, `/auth`, `/auth-hono`, sha256 5cb35819…); node:24-bookworm-slim, Node v24.21.0, npm 11.19.0.
  - [x] `make test-publishable-manifests test-qualify-published-install` (51 + 10 tests) PASS; `make typecheck-cluster-mesh test-cluster-mesh pack-cluster-mesh` PASS (279 tests; candidate sha256 equals published 0.11.0); `make check-ci-version-filters` PASS.
  - [x] `make check-publishable-manifests MANIFEST_CONTEXT_FILE=tmp/ci-manifest-guard/changes-context.json` PASS (24 public packages, BLOCK none, 4 cowork WARN); lockstep mcp-auth+oauth-verify context PASS; cowork-touched context FAILS as required.
  - [x] Lint gates re-run on branch head: `make lint-cluster-mesh|lint-llm-mesh|lint-llm-gateway` exit 0; `make scope-check` PASS; branch diff limited to Allowed Paths.
  - [x] `make down API_PORT=9440 UI_PORT=5640 MAILDEV_UI_PORT=1540 ENV=test-ci-manifest-guard` and `make ps` show no services.
- [x] **Lot G-F1 — Build fix round 1 (review findings)**
  - [x] Registry freshness: never cache 404/absent packuments, `lookup(..., { fresh: true })` with `cache: 'no-store'` in the post-publication wait and pre-publish recheck; snapshot failures are transient only for network/registry errors (fixtures added).
  - [x] Publication triggers: `*_publish` filters keep only `packages/<slug>/**`; post-publication qualification runs only on `status=published` (wiring fixtures added).
  - [x] Shell hardening: sibling directory rejects `..`; `publishable-sibling-plan` validates `PACKAGE` with the slug regex.
  - [x] Spec and `rules/workflow.md` Package Publication state the package-path-only publication trigger and its reason; follow-ups recorded.
  - [x] `make test-publishable-manifests` (55 tests) and `make test-qualify-published-install` (11 tests) PASS with `ENV=test-ci-manifest-guard`; `make check-ci-version-filters`, `make check-e2e-inventory`, `make scope-check` PASS.
- [x] **Lot G-F2 — Build fix round 2 (verified defect + review findings)**
  - [x] Sibling directory: strict `^tmp/<segment>(/<segment>)*$` check (no empty or dot-leading segment, `..` still rejected) before `rm -rf`; fixture runs the script in a throwaway cwd with a stub `make` and proves `tmp/`, `tmp/.`, `tmp//`, `tmp/./x`, `tmp/../x`, `/tmp/x`, `x` are rejected before any deletion.
  - [x] `publishable-sibling-plan` passes `PACKAGE`/`SIBLING_DIR` as container env and validates both inside a single-quoted script; post-publication qualification hard-fails on a missing or status-less receipt (no `:-missing` fallback).
  - [x] Registry request: 400/401/403 permanent, 408/429/5xx and exceptions transient; classifier adds `fetch failed`, `ERR_SOCKET_TIMEOUT`, `UND_ERR_*`, `HTTP 408`, `E429`, `E5xx`, drops `EPIPE`; re-run hint never duplicated; inventory failure message points to `classification.json`.
  - [x] `make test-publishable-manifests` (61 tests) and `make test-qualify-published-install` (11 tests) PASS with `ENV=test-ci-manifest-guard`; `make check-ci-version-filters`, `make scope-check` PASS.
