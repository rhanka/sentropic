# Feature: Claude subscription seat LOT 1

## Objective
- [x] Implement approved D1–D5: browser enrollment, renewable paste, refresh and durable ordinary Claude seats; execution remains LOT 2.

## Scope / Guardrails
- [x] LOT 1 only on `spec/llm-mesh-claude-seat` in `/home/antoinefa/src/sentropic/tmp/llm-mesh-claude-seat`; base `origin/main`.
- [x] English; fake credentials only; never read user credentials; no LOT 2 code, version bump, push, PR, merge or publication.
- [x] Use editing tools; selective staging and separate `make commit` calls; approximately 150 lines per commit.
- [x] Make commands end with `ENV=test-llm-mesh-claude-seat`; no host Node/npm/Python or direct Docker.
- [x] No services required; cleanup mapping: API `9395`, UI `5595`, Maildev UI `1495`.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md`
  - `packages/llm-mesh/src/enrollment/claude-code.ts`
  - `packages/llm-mesh/src/enrollment/index.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/enrollment/claude-code.test.ts`
  - `packages/llm-mesh/tests/enrollment/contracts.test.ts`
  - `packages/llm-mesh/tests/service/local-account-transport-service-claude.test.ts`
  - `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`
  - `packages/llm-mesh/tests/service/facade.test.ts`
  - `packages/llm-mesh/tests/auth.test.ts`
  - `packages/llm-mesh/README.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `packages/llm-mesh/src/enrollment/contracts.ts`
  - `packages/llm-mesh/src/enrollment/pkce.ts`
  - `packages/llm-mesh/src/enrollment/device-flow.ts`
  - `packages/llm-mesh/src/enrollment/cloud-code.ts`
  - `packages/llm-mesh/src/enrollment/codex.ts`
  - `packages/llm-mesh/src/enrollment/muse*.ts`
  - `packages/llm-mesh/src/auth.ts`
  - `packages/llm-mesh/src/adapter-auth.ts`
  - `packages/llm-mesh/src/catalog.ts`
  - `packages/llm-mesh/src/providers.ts`
  - `packages/llm-mesh/src/node/**`
  - `packages/llm-mesh/src/transport/**`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/package.json`
  - `apps/**`
  - `api/**`
  - `ui/**`
  - `docs/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
  - `package.json`
  - `package-lock.json`
- [x] **Conditional Paths**: none; every path outside Allowed Paths is forbidden.
- [x] **Exception process**: record `BR-CS-EXn` with rationale, impact, and rollback before requesting any irreversible scope expansion; none authorized.

## Feedback Loop
- [x] `CS-25` — attention — owner: implementer — Omitted refresh scope reuses persisted validated grant scopes, never the broader requested profile scopes; explicit invalid scope and scope-less initial enrollment still fail closed. Keep this capability Claude-local without changing shared contracts.
- [x] `CS-24` — attention — owner: implementer — Retry only proven pre-request failures; terminal profile errors and possible provider rotation remain fenced. Restore a preflight fence best-effort while retaining single-flight; a continuing storage outage can leave a conservative durable fence until storage recovers.
- [x] `CS-23` — attention — owner: implementer — Fix round 1 preserves the refresh fence against concurrent route persistence; reproduced active/cooldown overwrites. Keep the explicit no-bump and conductor-owned review/release scope (CS-16/17).
- [ ] `CS-21` — blocked — owner: conductor/release lane — Candidate packaging stops before types-and-bundlers: the selected lock's llm-mesh 0.22.0 integrity differs from candidate bytes. The required `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` update is forbidden here. Refresh that lock against the exact release candidate and rerun `test-lazy-package`; no bypass or consumer edit made.
- [x] `CS-22` — attention — owner: implementer — Cluster setup initially failed on root-owned llm-mesh Vitest cache; `make clean-node-modules ENV=test-llm-mesh-claude-seat` repaired generated artifacts and the unchanged full cluster gate passed.
- [x] `CS-20` — attention — owner: implementer — Conservatively discard descriptive identity fields and reject scopes outside the selected profile; retain actual accepted scopes. Non-JSON HTTP failures expose status plus static invalid_response only.
- [x] `CS-19` — attention — owner: implementer — A reproduced post-rotation storage outage replayed the old grant after restart; persist existing reauth status before refresh and clear it only with the fresh durable save, preserving the schema.
- [x] `CS-16` — acknowledge — owner: conductor — Explicit LOT 1 no-bump instruction overrides the general bump rule; conductor owns release/version qualification.
- [x] `CS-17` — attention — owner: implementer — Apply harness plan/debug/test within allowed files; no recorder/Track artifacts outside scope; independent review remains conductor-owned.
- [x] `CS-18` — attention — owner: implementer — Fail closed on ambiguous rotation/save failures; use an offline strict profile and bounded 30-second token requests with no retries.
- [x] `CS-01` — attention — owner: conductor — Use existing seat contracts and custody rules; reversible design choices are recorded in the spec without interrupting the design lot.
- [x] `CS-02` — acknowledge — owner: conductor — LOT 1 implementation/build/tests now executed below; independent review, live h2a mission, llm-mesh bump and h2a 0.97 bump remain conductor-owned.
- [x] `CS-03` — attention — owner: design author — Apply harness brainstorm/plan structure within the two allowed files; omit recorder/Track writes because their artifacts are outside this lot's allowed paths.
- [x] `CS-04` — attention — owner: conductor — Prefer browser PKCE with manual code return: verified Claude behavior, shared PKCE reuse, no loopback helper change.
- [x] `CS-05` — acknowledge — owner: conductor, 2026-09-26 — O1 decided: renewable JSON only; no access-only paste in this lot.
- [x] `CS-06` — attention — owner: conductor — Prefer one additive `0.22.x` patch under the owner's policy to preserve cluster-mesh 0.13 compatibility; no bump in this lot.
- [x] `CS-07` — attention — owner: custody lane — Custody-only rotation is a controlling design requirement, not implemented protection in the current local account service; qualify the separate resolver/job before enabling custody seats.
- [x] `CS-08` — acknowledge — owner: conductor, 2026-09-26 — O2 decided: conductor drives owner's Chrome/CDP 9222, h-cond verifies, operator returns code through trusted masked input outside transcripts; one refresh holder per grant. CDP capture risk is explicit in M2.
- [x] `CS-09` — attention — owner: design author — Round 1 uses sessionless paste, internal provider capabilities, offline labels, and strict versioned config; these preserve the existing contracts and avoid an unverified profile request.
- [x] `CS-10` — acknowledge — owner: conductor, 2026-09-26 — O3 decided: versioned/configurable profile with M2 evidence; O4 decided NOT pursued: no impersonation, official CLI subprocess or execution `not-covered`.
- [x] `CS-11` — acknowledge — owner: conductor, 2026-09-26 — O5 decided: accept expired renewable JSON, import offline, refresh on first acquire and persist before use.
- [x] `CS-12` — attention — owner: implementer — Widen refresh single-flight as a shared bug fix with Cloud Code/Codex regression tests; native Muse dispatch is separately reported and remains outside scope.
- [x] `CS-13` — acknowledge — owner: conductor, 2026-09-26 — Continue feasibility work; enrolling users own terms compliance and risk suspension/refused calls. Sourced README Terms of use is a lot 1 acceptance gate.
- [x] `CS-14` — attention — owner: implementer — Prefer a per-run access-only credential file and mesh-only refresh: A2's missing-refresh-token guard avoids a competing CLI rotation/write-back protocol; candidate acceptance remains unverified, failure means execution `not-covered`.
- [x] `CS-15` — attention — owner: conductor — Linux-first isolated subprocess runner is supplied by h2a through the existing Anthropic adapter slot; qualify CLI version, code capture, tool isolation, cleanup and zero child refresh before claiming execution. One llm-mesh bump after both lots, or after lot 1 when execution is `not-covered`.

## AI Flaky tests
- [x] No AI-flaky allowance: deterministic injected-fetch/clock tests only; no live provider calls.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one implementer; no delegated agents or integration commits.
- [x] Rationale: approved design and one bounded implementation lot; independent review follows with conductor.

## UAT Management (in orchestration context)
- [x] No web, Chrome, or VSCode UAT surface changed; design the later h2a browser/paste/run/refresh mission in the spec.

## Completed design plan (history)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read mandatory rules, branch template, project context, and harness workflow.
  - [x] Verify branch with `git branch --show-current` and `harness check branch` (PASS C1).
  - [x] Establish path boundaries, environment mapping, and Make targets before writing the spec.
- [x] **Lot 1 — Evidence and current state**
  - [x] Read enrollment, auth, transport, catalog, custody/service/node layers and enrollment tests; capture file:line evidence.
  - [x] Verify Anthropic facts using public documentation and the public Claude Code package; label unverifiable details.
  - [x] Commit current-state and external-source findings after `make scope-check`.
- [x] **Lot 2 — Minimal design and security**
  - [x] Specify browser PKCE first, credential paste second, and refresh ownership third.
  - [x] List exact future files/public additions and justify compatible version policy; specify token safety and revocation limits.
  - [x] Commit design and security after `make scope-check`.
- [x] **Lot 3 — Validation plan and handoff**
  - [x] List future unit/integration test files and h2a mission steps/evidence; no test execution in this lot.
  - [x] Record only real owner decisions with recommendations; reconcile every deliverable section and evidence reference.
  - [x] Run final scope check, inspect complete diff, commit, clean up the dedicated environment, and report final commit log.
- [x] **Lot 4 — Review revision round 1 (planning only)**
  - [x] Verify claims in contracts, Muse facades, service refresh/persistence, provider config, app constants, runtime clients, exports, and consumer tests.
  - [x] Reduce Claude API, keep provider internal, define refresh config resolution/offline labels, correct citations, and document the shared refresh race.
  - [x] Split future implementation lots, preserve auth validation, add O3–O5, and strengthen regression/mission evidence.
  - [x] Complete the two-file revision and diff review; clean up the dedicated environment; prepare the checked scope/commit handoff with O1–O5 and review disposition.
- [x] **Lot 5 — Owner decisions, revision round 2 (planning only)**
  - [x] Close O1–O5, source Terms of use and require README text in the change set/acceptance gates; specify conductor/CDP/h-cond mission ownership and code secrecy.
  - [x] Replace D6 with source-grounded official CLI subprocess execution, single refresh ownership, isolation and `not-covered` fallback; reconcile lot split and release gates.
  - [x] Review final two-file diff and 269-line spec; complete cleanup and prepare the required scope/commit gate without push, with remaining evidence requirements recorded.

## Implementation plan (LOT 1 authorized)
- [x] Step A — docs-only approval corrections and implementation scope conversion.
- [ ] **Implementation lot 1 — enrollment, refresh, persistence**
  - [x] Isolated shared refresh fix with Cloud Code/Codex save-window/failure regressions and existing removal coverage; reproduced premature publication before fix.
  - [x] Versioned Claude profile validation/resolution and renewable paste parsing in `src/enrollment/claude-code.ts`.
    - [x] A2 bundle and fail-closed enrollment/exact-version refresh profile resolver.
  - [x] PKCE/manual completion, one-use cancellation/TTL/timeout and JSON refresh in the Claude provider.
    - [x] Bounded JSON grant wire, strict rotation validation and offline allowlisted metadata.
  - [x] Claude provider validation/configuration/grant/error tests in `tests/enrollment/claude-code.test.ts`.
    - [x] Browser wire/PKCE/replay and offline import/O5/allowlist/UTF-8 validation tests added.
    - [x] State/TTL/cancel/concurrent completion/timeout, malformed grants, rotation and secret-error tests added.
  - [x] Owner-bound sessions and common durable completion helper in `src/service/local-account-transport-service.ts`.
    - [x] Serialized Claude persistence with pending-account exclusion, rollback tombstones and persisted refresh scopes.
  - [x] Optional facade methods/configuration and additive completion type export.
  - [x] Claude service persistence/restore/concurrency/removal/canary tests in `tests/service/local-account-transport-service-claude.test.ts`.
    - [x] Real-provider browser/paste restore, owner isolation, concurrent distinct IDs and first-acquire refresh tests added.
    - [x] Partial writes, pending durability, cancellation/expiry/removal and AcquireError canary regressions added.
  - [x] Facade, enrollment contracts and unchanged auth regressions in their named test files.
  - [x] README configuration, trusted secret boundary, renewable import and sourced Terms of use.
  - [x] Full `make test-llm-mesh ENV=test-llm-mesh-claude-seat`: 354 passed, 34 files, zero failures/skips.
  - [x] `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
  - [x] `make lint-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
  - [x] `make build-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
  - [x] `make test-cluster-mesh ENV=test-llm-mesh-claude-seat`: 394 passed / 34 skipped; 53 files passed / 5 skipped; llm-surface 9/9 passed.
  - [ ] `make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-llm-mesh-claude-seat`: FAIL at frozen-lock integrity; 16 types-and-bundlers cases not executed (CS-21).
  - [x] Scope/diff review and dedicated environment cleanup; final commit/gate/risk handoff with CS-21 outstanding, no push.
- [ ] **Implementation lot 2 — official CLI execution or `not-covered`**: injected subprocess bridge/h2a runner, access-only 0600 file in per-run 0700 config directory, mesh-only refresh, process isolation/cleanup; transport/auth/consumer tests in spec §5; keep `adapter-auth.ts` unchanged.
- [ ] **Acceptance/release across both lots**: conductor scopes h2a files and runs M0–M7 (M2 CDP/h-cond/profile provenance, M5 separate mesh/child refresh counts); one llm-mesh bump after both lots or after lot 1 if execution is `not-covered`, with enrollment-only README labeling. Custody and h2a release remain separate.

## Validation Evidence
- [x] Finding 4 verified: omitted refresh scope reproduced reauth; provider tests distinguish omission from invalid values, and service tests preserve the previous scopes through two refreshes across restarts.
- [x] Finding 3 verified: five local-failure cases and refresh-time removal reproduced incorrect reauth errors; distinguish retryable preparation, terminal/ambiguous failures, and removed accounts without reflecting secret-bearing causes.
- [x] Finding 2 verified: real Muse provider schema 1-to-2 refresh failed before the fix; exact profile-version enforcement is now Claude-only, with durable schema update/restart coverage in the allowed shared service test file.
- [x] Fix round 1 baseline: branch check PASS C1, clean worktree at `110231cc3`, and `origin/main` is an ancestor of HEAD.
- [x] Finding 1 verified: paused refresh plus route failure/cooldown overwrote the fence before the fix; both regressions now require durable reauth and one provider call across restart.
- [x] Supplemental `make qualify-published-install TARBALL=tmp/ci-manifest-guard/siblings/cluster-mesh/llm-mesh/sentropic-llm-mesh-0.22.0.tgz REPORT_DIR=tmp/claude-seat-qualification ENV=test-llm-mesh-claude-seat`: PASS, 6 import probes (core plus all 5 public entry points); does not replace the blocked types-and-bundlers gate.
- [x] Final `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` and identical `make ps` mapping: PASS, no services. `harness check branch` PASS C1; `git diff --check` PASS.
- [x] LOT 1 full gates: llm-mesh 354/354 in 34 files; typecheck/lint/build PASS. Includes Claude provider 53, Claude service 23, shared service 19, facade 7, contracts 4 and auth 13 cases.
- [x] README reviewed for feasibility, individual responsibility, suspension/refused-call risk and the exact legal-and-compliance source link; explicitly enrollment-only.
- [x] Candidate pack guard PASS: llm-mesh 0.22.0 at source commit `7cc4c3ab8a0ef00f0b49bc6dcb62fda728129b7e`, SHA-256 `7b6bc06bd9abdd51c4ed8a1bd0377fe55ca6898755c0c4422ce7ff7cab01a8c2`; receipt in ignored `tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json`. Candidate selection uses the changed llm-mesh path in `CI_MANIFEST_CONTEXT`; first attempt supplied arrays instead of encoded CI string outputs and was corrected.
- [x] Candidate packaging integrity evidence: selected lock `sha512-YVFfN3/+so6MXDxoYoSXg8Xyelp4T5iKnlbgn8ZKukCtSLOHcBWUjN7SnCMY5Di/vMdr8hZUj4caM30Htq0mvw==`; candidate `sha512-JU9YZyhskJvZ4GREgeDvDQwr+At9+K5BF/t0kJ89WURt6gGFnUD0VUnTkvoZ2mGKQNY4XW1qzMlJHQmQoO2tgg==`. No packed-consumer pass claimed.
- [x] Scope reviewed against starting commit `059850fc2`: only 13 allowed files; no version/contracts/auth/provider/catalog/keyring/runtime-export/consumer changes. New commits are below 150 changed lines each. Origin/main has advanced with GPT-6 changes; this branch was not rebased.
- [x] Added explicit Cloud Code/Codex regression for the post-response removal-check window, alongside durable-save publication regressions.
- [x] Storage-outage regression first reproduced two refresh calls; preflight durable reauth fencing addresses D5's no-replay requirement without a migration.
- [x] Step A2: executable LOT 1 plan, exact allowed files/tests, no-bump decision and environment mapping recorded.
- [x] Step A1: reconcile O5 and Muse M1–M6/minor corrections, additive export, baseline citation, isolated fix, lot 2 gates and mission evidence.
- [x] Round 1: all nine reviewer requests verified against code and accepted; spec is 250 lines, external evidence qualifications preserved; no disagreement or new consensus claim.
- [x] Round 2: 269-line spec; O1–O5 decided, official CLI execution design, README terms gate, two build lots and conditional single bump. A1/A4 and A2 credential reader/refresh guard re-inspected; H1 installed h2a launch evidence recorded, with live/candidate behavior unverified.
- [x] `harness check branch` — PASS C1; branch is `spec/llm-mesh-claude-seat`.
- [x] `make scope-check ENV=test-llm-mesh-claude-seat` — PASS C2 before each commit; its harness dependency builds in Docker.
- [x] `git diff --check` — PASS; final tracked diff contains only the two Allowed Paths.
- [x] `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS.
- [x] `make ps COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS, no services. Compose only warned about unset optional configuration; no service was started.
- [x] Design-phase history only: no functional tests/builds were run then. This implementation uses no real-token handling, package bump, push, PR, merge or publication; no scope exception.
