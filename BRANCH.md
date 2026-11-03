# Feature: seat onboarding state in seat bundles (llm-mesh L1–L5)

## Objective
Implement design r3 (`.tmp/seat-onboarding/design-r3.md`, sha256 92685945…) lots L1–L5 in `@sentropic/llm-mesh`: the `SeatOnboardingV1` sibling block, its validators and launch gate, agy capture, two-stage materialization and erasure, claude/muse/codex projections with the Q2-limited trust write, and the stored seat record + facade export. Owner answers (`.tmp/seat-onboarding/owner-answers.md`): Q1 = one owner yes for ALL agy seats (global-consent variant, still version/shape-pinned and fail-closed); Q2 = trust write allowed for claude, muse and codex ONLY for the bench-created empty directory. L6 (cyber carriage) and L7 (h2a vendor/bench) are out of scope.

## Scope / Guardrails
- Scope limited to `packages/llm-mesh` (src, tests, package.json, CHANGELOG.md) plus root `package-lock.json` (llm-mesh-related entries only), `packages/llm-gateway/package.json` and `packages/cluster-mesh/package.json` (peer/dependency range widening only, see SEATONB-EX2), and `BRANCH.md`.
- Make-only workflow; the single Docker lock `.tmp/packets/DOCKER-LOCK.md` is taken PER COMMAND via `flock`.
- Branch development in isolated worktree `tmp/worktrees/seat-onboarding` (branch `feat/seat-onboarding` from `origin/main`).
- `ENV=test-seat-onboarding` always LAST argument of every `make` command; never `ENV=dev`; `make down ENV=test-seat-onboarding` after test runs.
- Tests written first per lot, then `make` targets only; scoped `make test-llm-mesh SCOPE=...` during evolution, full `make test-llm-mesh` per lot gate.
- Commits via `make commit MSG="..."` only, specific `git add` per commit, ≤150 lines per commit, push after each commit (crash safety). No `[skip ci]`.
- All new text in English. Synthetic fixtures only — no real seat secrets are read, printed or copied.
- Keyring read fix (`src/node/keyring/encrypted-file-keyring.ts` + its test) is owned by PR #887 (`fix/llm-mesh-keyring-readonly`, target 0.32.4): NOT duplicated here. At L5, if #887 is merged, rebase onto `origin/main`; otherwise rebase onto the #887 head so the fix arrives via its commits.
- Version bump: `@sentropic/llm-mesh` 0.32.4 → 0.33.0 (next minor; > published 0.32.4), with `make lock-root` (llm-mesh lock entry + the two widened ranges only), CHANGELOG entry, and `tests/decision-public-surface.test.ts` fixture update. The 0.33.0 minor crosses the declared caps (`cluster-mesh` peer `<0.33.0`, `llm-gateway` dep top `^0.32.0`); both are widened in this branch per SEATONB-EX2, following precedent 41711507e.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/enrollment/seat-onboarding.ts`
  - `packages/llm-mesh/src/enrollment/seat-onboarding-projections.ts`
  - `packages/llm-mesh/src/enrollment/index.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-capture.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-materialize.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-types.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-stage1.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-stage2.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-record.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-cell-compose.ts`
  - `packages/llm-mesh/src/node/seat-onboarding-erase.ts`
  - `packages/llm-mesh/src/node/seat-stage-write.ts`
  - `packages/llm-mesh/src/global.d.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/enrollment/seat-onboarding.test.ts`
  - `packages/llm-mesh/tests/enrollment/seat-onboarding-projections.test.ts`
  - `packages/llm-mesh/tests/enrollment/seat-onboarding-testkit.ts`
  - `packages/llm-mesh/tests/node/seat-onboarding-capture.test.ts`
  - `packages/llm-mesh/tests/node/seat-onboarding-materialize.test.ts`
  - `packages/llm-mesh/tests/service/seat-onboarding-import-export.test.ts`
  - `packages/llm-mesh/tests/service/facade.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-gateway/package.json` (dependency range only — SEATONB-EX2)
  - `packages/cluster-mesh/package.json` (peer range only — SEATONB-EX2)
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `scripts/**`, `deploy/**`, `docs/**`
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts` and `packages/llm-mesh/tests/node/encrypted-file-keyring.test.ts` (owned by PR #887 — see Conditional Paths)
- **Conditional Paths (allowed only with explicit exception)**:
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts` + `packages/llm-mesh/tests/node/encrypted-file-keyring.test.ts`: only via rebase onto the PR #887 branch (merged into main, or its head while open); never edited directly in this branch. Exception `SEATONB-EX1`: L5's keyring read fix ships through #887 per the packet; this branch only consumes it.
- **Exception process**:
  - Declare exception ID in `## Feedback Loop` before touching any conditional/forbidden path, with reason, impact, rollback.

## Feedback Loop
- [x] SEATONB-EX1: keyring read-only fix consumed from PR #887 via rebase, not duplicated. PR #887 MERGED into origin/main (0.32.4); branch rebased onto origin/main `5b1d1dcd2` (2026-11-02 continuation); keyring files never edited directly in this branch. L5T keyring cases run against #887's implementation.
- [x] SEATONB-EX2: mesh minor 0.33.0 crosses the declared consumer caps — `packages/cluster-mesh/package.json` peerDependencies `"@sentropic/llm-mesh": "0.19.2 || >=0.22.0 <0.33.0"` and `packages/llm-gateway/package.json` dependencies top `^0.32.0`. Widened to `<0.34.0` and `|| ^0.33.0` respectively (package.json only, no src changes, so `enforce-package-bump` does not require their version bumps). Required by the repo's own release invariant `packages/llm-mesh/tests/node/mesh-release-invariants.test.ts` (R6-1: mesh version must sit inside the gateway declared range) and by `make lock-root` (ERESOLVE otherwise). Precedent: 41711507e ("fix: align gateway and cluster compatibility with mesh 0.32"). Impact: root `package-lock.json` gains exactly three changed lines (llm-mesh version + the two ranges); unrelated lock drift (mcp-platform/artifacts) produced by `make lock-root` was reverted to keep the diff in scope. Rollback: revert the two range lines and drop the 0.33.0 bump.
- [ ] none so far

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single package, one PR with one commit series per lot)
- [ ] **Multi-branch**
- Rationale: one package, one design, sequential lots L1→L5 with tests per lot; no sub-workstreams. L6/L7 belong to other lanes.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/worktrees/seat-onboarding` created, branch `feat/seat-onboarding` from `origin/main` (bd7269816).
  - [x] `.env` copied from root; `BRANCH.md` written from `plan/BRANCH_TEMPLATE.md`.
  - [x] Read: `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, design r3, owner answers, llm-mesh sources (seat-bundle, cli-seat-import, agy-cli-import, facade, local-account-transport-service, keyring, marker), bench envelope shape (`scripts/xcli-seat-import.mjs`, `xcli-seat-provision.mjs`, `xcli-lab.mjs` LOGIN_ALLOWLIST).
  - [x] PR #887 checked: OPEN at branch creation, head a7ff2bf99df592d3694d0ee269d79fdd1c78c4af, target 0.32.4; MERGED before the 02/11 continuation — branch rebased onto origin/main (see SEATONB-EX1).
  - [x] Targets confirmed: `make test-llm-mesh [SCOPE=]`, `make typecheck-llm-mesh`, `make build-llm-mesh`, `make lint-llm-mesh`, `make lock-root`, `make scope-check`, `make commit MSG=`, `make down`, all with `ENV=test-seat-onboarding` last, under `flock .tmp/packets/DOCKER-LOCK.md` per command.
  - [x] CI triggers on `push: main` + `pull_request` only → branch pushes are crash-safety copies; one PR opened at the end for one CI run.

- [x] **Lot 1 — Contract and validators (L1) + L1T**
  - [ ] Write `packages/llm-mesh/tests/enrollment/seat-onboarding.test.ts` first (synthetic fixtures; all L1T acceptance cases).
  - [ ] Implement `packages/llm-mesh/src/enrollment/seat-onboarding.ts`: `SeatOnboardingV1`, `SeatEnvelopeV1`, `SeatOnboardingFile`, `SeatOnboardingDestKey`, `SeatOnboardingCode` (incl. `onboarding-incomplete`, `onboarding-binding-unverifiable`, launch-gate `onboarding-required`), `SEAT_ONBOARDING_MAX_BYTES`, `SEAT_ENVELOPE_AUTH_FILES`, `AGY_REQUIRED_COMPLETED_STEPS`, pbtxt-subset parser, per-format validators, `validateSeatOnboarding`, `validateSeatEnvelope` (returns `onboardingStatus`), `seatLaunchGate`, `rebindSeatOnboarding`.
  - [ ] Export from `src/enrollment/index.ts` and `src/node/index.ts`.
  - [ ] Lot gate: `flock <lock> make test-llm-mesh SCOPE=tests/enrollment/seat-onboarding.test.ts ENV=test-seat-onboarding` green; `make test-llm-mesh ENV=test-seat-onboarding` full green (seat-bundle + cli-seat-import tests unchanged); `make typecheck-llm-mesh ENV=test-seat-onboarding`; `make lint-llm-mesh ENV=test-seat-onboarding`; `make scope-check ENV=test-seat-onboarding`; `make down ENV=test-seat-onboarding`.
  - [ ] L1T acceptance: valid block per format passes; unknown top-level/nested key refused; lineage mismatch refused; bundle `nativeCliVersion` absent with block present refused; block > 4 KiB refused; envelope > 48 KiB refused; digest/byteLength mismatch refused; partial agy step set → `onboarding-incomplete`; non-`custodian-stable-ref` basis refused; absent block validates for every CLI with `onboardingStatus: 'absent'` and `seatLaunchGate` closed (`onboarding-required`) for agy/claude/muse/codex, eligible for vibe; present block on vibe → `onboarding-shape-unverified`; `validateSeatEnvelope` never returns `onboarding-required`; rebind accepts same-epoch forward, refuses epoch/version/digest/account change; existing seat-bundle + cli-seat-import tests green.

- [x] **Lot 2 — agy canonicalizer and capture (L2) + L2T**
  - [ ] Write `packages/llm-mesh/tests/node/seat-onboarding-capture.test.ts` first (synthetic fixtures).
  - [ ] `canonicaliseAgyJetski` (pure, in enrollment module) + node-side `captureSeatOnboarding` in `src/node/seat-onboarding-capture.ts` (explicit source HOME + selector, lstat regular file only, size cap before parse, custodian `capturedAt`, explicit stable account reference); export from `src/node/index.ts`.
  - [ ] Lot gate: scoped + full `make test-llm-mesh`, `make typecheck-llm-mesh`, `make lint-llm-mesh`, `make scope-check`, `make down` — all `ENV=test-seat-onboarding` last.
  - [ ] L2T acceptance: measured-shape fixture (full step set + `installation_uuid` + `migrations`) captures to canonical steps-only bytes; 1-of-4 and 3-of-4 source sets → `onboarding-incomplete`; string/numeric scalar inside block → `onboarding-identifier-present`; unknown step enum → `onboarding-shape-unverified`; version without required-set entry refuses; missing/empty `post_onboarding` refused; duplicate block refused; symlink source refused; no default-home read (selector required).

- [x] **Lot 3 — Two-stage materialization and erasure (L3) + L3T**
  - [ ] Write `packages/llm-mesh/tests/node/seat-onboarding-materialize.test.ts` first.
  - [ ] `src/node/seat-onboarding-materialize.ts`: `materialiseSeatEnvelopes` (stage 1, two-phase batch, seat record `.sentropic-seat/seat-record.v1.json` with derived `launchGate`), `materialiseCellHome` (stage 2, explicit `configDirs`, single writer per owned destination, launch-gate re-derivation + `onboarding-required` zero-write refusal), `eraseSeatHome`, `SeatStageReceipt`, `SeatCellReceipt`; exports from `src/node/index.ts`.
  - [ ] Lot gate: scoped + full tests, typecheck, lint, scope-check, down (`ENV=test-seat-onboarding` last).
  - [ ] L3T acceptance: synthetic envelope set stages with exact bytes/modes/names-only receipt; refused second seat leaves first unwritten (phase atomicity); present+absent gated pair stages both (absent seat record/receipt carry closed gate) while present-but-invalid pair writes nothing; stage 2 on absent-block gated seat refuses `onboarding-required` with zero files; vibe-absent succeeds auth-only; present block with empty `cellSynthesis` succeeds with no trust entry; edited stored `launchGate` refuses at stage 2; exact destination mapping incl. claude `.claude.json` inside `claudeConfigDir`; missing workspace / version mismatch / pre-existing target / symlinked parent refuse with zero writes; one staged seat seeds two role HOMEs without seat-dir mutation; codex render contains wrapper command verbatim and refuses out-of-intent server; claude composition refuses colliding MCP keys, never re-minimizes; erase leaves no surviving path at either stage; receipts carry no content bytes (canary absent).

- [x] **Lot 4 — claude, muse, codex projections (L4) + L4T**
  - [ ] Write `packages/llm-mesh/tests/enrollment/seat-onboarding-projections.test.ts` first + extend materialize tests.
  - [ ] `projectClaudeOnboarding`, `projectMuseTrust`, codex policy intent + `renderCodexSeatConfig` (pure, enrollment module); stage-2 composition and Q2-limited trust synthesis in the materialize module (`cellSynthesis` entries only, cell workspace only); version-pinned codex probe as fixture-backed test with `unverified` fallback to typed blocker.
  - [ ] Lot gate: scoped + full tests, typecheck, lint, scope-check, down (`ENV=test-seat-onboarding` last).
  - [ ] L4T acceptance: oversize synthetic `.claude.json` captures to the two-field projection; stage 1 refuses non-minimized auth `.claude.json`; `oauthAccount` never in block or receipt; materialised `.claude.json` has exactly the cell-workspace trust entry and no foreign path; empty `cellSynthesis` → no trust entry for claude/muse/codex; muse materialisation has exactly one project (cell workspace); rendered codex config has only cell project + supplied MCP servers + policy value; unknown muse `schema_version` and malformed claude `lastOnboardingVersion` refuse.

- [x] **Lot 5 — Stored seat record, facade export, keyring read fix (L5) + L5T**
  - [x] Re-check PR #887 state; rebase onto `origin/main` if merged, else onto the #887 head (SEATONB-EX1); never edit the keyring files directly.
  - [x] Write `packages/llm-mesh/tests/service/seat-onboarding-import-export.test.ts` first (16 L5T cases, synthetic fixtures).
  - [x] `importSeatBundle` additive `onboarding` member (validate + bind before registration; refusal rejects whole import), seat-record persistence `sentropic-llm-mesh:<accountId>:seat-record` (`{version:1, bundle, onboarding|null, storedAt}`), forward overwrite, idempotent backfill, removal cleanup (three existing deleteSecret sets); `exportSeatBundle({accountId, ownerScope})` on facade + service with typed `seat-export-unavailable:<reason>` refusals (`not-a-seat`, `record-missing`, `lineage-mismatch`, `owner-mismatch`, `record-invalid`; never refresh material or native files).
  - [x] Version bump 0.33.0: `packages/llm-mesh/package.json`, `make lock-root` (llm-mesh entry + two widened ranges only), CHANGELOG, `tests/decision-public-surface.test.ts`, peer-cap widening per SEATONB-EX2.
  - [ ] Lot gate: scoped + full tests, typecheck, lint, build, scope-check, down (`ENV=test-seat-onboarding` last).
  - [x] L5T acceptance: import with valid block persists record, export returns bundle+block verbatim through the record (incl. lineage + `reboundFrom` after forward re-import with rebound block); invalid/misbound block registers no account; import without block succeeds, exports `onboarding: null`; pre-L5 fixture account (marker, no record) refuses `seat-export-unavailable:record-missing` then exports after idempotent backfill; directly enrolled account refuses `not-a-seat`; export refuses foreign ownerScope, never returns refresh material or native files; removal deletes seat record; keyring `getSecret` succeeds on read-only-mounted fixture and a pure read leaves mode+ctime unchanged (from #887); pre-existing importSeatBundle tests green.

- [ ] **Lot 6 — Release & PR**
  - [ ] Post-rebase gate: `packages/llm-mesh/package.json` version > `npm view @sentropic/llm-mesh version`.
  - [ ] Final: `make test-llm-mesh`, `make typecheck-llm-mesh`, `make build-llm-mesh`, `make lint-llm-mesh ENV=test-seat-onboarding`; `make down ENV=test-seat-onboarding`.
  - [ ] `make scope-check ENV=test-seat-onboarding` before each commit.
  - [ ] Push `feat/seat-onboarding` after each commit; open ONE READY PR (BRANCH.md as body) at the final head; one CI run; monitor via `gh`.
  - [ ] Report to `.tmp/rv/seat-onboarding.md` (PR, head, CI, per-lot acceptance). Do NOT merge.
