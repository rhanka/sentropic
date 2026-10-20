# Feature: decouple memory L5 P1 from whole root lockfile

## Objective
Replace the live root-lockfile equality in the P1 packed gate with a versioned fingerprint of the resolved P1 dependency and build-tool closure.

## Scope / Guardrails
- Scope limited to P1 pre-candidate pack/verify, manifest schema, and tooling tests.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/l5-p1-fingerprint`.
- Automated test campaigns on dedicated environment (`ENV=test-l5-fingerprint`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Never run `make clean-all`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/lock-fingerprint.mjs`
  - `tools/memory-mcp-l5/precandidate.mjs`
  - `tools/memory-mcp-l5/pack.mjs`
  - `tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json`
  - `tools/memory-mcp-l5/tests/**`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `tools/memory-mcp-l5/artifacts/history/**`
  - `tools/memory-mcp-l5/artifacts/archives/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `.github/**`
  - `tools/memory-mcp-l5/receipt.mjs`
  - `tools/memory-mcp-l5/schema-validator.mjs`
  - `tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

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
- Rationale: single orthogonal fix, one test cycle, no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT skipped: no UI changes in this branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, packet and proposal.
  - [x] Confirm worktree `tmp/worktrees/l5-p1-fingerprint` on branch `fix/l5-p1-lockfile-fingerprint`.
  - [x] Run `harness check branch`.
  - [x] Confirm ENV mapping: `ENV=test-l5-fingerprint` for all make runs, ports `API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725`.
  - [x] Validate scope boundaries (no EXn expected).
- [x] **Lot 1 — Fingerprint the P1 dependency and build-tool closure**
  - [x] Add `tools/memory-mcp-l5/lock-fingerprint.mjs` (`LOCK_FINGERPRINT_VERSION=1`, `computeLockFingerprint`, relevant-key projection).
  - [x] `precandidate.mjs`: compare pinned fingerprint against live lockfile instead of full-file sha equality; keep `declaredLockSha256` as provenance only.
  - [x] `pack.mjs`: pin `lockFingerprintVersion` + `lockFingerprint` in manifest source; retain `declaredLockSha256`.
  - [x] `schemas/artifact-manifest-v1.schema.json`: require versioned fingerprint in `manifestSource`; keep `declaredLockSha256`.
  - [x] Update `tests/p1-fixture.mjs`, `tests/artifact-manifest.test.mjs`, `tests/receipt-contract.test.mjs` fixtures for the new source fields.
  - [x] Lot gate: `make scope-check` before commit.
- [x] **Lot 2 — Fixtures and regression tests**
  - [x] Add `tests/lock-fingerprint.test.mjs`: unrelated lockfile edits pass, relevant dependency/build-input edits fail.
  - [x] Extend packed-gate coverage: unrelated lock edit passes, relevant lock edit fails, contract/archive drift still fails.
  - [x] Lot gate: `make memory-l5-tooling API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-l5-fingerprint`.
- [x] **Lot 3 — Regenerate P1, full gate, PR**
  - [x] Retain superseded manifest in `artifacts/history/` (content-sha name + sidecar).
  - [x] Rebuild dist and repack P1 via make targets.
  - [x] Verify archives unchanged, inventory still exact 44 contracts, sidecars valid.
  - [x] Lot gate: `make memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-l5-fingerprint`.
  - [x] `make scope-check` before each commit; atomic commits via `make commit MSG="..."`.
  - [x] Push branch and open DRAFT PR; do not merge.
