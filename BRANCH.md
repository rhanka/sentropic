# Feature: artifacts files-parity LOT 2

## Objective
Ship files-parity LOT 2 in `@sentropic/artifacts` on top of origin/main (0.2.13): browser upload page, assets as first-class files, staging GC, quotas, metrics.

## Scope / Guardrails
- Scope limited to `packages/artifacts` (src, tests, migrations, docs).
- No version bump, no lock/pin/L5 regeneration (train integration lane owns them).
- One migration max: `migrations/0009_upload_pages.sql` (additive, IF NOT EXISTS).
- Make-only workflow, Docker via `.tmp/packets/docker-slot.sh` (3 parallel slots, one slot per command, never nested).
- Never ENV=dev; test stacks on ENV=test-files-lot2, then `make down-volumes ENV=test-files-lot2`.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- The 21 current `ARTIFACTS_TOOL_DEFINITIONS` entries stay byte-identical; LOT 2 only appends `artifacts_create_upload_page`, `artifacts_list_assets`, `artifacts_publish_bundle_v2`, frozen at birth.
- Review `files-lot2-large4_r1` (CHANGES) is binding: cookie `__Host-` keeps `Path=/`; tool count follows shipped code (21 current on origin/main, review checkout predates the 3 train tools).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/migrations/0009_upload_pages.sql`
  - `packages/artifacts/docs/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/package.json` (version stays 0.2.13)
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**` (host upload-page mount: no, host wagon duty)
  - `apps/artifact-content/**` (Range passthrough: no, host wagon duty)
  - `packages/artifacts/tests/snapshots/tools-list-catalogue.json` (BRLOCK-EX2: deliberate snapshot regen, same change as the new definitions, per design T1 acceptance)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `BRLOCK-EX1`: retained (see Scope / Guardrails).
- `BRLOCK-EX2`: `packages/artifacts/tests/snapshots/tools-list-catalogue.json` regen in the same change as the 3 new tool definitions (design §Freeze/T1 acceptance; test doc mandates same-commit update; train owns locks/pins/L5 only).

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
- Rationale: one package, one lane, sequential lots on a single branch.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints are listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/files-lot2`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/files-lot2` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `.tmp/packets/COMMON-RULES.md`, design `.tmp/artifacts-files-parity/design-lot2.md` §A-§D, review `.h2a/reviews/files-lot2-large4_r1.md`.
  - [x] Create worktree `tmp/worktrees/files-lot2` on branch `feat/artifacts-files-parity-lot2` from `origin/main` (a1d0a815a).
  - [x] Write this `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` with BRLOCK-EX1 review_by line retained.
  - [x] Environment mapping: `ENV=test-files-lot2` for every test stack, never root dev.
  - [x] Confirm command style: `.tmp/packets/docker-slot.sh make ... ENV=test-files-lot2` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRLOCK-EX2`.
- [ ] **Lot 1 — Tests first (design acceptance criteria)**
  - [ ] New `tests/files-parity-lot2.test.ts`: upload-page journey (mint/exchange/create/commit/list/retrieve, negatives: token reuse, expiry, foreign artifact, spoofed type 422 no pin).
  - [ ] `list_assets` incl. staged/released/all, page filter, pagination, auth (released needs source right, staged owner-only or access_denied).
  - [ ] `publish_bundle_v2` incl. copy/carry/keepUnmodifiedPaths, foreign-scope refused, no-source-right refused, one bad ref commits nothing, origins in receipts.
  - [ ] `get_source` caps: oversize manifest returns omitted entries (too_large/over_total_budget), prior reads byte-identical.
  - [ ] Range: 206 slice/headers, suffix/open forms, 416, malformed ignored, auth before range, HEAD parity.
  - [ ] GC/quotas/metrics: consumed-pin unpin, staged TTL refuse+expire, orphan keys, scope quota race (parallel creates admit exactly N), metric events no identifier labels.
  - [ ] Extend sha256 pin to all 21 current definitions (same hash); snapshot regen deliberately (BRLOCK-EX2).
  - [ ] Lot gate:
    - [ ] `make typecheck-artifacts ENV=test-files-lot2`
    - [ ] Scoped runs while evolving tests: `.tmp/packets/docker-slot.sh make test-artifacts SCOPE=tests/files-parity-lot2.test.ts ENV=test-files-lot2`
- [ ] **Lot 2 — Upload page (§A + review finding 1)**
  - [ ] `src/server/upload-page.ts`: `createUploadPageService` + static page, token hash + single exchange, `__Host-` cookie `Path=/`, Origin + `x-artifact-upload: 1` CSRF, shared create/commit core.
  - [ ] `migrations/0009_upload_pages.sql` + `src/adapters/postgres-uploads.ts` (sessions + pages over 0007+0009).
  - [ ] `artifacts_create_upload_page` tool: definition + profile op + route `POST /uploads/page` + executor case + transport allowlist.
  - [ ] Guide section incl. gap-1 wording fix.
  - [ ] Lot gate: scoped unit tests green.
- [ ] **Lot 3 — Assets as first-class files (§B)**
  - [ ] `artifacts_list_assets` end to end (definition, profile op, route, executor, handler).
  - [ ] `artifacts_publish_bundle_v2` (copy/carry/keepUnmodifiedPaths, origins in receipts); v1 handler untouched except consumed-pin unpin.
  - [ ] `get_source` caps + omitted entries (no definition change).
  - [ ] Range on content handler + `getBlobRange` + S3 adapter; `accept-ranges` on 200/206; fonts via profile enablement only.
  - [ ] Lot gate: scoped unit tests green.
- [ ] **Lot 4 — Staging GC, quotas, metrics (§D + consumed-pin unpin)**
  - [ ] Sweeper passes 2-4 (staged TTL, orphan keys bounded 500, page expiry), additive report fields.
  - [ ] Per-artifact staged caps at commit, per-scope staging aggregate with atomic store contract + race test.
  - [ ] Metrics port wiring (low-cardinality labels, no identifiers).
  - [ ] Lot gate: scoped unit tests green.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (N/A: no UI change in this package lane)
  - [ ] Retest API (N/A: package lane; scoped `make test-artifacts` full unit file)
  - [ ] Retest e2e (N/A: package lane; integration suite only if touched: S3-backed variant via existing harness)
  - [ ] Scoped: `.tmp/packets/docker-slot.sh make test-artifacts SCOPE=tests/files-parity-lot2.test.ts ENV=test-files-lot2`
  - [ ] Broader: `.tmp/packets/docker-slot.sh make test-artifacts ENV=test-files-lot2` (full unit suite, excludes integration/e2e)
  - [ ] `make down-volumes ENV=test-files-lot2`
  - [ ] Push branch (no PR: joins a release train)
