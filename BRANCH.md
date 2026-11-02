# Fix: artifacts get_source text/base64 payload and guide reference (0.2.7)

## Objective
- [ ] Fix the owner-urgent @sentropic/artifacts 0.2.6 defect found through the real claude.ai connector: `artifacts_get_source` returns each file as a JSON integer array (`bytes: Array.from(bytes)`) and re-attaches the whole authoring guide, so an 816-byte page blows the tool-result budget and breaks page editing in claude.ai. Return text files as UTF-8 `text` with `encoding: "utf8"`, non-text files as `base64` with `encoding: "base64"` (never an integer array), keep size/digest verification on the raw bytes, return only a guide reference from `get_source`, respect the 32-file / 256 KiB per-call budgets, and ship 0.2.7 with refreshed pins.

## Scope / Guardrails
- [x] Base: origin/main `d1f45c625`; branch `fix/artifacts-get-source-text`; worktree `tmp/worktrees/artifacts-get-source-text`.
- [x] Make-only Docker-first; the single Docker lock `.tmp/packets/DOCKER-LOCK.md` is taken per command (`flock <lock> make ...`); `ENV=test-artifacts-gst` always last; `make down ENV=test-artifacts-gst` after test runs; never `ENV=dev`; never `make clean-all`; never `[skip ci]`.
- [x] Tests first; selective staging (`git add <files>` only); commits via `make commit MSG="..."` only, <=150 lines per commit; `make scope-check` before every commit; push the branch after commits (crash safety).
- [x] Generic upstream fix in `@sentropic/artifacts`, consistent with the converged-r2 get_source contract; no IMMO-side changes in this repo.
- [x] Package publication rules: bump `packages/artifacts/package.json` to 0.2.7 (> published 0.2.6), refresh root/API lock pins through `make lock-root` / `make lock-api`, and re-pin the APP-P1 manifest digest in `api/src/services/mcp/cluster-registry.ts` plus its two test fixtures (as #878/#90eda did for 0.2.5/0.2.6).
- [x] One CI run on the final pushed head; READY PR; no merge; report to `.tmp/rv/artifacts-get-source-text.md`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `.github/workflows/**`
  - `.track/**`
  - `.tmp/**`
  - `api/src/**` except `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/**` except the two registry/installed fixtures
  - `packages/**` except `packages/artifacts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/storage/postgres.mk` (BR-A20B-EX1)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] Defect report (owner-urgent, via immo through the real claude.ai connector): `packages/artifacts/src/server/source-read.ts:66` returns `bytes: Array.from(bytes)`; get_source re-attaches the whole authoringGuide (~68 KB for an 816-byte page); the MCP tool-result budget is exceeded and page editing breaks in claude.ai.
- [x] Fix contract (converged-r2 get_source): text mime types (existing `TEXT_MIME_PATTERN` in `http.ts`) return `text` + `encoding: "utf8"`; non-text files return `base64` + `encoding: "base64"`; never an integer array; size/digest verification stays on the raw bytes; per-call budgets stay 32 files / 256 KiB; get_source returns a guide reference (tool + version), never the guide body.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single defect, single package plus its API pins; one final test cycle)
- Rationale: one owner-urgent defect in one package; no orthogonal sub-workstreams, so no multi-branch split.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, converged-r2 get_source contract.
  - [x] Worktree `tmp/worktrees/artifacts-get-source-text` on `fix/artifacts-get-source-text` from origin/main; `.env` copied; `harness check branch` mechanical verification.
  - [x] Test lane: `make test-artifacts` / `make typecheck-artifacts` / `make lint-artifacts` with `ENV=test-artifacts-gst` last, under the single Docker lock, then `make down ENV=test-artifacts-gst`.
- [x] **Lot 1 — Tests first**
  - [x] `packages/artifacts/tests/parity-source.test.ts`: text file returns `{ text, encoding: "utf8" }`; binary file returns `{ base64, encoding: "base64" }`; no integer-array `bytes`; digest/size verification still on raw bytes; result carries `guideRef` (tool + version) and no guide body.
  - [x] New test: an 816-byte page yields a small serialized result (well under the 2 MiB MCP budget; assert exact small byte count class, e.g. < 4 KiB wire).
  - [x] Update transport/profile assertions that read get_source output (`parity-transport.test.ts`, `parity-r2-profile.test.ts`, `parity-p0-edits.test.ts`, `fixtures/parity-world.ts` `sourceText` helper) to the text/base64 shape.
  - [x] Scoped run: `make test-artifacts SCOPE=tests/parity-source.test.ts ENV=test-artifacts-gst`, then the touched files, then the full unit suite.
- [x] **Lot 2 — Implementation**
  - [x] `packages/artifacts/src/server/source-read.ts`: encode files as text/base64 with `encoding`, keep raw-byte verification, add `guideRef` to the result.
  - [x] Share `TEXT_MIME_PATTERN` without an import cycle (move to a leaf module, re-export from `http.ts`).
  - [x] `packages/artifacts/src/http.ts`: get_source passes the guide reference; `conflictSource` currentSource files use the same encoding shape.
  - [x] Tool schema: `packages/artifacts/src/profile/schemas.ts` get_source description + `packages/artifacts/src/server/result-schema.ts` source-file schema (text/base64 + encoding, no integer array).
  - [x] API guide text: `packages/artifacts/src/server/templates.ts` GUIDE_V1 get_source wording (text/base64 encoding, guide reference, budgets).
  - [x] Lot gate: `make typecheck-artifacts` + `make lint-artifacts` + `make test-artifacts` with `ENV=test-artifacts-gst`, then `make down ENV=test-artifacts-gst`.
- [x] **Lot 3 — Version, changelog, pins**
  - [x] `packages/artifacts/CHANGELOG.md` 0.2.7 entry; `packages/artifacts/package.json` version 0.2.7; `ARTIFACTS_PROVIDER_VERSION` in `mcp-core.ts`.
  - [x] Refresh lock pins through make: `make lock-root ENV=test-artifacts-gst`, `make lock-api ENV=test-artifacts-gst` (single Docker lock per command), then `make down ENV=test-artifacts-gst`.
  - [x] Recompute and re-pin the APP-P1 manifest digest in `api/src/services/mcp/cluster-registry.ts` + `api/tests/api/app-mcp-registry.test.ts` + `api/tests/api/app-mcp-installed.test.ts` (0.2.7, superseded 0.2.6 receipt refused).
  - [x] `make scope-check` before every commit; atomic `make commit` per logical change; push after commits.
- [ ] **Lot 4 — PR & CI**
  - [ ] Push `fix/artifacts-get-source-text`; open READY PR with this BRANCH.md as body.
  - [ ] Run exactly one CI on the final head; record the run; do not merge.
  - [ ] Report to `.tmp/rv/artifacts-get-source-text.md`.
