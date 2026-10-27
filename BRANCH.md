# Feature: Live STT L4 terminal devices

## Objective
Deliver approved r3 L4: `live-speech/src/node/{capture,device,terminal-control}.ts`, pinned audio helpers, both key (toggle) and open-mic controls, wired to the L3 session.

## Scope / Guardrails
- Scope limited to L4 terminal devices: device port (fake + arecord backend), capture session (mic state, mute, level meter, bounded queue, device loss), terminal controller (toggle/start-end keys, no leakage, TTY restore), wiring into the L3 session, §8.1/G-NATIVE receipts.
- No L2 core files (`live-speech/src/core/**` belongs to the parallel L2 lane).
- No llm-mesh/cluster-mesh source edits.
- No new npm dependencies: pure Node (node:child_process spawn with argv, no shell), no Python, no node-gyp.
- No microphone in tests (fake device only); no audio payload in logs (counts/revisions/text only).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/stt-l4` (even for one active branch).
- Automated test campaigns on dedicated env `ENV=test-stt-l4`, never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/live-speech/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] No conditional path touched (no Makefile/CI changes: `test-live-speech` already covers `tests/**`, `validate-live-speech` already gates on `packages/live-speech/**`).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single-package lot with one test cycle; no UI.

## UAT Management (in orchestration context)
- [x] No UI change; no UAT required (no microphone path exercised by a human in this lot; capture proven with fake device + qualified host binaries).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, `rules/MASTER.md`, `rules/workflow.md`, DOCKER-LOCK, spec-plan r3 (L4 l.422, G-NATIVE l.351/l.486, §5.1, §8.1).
  - [x] Create worktree `tmp/worktrees/stt-l4` on `origin/feat/live-stt-l3` as `feat/live-stt-l4`.
  - [x] Qualify host audio helpers: arecord 1.2.15.2 (alsa-utils), pw-record (pipewire-bin, libpipewire 1.6.2) with sha256 digests.
  - [x] Confirm scope: no Makefile/CI changes needed, no exceptions.
- [x] **Lot 1 — Device port**
  - [x] `src/node/device.ts`: `DevicePort`, `AudioDeviceInfo`, `AudioStream`, `DeviceUnavailableError`/`DeviceOpenError`/`DeviceLostError`.
  - [x] `ArecordDevice`: argv-pinned `arecord` spawn (no shell), S16_LE raw stdout to Float32Array frames, list via `arecord -l`, fail closed without binary.
  - [x] `tests/device.test.ts` + `tests/fixtures/fake-device.ts` (scripted frames, open-failure and loss injection): list/open/frames, open failure, mid-stream loss, missing binary, argv exactness.
  - [x] Lot gate: `make test-live-speech SCOPE=tests/device.test.ts ENV=test-stt-l4` green (8/8).
- [x] **Lot 2 — Capture session**
  - [x] `src/node/capture.ts`: mic-off default, mute independent of VAD, level meter (dBFS only), bounded downstream queue with drop counter, device-loss event, idempotent close.
  - [x] `tests/capture.test.ts`: starts muted/off, toggle, mute/VAD independence, meter values, bounded drops, loss propagation, cleanup.
  - [x] Lot gate: `make test-live-speech SCOPE=tests/capture.test.ts ENV=test-stt-l4` green (7/7).
- [ ] **Lot 3 — Terminal control + wiring**
  - [ ] `src/node/terminal-control.ts`: toggle + explicit start/end keys on its own TTY stream, no hold without qualified hotkey (fail closed), documented defaults, TTY restore on close, never forwards keys.
  - [ ] `tests/terminal-control.test.ts`: toggle/stop keys, unknown keys ignored, no leakage, raw-mode restore, hold-without-hotkey throws.
  - [ ] `tests/capture-control.test.ts`: FakeDevice tone through capture into the L3 session; toggle on yields a final, toggle off yields silence; stop closes everything.
  - [ ] Lot gate: `make test-live-speech ENV=test-stt-l4` green (full package).
- [ ] **Lot N-1 — Docs + receipts**
  - [ ] `packages/live-speech/README.md`: L4 layout (device/capture/control).
  - [ ] `packages/live-speech/bench/l4-g-native.receipt.json` (§8.1/G-NATIVE: image, toolchain, helper digests/licenses, no-interpreter evidence, blocked live-mic/speaker-AEC/hold-hotkey).
  - [ ] `src/node/index.ts`: export L4 modules.
- [ ] **Lot N — Final validation**
  - [x] Typecheck (via `test-live-speech` tsc --noEmit) & Lint (n/a: no lint lane for this package)
  - [ ] Retest package green on head
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. (New private package: CI skips bump check.)
  - [ ] Final gate step 1: create draft PR to main using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
