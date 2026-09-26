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
- [x] `CS-05` — attention — owner: conductor — Require a renewable JSON credential for paste; bare access tokens cannot establish refresh parity. See spec O1.
- [x] `CS-06` — attention — owner: conductor — Prefer one additive `0.22.x` patch under the owner's policy to preserve cluster-mesh 0.13 compatibility; no bump in this lot.
- [x] `CS-07` — attention — owner: custody lane — Custody-only rotation is a controlling design requirement, not implemented protection in the current local account service; qualify the separate resolver/job before enabling custody seats.
- [x] `CS-08` — attention — owner: conductor — Before the live mission, nominate isolated grants and one operator/refresh owner, then verify current wire profile and per-device revocation. See spec O2; no real credentials handled here.

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

## Validation Evidence
- [x] `harness check branch` — PASS C1; branch is `spec/llm-mesh-claude-seat`.
- [x] `make scope-check ENV=test-llm-mesh-claude-seat` — PASS C2 before each commit; its harness dependency builds in Docker.
- [x] `git diff --check` — PASS; final tracked diff contains only the two Allowed Paths.
- [x] `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS.
- [x] `make ps COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` — PASS, no services. Compose only warned about unset optional configuration; no service was started.
- [x] No functional tests, llm-mesh build, real-token handling, package bump, push, PR, merge, or publication; no scope exception.
