# Feature: Claude subscription seat LOT 2

## Objective
- [x] Implement approved D1–D5: browser enrollment, renewable paste, refresh and durable ordinary Claude seats; execution remains LOT 2.
- [x] Implement D6 mesh bridge to an injected official CLI runner; h2a owns subprocess qualification and release.

## Scope / Guardrails
- [x] LOT 2 mesh side on `spec/llm-mesh-claude-seat` in `/home/antoinefa/src/sentropic/tmp/llm-mesh-claude-seat`; LOT 1 frozen and cross-reviewed APPROVE.
- [x] English; fake credentials only; never read user credentials; no version bump, push, PR, merge or publication.
- [x] Use editing tools; selective staging and separate `make commit` calls; approximately 150 lines per commit.
- [x] Make commands end with `ENV=test-llm-mesh-claude-seat`; no host Node/npm/Python or direct Docker.
- [x] No services required; cleanup mapping: API `9395`, UI `5595`, Maildev UI `1495`.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md`
  - `packages/llm-mesh/src/transport/claude-code-runtime-client.ts`
  - `packages/llm-mesh/src/index.ts`
  - `packages/llm-mesh/tests/transport/**`
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
  - `packages/llm-mesh/src/service/**`
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
- [x] `CS-29` — acknowledge — owner: conductor — LOT 2 repeats the explicit no-bump exception; general package bump rule is deferred to the conductor's single release bump after qualification.
- [x] `CS-30` — attention — owner: implementer — Conservative capability profile requires source and qualification references; history/tools remain opt-in and unsupported controls fail before runner invocation. Host attestation is not independent proof.
- [x] `CS-31` — attention — owner: h2a lane — Public docs say bare mode skips OAuth and managed hooks survive ordinary disableAllHooks; refuse unqualified isolation instead of assuming flags disable all discovery.
- [x] `CS-32` — attention — owner: conductor — Preserve CS-17 scope: no Track/recorder artifacts or agent launches; independent implementation review and live qualification remain conductor-owned.
- [x] `CS-33` — attention — owner: implementer — Ten new regressions exposed unmatched/lossy tool histories and mutable schemas; validate complete call/result identity and copy JSON before deferred execution, preserving the conservative CLI subset.
- [x] `CS-34` — attention — owner: implementer — Reject malformed usage containers, unsafe totals and lossy tool-output JSON; focused regressions reproduced each acceptance gap before the fix.
- [x] `CS-35` — attention — owner: implementer — First full typecheck/build caught loss of TypeScript narrowing through the original toolResult path; project through the validated local result alias. Full tests 476/476 and lint passed before this type-only correction.
- [x] `CS-36` — attention — owner: implementer — Cluster setup reproduced EACCES on llm-mesh/node_modules/.vite; stat confirmed root:root 0755 from the test target. `make clean-node-modules ENV=test-llm-mesh-claude-seat` removes generated dependencies within this worktree before retrying the unchanged gate.
- [x] `CS-37` — attention — owner: h2a lane — Bind each runner to an owner/account lease acquired by the outer coordinator before grant acquisition. Tool capability additionally requires proving mesh-owned execution and replay-free continuation; auto-executed CLI tools do not qualify.
- [x] `CS-38` — attention — owner: conductor/release lane — Cluster gate skips 34 packaging cases; historical CS-21 exact-candidate lock qualification remains separate. No LOT 2 independent review or live CLI/custody qualification is claimed.

## Implementation plan (LOT 2 authorized)
- [x] Step A — source-grounded runner contract, exact proposed h2a tests and fake-only M5 counting probe recorded before runtime code.
- [x] Step B1 — runner interfaces, access projection and conservative request validation.
- [x] Tool-history integrity and schema snapshot regressions reproduced before tightening request projection.
  - [x] Define v1 runner/capability types and explicit access/request projections; no process/network imports.
- [x] Step B2 — generate/stream mapping, terminal validation, abort and sanitized failures.
  - [x] Implement non-seat delegation, seat stream/generate, terminal/usage/tool validation and cancellation without raw errors.
- [x] Step B3 — additive runtime/type exports and README host qualification/terms guidance.
- [x] Step B4 — `tests/transport/claude-code-runtime-client.test.ts`: projection, both seat shapes, other auth routing, unsupported requests, stream/generate/tools, abort, malformed/truncated events, canary errors and no network.
  - [x] Add fake-only projection and auth coexistence matrix with a forbidden-network guard.
  - [x] Add pre-run capability refusals and generate/stream/tool-result round-trip mapping with source-qualified fake profiles.
  - [x] Add failure canaries, terminal validation, usage filtering, pending-read/early-close abort and deferred-expiry checks.
- [x] Gates — `make test-llm-mesh`, `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make build-llm-mesh`, `make test-cluster-mesh`, `make scope-check`, all with `ENV=test-llm-mesh-claude-seat` last.
- [x] Cleanup — `make down` and `make ps` with dedicated compose project and ports 9395/5595/1495; final diff and commit log.

## LOT 2 validation and handoff
- [x] `make test-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS, 476 tests in 35 files, including 90 new transport cases; fake credentials only.
- [x] `make test-llm-mesh SCOPE=tests/transport/claude-code-runtime-client.test.ts ENV=test-llm-mesh-claude-seat`: PASS, 90/90 after the final type-only correction; tests import the public index.
- [x] `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS after fixing planned-account and tool-result narrowing; initial failures preserved in CS-35 and commit history.
- [x] `make lint-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
- [x] `make build-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS after the same narrowing fix; also rebuilt by the cluster gate.
- [x] `make test-cluster-mesh ENV=test-llm-mesh-claude-seat`: PASS, 394 tests, 34 packaging cases skipped (53 passing files, five skipped); CS-36 records the resolved setup failure.
- [x] `make scope-check ENV=test-llm-mesh-claude-seat`: PASS C2 before every commit; `harness check branch`: PASS C1; `git diff --check`: PASS.
- [x] `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat`: PASS.
- [x] `make ps COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat`: PASS, no services. No stack started.
- [x] Six allowed files changed since LOT 1 HEAD `11f893206`; all LOT 2 commits below 150 changed lines. No forbidden paths, version changes, real credentials, CLI execution, push, PR, merge or publication.
- [x] Read set: mandatory MASTER/workflow/subagents/testing/template; RTK and harness using/brainstorm/test/review/debug; project/branch context; D6/spec; installed h2a 0.97.9 and h2a-runtime 0.97.6 launch sources; public A6 docs.
- [x] Handoff: spec §2 records exact runner DTO/events, six proposed h2a tests, candidate invocation/isolation controls and fake-only M5 endpoint counters with positive controls. Unverified candidate behavior stays not-covered; no qualified runner is bundled.

## LOT 1 feedback history
- [x] `CS-28` — attention — owner: implementer — Fix round 2 uses one service-local public-write promise chain per account; preserve keyring/schema contracts, the no-bump exception and conductor-owned review/release.
- [x] `CS-27` — attention — owner: implementer — Full gate exposed the facade fixture reusing its browser grant as a second account; change the successful import to a distinct fake grant and explicitly assert facade duplicate refusal.
- [x] `CS-26` — attention — owner: implementer — Compare same-owner Claude refresh grants only in process under the existing enrollment persistence queue; enforce one account/refresh holder per grant without hashes, output, or a new schema. Cross-process grant ownership remains the documented single-service responsibility.
- [x] `CS-25` — attention — owner: implementer — Omitted refresh scope reuses persisted validated grant scopes, never the broader requested profile scopes; explicit invalid scope and scope-less initial enrollment still fail closed. Keep this capability Claude-local without changing shared contracts.
- [x] `CS-24` — attention — owner: implementer — Retry only proven pre-request failures; terminal profile errors and possible provider rotation remain fenced. Restore a preflight fence best-effort while retaining single-flight; if that rollback cannot be saved, a conservative durable fence can remain on restart.
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
- [x] Fix round 2 `make test-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS, 386 tests / 34 files / zero failures or skips; three added cases and the missing-token regression corrected from retryable to terminal.
- [x] Fix round 2 `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat`, `make lint-llm-mesh ENV=test-llm-mesh-claude-seat`, and `make build-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
- [x] Fix round 2 `make test-llm-mesh SCOPE=tests/service/local-account-transport-service-claude.test.ts ENV=test-llm-mesh-claude-seat`: final PASS, 37 tests. Each reported defect reproduced before its fix; the corrupt-envelope fixture checks acquisition after restart because listing reads public records independently of envelopes.
- [x] Fix round 2 cluster preparation: confirmed root-owned 0755 llm-mesh Vitest cache (CS-22); `make clean-node-modules ENV=test-llm-mesh-claude-seat` passed before the cluster gate.
- [x] Fix round 2 `make test-cluster-mesh ENV=test-llm-mesh-claude-seat`: PASS, 394 passed / 34 skipped; 53 files passed / 5 skipped; llm-surface 9/9. The gate skips packaging suites; CS-21 remains conductor-owned and was not rerun.
- [x] Fix round 2 `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` and identical `make ps` mapping: PASS, no services remain.
- [x] Fix round 2 `harness check branch`, `git diff --check 05fc06e89` and `make scope-check ENV=test-llm-mesh-claude-seat`: PASS. Four allowed files only; no exception, keyring edit, version bump, push, PR, merge or publication. Implementation commits change 19, 25 and 108 lines; the final evidence commit is docs-only.
- [x] Fix round 2: serialize fence, route, credential and restore public-record writes per account. The gated encrypted-file regression first reproduced active on disk during HTTP and credential save; 37 scoped service tests now pass, with reauth held until durable success.
- [x] Fix round 2: missing refresh material requires reauthentication; only profile resolver exceptions remain retryable provider preparation errors. Scoped Claude service suite: 34 passed; regression first reproduced retry-later instead of reauthentication.
- [x] Fix round 2: skip corrupt envelopes during duplicate-grant scans without diagnostics containing stored data. Invalid JSON and JSON null both reproduced blocked enrollment; 36 scoped service tests pass, including acquiring the new account after restart.
- [x] Fix round 2: run all six requested gates, review scope/diff, commit below 150 changed lines and clean up the dedicated environment. All three findings fixed; independent rereview and release remain conductor-owned.
- [x] Fix round 1: all six findings accepted after code verification; no disagreement. Changed files: `BRANCH.md`, `packages/llm-mesh/README.md`, `src/enrollment/claude-code.ts`, `src/service/local-account-transport-service.ts`, `tests/enrollment/claude-code.test.ts`, `tests/service/{facade,local-account-transport-service,local-account-transport-service-claude}.test.ts` under llm-mesh.
- [x] Fix round 1 full `make test-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS, 383 tests / 34 files / zero failures or skips; 21 new cases in this round. First run failed the now-corrected facade duplicate fixture (CS-27).
- [x] Fix round 1 `make typecheck-llm-mesh ENV=test-llm-mesh-claude-seat`, `make lint-llm-mesh ENV=test-llm-mesh-claude-seat`, and `make build-llm-mesh ENV=test-llm-mesh-claude-seat`: PASS.
- [x] Fix round 1 scoped tests: `make test-llm-mesh SCOPE=tests/service/local-account-transport-service-claude.test.ts ENV=test-llm-mesh-claude-seat` (33 before final additions), `SCOPE=tests/service/local-account-transport-service.test.ts` (20), `SCOPE=claude` (96), and `SCOPE=tests/service/facade.test.ts` (7): final runs PASS; same environment last for each command.
- [x] Fix round 1 cluster setup initially failed at `install-internal-packages` with EACCES on `packages/llm-mesh/node_modules/.vite`; `make clean-node-modules ENV=test-llm-mesh-claude-seat` passed and repaired generated artifacts (CS-22 recurrence).
- [x] Fix round 1 `make test-cluster-mesh ENV=test-llm-mesh-claude-seat`: PASS, 394 passed / 34 skipped, 53 files passed / 5 skipped; llm-surface 9/9. Packaging suites remain explicitly skipped by this gate (CS-21).
- [x] Fix round 1 `make down COMPOSE_PROJECT_NAME=test-llm-mesh-claude-seat API_PORT=9395 UI_PORT=5595 MAILDEV_UI_PORT=1495 ENV=test-llm-mesh-claude-seat` and identical `make ps` mapping: PASS, no services remain.
- [x] Fix round 1 `harness check branch` and `git diff --check`: PASS; eight allowed files, no scope exception, no version bump, push, PR or publication. CS-21 candidate packaging and independent rereview remain conductor-owned.
- [x] Read set: `rules/{MASTER,workflow,subagents,testing,architecture}.md`, `plan/BRANCH_TEMPLATE.md`, project/branch docs and Claude seat spec; harness using/debug/test and receiving-review guidance. No out-of-scope recorder or Track writes.
- [x] Finding 6 coverage added: service-level same-ID completion concurrency, retained session verifier/state cleared after completion/cancel, verifier absent from authorization URL, custom-profile offline import, and 65,535/65,536/65,537-byte UTF-8 boundaries. Existing implementation satisfies these cases.
- [x] Finding 5 verified: sequential/restored and concurrent duplicate imports succeeded before the fix; same-owner duplicates now receive the exact non-echoing refusal. Distinct grants, owner isolation and removal remain covered; README documents one grant/account/refresh holder.
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
