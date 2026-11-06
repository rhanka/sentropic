# Feature: artifacts 0.2.18 train — GitHub enrollment, bindings, forge and builds

## Objective
- [ ] Integrate the approved git-artifact wagons after artifacts 0.2.17, release artifacts 0.2.18 with one ordinary train PR, and keep the train open for subsequent wagons.

## Scope / Guardrails
- [x] Branch `train/artifacts-0.2.18`; isolated worktree `tmp/worktrees/train-artifacts-0218`.
- [x] Base exactly `origin/train/2026-11-06` at `30b808cf5b118ad9b91db6c651f74912cef1fad5`, carrying artifacts 0.2.17.
- [ ] After the dated train merges, rebase onto `origin/main` and recheck registry versions.
- [x] Make only; Docker commands through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh`, one slot per command.
- [x] Dedicated ports `API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 ENV=test-train-art0218`; ENV always last; tear down volumes after tests.
- [x] Wagons push branches and scoped checks; integration owns versions, locks, fixture pins, APP-P1 digest and L5 once per integrated release head.
- [x] One READY train PR to main; ordinary full CI and package-bump enforcement; no CI gate exception; no merge to main by this lane.
- [x] No skip markers, run reruns, Python, attribution trailers, secret output or live enrollment.
- [x] Selective staging and `make commit` only; newly authored commits stay below 150 changed lines; two-parent wagon merges retain existing history and immutable generated L5 snapshots retain exact bytes under BR0218-EX4.
- [x] G0 FROZEN v3 contract SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba` remains binding.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/forge/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/forge/**`
  - `packages/cluster-mesh/docs/github-app-enrollment.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (BR0218-EX1)
  - `api/package-lock.json` (BR0218-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**` (BR0218-EX2)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR0218-EX2)
  - `api/src/services/mcp/cluster-registry.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-registry.test.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-installed.test.ts` (BR0218-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR0218-EX4)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop
- [x] TRAIN-R1 — Missing worker-script CSP reproduced in four MIME vectors and Chromium 148; corrected application responses block external fetch/eval/Wasm while same-origin reads work. CSP 26/26 and content 79/79 PASS; safe mode and SVG/PDF sandbox preserved.
- [x] TRAIN-R2 — Bind JSON/form grants to the displayed scope version and reject missing/stale versions without granting a widened scope; regression 5/5 PASS after reproducing missing version binding.
- [x] TRAIN-R3 — Retain all core integration jobs and affected owners even when missing/unselected; broaden UI validation for API runtime changes under BR83-EX1. Two regression cases failed before the fix; consumer-contract fixtures 23/23 PASS.
- [x] TRAIN-R4 — Require existing UI build job identities and main-only deployment only on main; select IdP smoke for UI changes under BR83-EX1. Real-workflow UI/shared PR/main and API runtime cases pass; wiring fixtures 39/39 PASS.
- [x] BROJ-EX1 — #923 OAuth registration job workingDir only; reason: npm must run inside its package; impact: job startup; rollback: revert workingDir.
- [x] BR83-EX1 — #921 CI classifier/contracts/tuple dispatch; reason: prove omitted consumers unchanged; impact: CI selection/verdict; rollback: revert wagon workflow edits.
- [x] BR83-EX2 — #921 named Make entry points; reason: reproducible CI tooling gates; impact: tooling recipes; rollback: revert wagon recipes.
- [x] BR83-EX3 — #921 IdP tsconfig test include; reason: candidate-contract static coverage; impact: test inclusion; rollback: restore prior include.
- [x] BR83-EX4 — #921 inherited readiness-only E2E fix: focus row, require tabindex=0 within two seconds before click; reason: documented unregistered-row race; impact: one test; rollback: revert readiness lines. No timeout/retry increases.
- [x] BRTRAIN-EX1 — Retain #921 durable plan updates; reason: wagon traceability; impact: plan only; rollback: restore base plan.
- [x] BRTRAIN-EX2 — Refresh retained L5 P1 manifest/archives after committing integrated lock; reason: lock freshness; impact: generated evidence; rollback: restore prior artifact set with its lock.
- [ ] Track handoff: designated conductor imports this request, wagons, deliverables and acceptance receipts; this concurrent lane never appends `.track/events.jsonl`.

## AI Flaky tests
- [x] Deterministic failures block; provider exceptions require same-head evidence and explicit owner sign-off; none accepted here.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — Three wagons, one train integration, consolidated final review and one PR CI; conductor owns final merge.

## UAT Management (in orchestration context)
- [ ] Qualify safe/application mode and reader grants on the exact train head using scoped tests and full PR CI; retain SHA and receipts in the report.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read common/master/workflow/testing rules, steward evidence and wagon plans; isolated worktree and mechanical branch gate.
- [x] **Lot 1 — Integration**: merge #923, then #921, then #924; keep this single plan and preserve implementation changes.
- [x] **Lot 2 — Artifacts**: check published version below 0.2.17; regenerate root/API/selected locks, selected archive integrity, APP-P1 digest and L5 P1 once through Make.
- [x] **Lot 3 — Scoped gates**: publishable wiring/classification, compatibility, consumer contracts, installed tuple; artifacts CSP/handler/MIME, content-host application mode, reader-grant/registry and selected packaging tuple tests.
- [x] Local receipts: compatibility 18/18, consumer contracts 23/23, installed tuples 10/10, publishable wiring/classification 59/59; `make test-artifacts SCOPE=tests/content-` 79/79.
- [x] Scoped host receipts through `.tmp/train/integration.mk`: application wrapper 4/4; API registry/grant/consent 33/33; selected tuple/preparation 24 passed with three installed-fixture-only tests deferred to full CI.
- [x] Final archive after review remediation: SHA-256 `08df842f9873356e8d0c1ed834763df0bc1160544c73f4883e4446db67a763d8`; selected integrity re-pinned through Make. Root/API lock refresh, APP-P1 digest and L5 generation were not repeated.
- [x] Integration receipt: APP-P1 `0725ef3044cf06b04eaae5f407cc364e8c3c8ef570b6835b9aa0038fb556f34b`; L5 `e46814a6678a1bc2b9aedff17c64a2eab522689f250b040134f5de96ad7cbb5c`, packed graph 30 files/54 edges PASS.
- [ ] **Lot 4 — Review and CI**: consolidated final-diff review, mechanical scope/branch gates; push review-ready head, open one READY PR, watch attempt 1 and fix evidenced root causes.
- [ ] **Lot 5 — Handoff**: report `.tmp/rv/train-2026-11-06.md`; clean test volumes; leave train unmerged and wagons open for conductor.
