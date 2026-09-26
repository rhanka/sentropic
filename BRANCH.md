# Feature: Claude subscription seat design

## Objective
- [x] Specify browser enrollment, CLI credential paste, refresh, and runtime use of Claude subscription seats in `@sentropic/llm-mesh`.

## Scope / Guardrails
- [x] Planning only on `spec/llm-mesh-claude-seat` in `/home/antoinefa/src/sentropic/tmp/llm-mesh-claude-seat`; base `origin/main`.
- [x] English documentation only; no code, tests, package changes, credentials, push, PR, merge, or publication.
- [x] Use editing tools; selective staging and separate `make commit` calls; approximately 150 lines per commit.
- [x] Make commands end with `ENV=test-llm-mesh-claude-seat`; no host Node/npm/Python or direct Docker.
- [x] No services required; cleanup mapping: API `9395`, UI `5595`, Maildev UI `1495`.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
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
- [x] `CS-01` — attention — owner: conductor — Use existing seat contracts and custody rules; reversible design choices are recorded in the spec without interrupting the design lot.
- [x] `CS-02` — deferred — owner: conductor — Cross-review, implementation/build/tests (astra), live h2a mission, one llm-mesh bump and one h2a 0.97 bump belong to later lots per owner instruction; no consensus claimed here.
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
- [x] Not applicable: no tests or live provider calls in this design lot.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author, documentation only; no delegated agents or integration commits.
- [x] Rationale: one bounded design; independent cross-review follows in the conductor's later lot.

## UAT Management (in orchestration context)
- [x] No web, Chrome, or VSCode UAT surface changed; design the later h2a browser/paste/run/refresh mission in the spec.

## Plan / Todo (lot-based)
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

## Future implementation handoff (not authorized in this branch)
- [ ] **Implementation lot 1 — enrollment, refresh, persistence**: browser + renewable paste, provider, facade/service and completion type export, README Terms of use and shared single-flight fix; spec §5 tests include Cloud Code/Codex race regression, AcquireError canaries and README acceptance.
- [ ] **Implementation lot 2 — official CLI execution or `not-covered`**: injected subprocess bridge/h2a runner, access-only 0600 file in per-run 0700 config directory, mesh-only refresh, process isolation/cleanup; transport/auth/consumer tests in spec §5; keep `adapter-auth.ts` unchanged.
- [ ] **Acceptance/release across both lots**: conductor scopes h2a files and runs M0–M7 (M2 CDP/h-cond/profile provenance, M5 separate mesh/child refresh counts); one llm-mesh bump after both lots or after lot 1 if execution is `not-covered`, with enrollment-only README labeling. Custody and h2a release remain separate.

## Validation Evidence
- [x] Step A1: reconcile O5 and Muse M1–M6/minor corrections, additive export, baseline citation, isolated fix, lot 2 gates and mission evidence.
- [x] Round 1: all nine reviewer requests verified against code and accepted; spec is 250 lines, external evidence qualifications preserved; no disagreement or new consensus claim.
- [x] Round 2: 269-line spec; O1–O5 decided, official CLI execution design, README terms gate, two build lots and conditional single bump. A1/A4 and A2 credential reader/refresh guard re-inspected; H1 installed h2a launch evidence recorded, with live/candidate behavior unverified.
- [x] `harness check branch` — PASS C1; branch is `spec/llm-mesh-claude-seat`.
- [x] `make scope-check ENV=test-llm-mesh-claude-seat` — PASS C2 before each commit; its harness dependency builds in Docker.
- [x] `git diff --check` — PASS; final tracked diff contains only the two Allowed Paths.
- [x] `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS.
- [x] `make ps COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS, no services. Compose only warned about unset optional configuration; no service was started.
- [x] No functional tests, llm-mesh build, real-token handling, package bump, push, PR, merge, or publication; no scope exception.
